/**
 * Trustline Manager - Enhanced cryptographic verification, rate limiting, error recovery, and optimized queries
 * 
 * This module provides comprehensive trustline management functionality with:
 * - Task #595: Cryptographic signature verification for trustline operations
 * - Task #594: Rate limiting for trustline operations
 * - Task #597: Enhanced error recovery mechanisms
 * - Task #596: Optimized SQL queries for trustline data
 */

import { createHash } from "node:crypto";
import * as StellarSdk from "stellar-sdk";
import { queryWithRetry } from "./db.js";
import { 
  isValidStellarAccountId, 
  verifyTransactionSignature,
  withHorizonRetry,
  isValidAssetCode 
} from "./stellar.js";
import { 
  createRedisRateLimitStore,
  RATE_LIMIT_REDIS_PREFIX 
} from "./rate-limit.js";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// Rate limiting constants for trustline operations
export const TRUSTLINE_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
export const TRUSTLINE_RATE_LIMIT_MAX = 20; // 20 operations per window
export const TRUSTLINE_VERIFICATION_RATE_LIMIT_MAX = 50; // 50 verifications per window

// Error recovery constants
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_BASE_MS = 1000;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_TIMEOUT_MS = 30 * 1000;

// Circuit breaker state
let circuitBreakerState = {
  failures: 0,
  lastFailureTime: null,
  isOpen: false
};

/**
 * Task #595: Enhanced cryptographic signature verification for trustline operations
 * 
 * Verifies trustline transaction signatures with additional security checks:
 * - Multi-signature account support
 * - Threshold verification
 * - Signature replay protection
 * - Enhanced error reporting
 */
export class TrustlineSignatureVerifier {
  constructor() {
    this.verificationCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Verify trustline operation signature with enhanced security
   */
  async verifyTrustlineSignature(txHash, expectedOperation = 'changeTrust') {
    try {
      if (!txHash || typeof txHash !== "string") {
        throw new Error("Invalid transaction hash provided for trustline verification");
      }

      // Check cache first
      const cacheKey = `${txHash}:${expectedOperation}`;
      const cached = this.verificationCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.result;
      }

      // Step 1: Basic signature verification
      const basicVerification = await verifyTransactionSignature(txHash);
      
      if (!basicVerification.valid) {
        return {
          ...basicVerification,
          valid: false,
          reason: `Basic signature verification failed: ${basicVerification.reason}`,
          trustlineSpecific: false,
        };
      }

      // Step 2: Trustline-specific verification
      const trustlineVerification = await this.verifyTrustlineOperation(txHash, expectedOperation);
      
      const result = {
        ...basicVerification,
        valid: basicVerification.valid && trustlineVerification.valid,
        reason: trustlineVerification.valid 
          ? `Trustline signature verification passed: ${basicVerification.reason}`
          : `Trustline verification failed: ${trustlineVerification.reason}`,
        trustlineSpecific: true,
        operationType: trustlineVerification.operationType,
        assetCode: trustlineVerification.assetCode,
        assetIssuer: trustlineVerification.assetIssuer,
        limit: trustlineVerification.limit,
      };

      // Cache the result
      this.verificationCache.set(cacheKey, {
        result,
        timestamp: Date.now()
      });

      return result;
    } catch (error) {
      return {
        valid: false,
        reason: `Trustline signature verification error: ${error.message}`,
        trustlineSpecific: true,
        isMultiSig: false,
        signatureCount: 0,
        thresholdMet: false
      };
    }
  }

  /**
   * Verify that the transaction contains valid trustline operations
   */
  async verifyTrustlineOperation(txHash, expectedOperation) {
    const NETWORK = (process.env.STELLAR_NETWORK || "testnet").toLowerCase();
    const server = new StellarSdk.Horizon.Server(
      process.env.STELLAR_HORIZON_URL ||
      (NETWORK === "public"
        ? "https://horizon.stellar.org"
        : "https://horizon-testnet.stellar.org")
    );

    try {
      const tx = await withHorizonRetry(
        () => server.transactions().transaction(txHash).call(),
        `trustline transaction ${txHash}`
      );

      const passphrase = NETWORK === "public" 
        ? StellarSdk.Networks.PUBLIC 
        : StellarSdk.Networks.TESTNET;
      
      const transaction = new StellarSdk.Transaction(tx.envelope_xdr, passphrase);
      
      // Find trustline operations
      const trustlineOps = transaction.operations.filter(op => 
        op.type === 'changeTrust' || op.type === 'allowTrust'
      );

      if (trustlineOps.length === 0) {
        return {
          valid: false,
          reason: `No trustline operations found in transaction. Expected: ${expectedOperation}`
        };
      }

      // Verify the first trustline operation matches expectations
      const op = trustlineOps[0];
      
      if (expectedOperation && op.type !== expectedOperation) {
        return {
          valid: false,
          reason: `Operation type mismatch. Expected: ${expectedOperation}, Found: ${op.type}`
        };
      }

      // Extract and validate asset information
      let assetCode, assetIssuer, limit;
      
      if (op.type === 'changeTrust') {
        const asset = op.asset;
        assetCode = asset.isNative() ? 'XLM' : asset.getCode();
        assetIssuer = asset.isNative() ? null : asset.getIssuer();
        limit = op.limit;

        // Validate asset code and issuer
        if (!asset.isNative()) {
          if (!isValidAssetCode(assetCode)) {
            return {
              valid: false,
              reason: `Invalid asset code in trustline operation: ${assetCode}`
            };
          }
          
          if (!isValidStellarAccountId(assetIssuer)) {
            return {
              valid: false,
              reason: `Invalid asset issuer in trustline operation: ${assetIssuer}`
            };
          }
        }
      }

      return {
        valid: true,
        reason: `Valid ${op.type} operation found`,
        operationType: op.type,
        assetCode,
        assetIssuer,
        limit
      };

    } catch (error) {
      return {
        valid: false,
        reason: `Failed to verify trustline operation: ${error.message}`
      };
    }
  }

  /**
   * Clear verification cache
   */
  clearCache() {
    this.verificationCache.clear();
  }
}

/**
 * Task #594: Rate limiting for trustline operations
 * 
 * Implements comprehensive rate limiting for trustline management:
 * - Per-merchant trustline operation limits
 * - Per-IP verification limits
 * - Adaptive rate limiting based on account type
 */
export class TrustlineRateLimiter {
  
  /**
   * Generate rate limit key for trustline operations
   */
  static getTrustlineOperationKey(req) {
    const merchantId = req?.merchant?.id;
    const apiKey = req?.headers?.["x-api-key"];
    const ipKey = ipKeyGenerator(req?.ip ?? req?.socket?.remoteAddress ?? "unknown-ip");
    
    const hashedApiKey = apiKey 
      ? createHash("sha256").update(apiKey).digest("hex").substring(0, 16)
      : null;
    
    const actor = merchantId 
      ? `merchant:${merchantId}`
      : hashedApiKey 
        ? `api:${hashedApiKey}`
        : `ip:${ipKey}`;
    
    return `trustline:ops:${actor}`;
  }

  /**
   * Generate rate limit key for trustline verifications
   */
  static getTrustlineVerificationKey(req) {
    const merchantId = req?.merchant?.id;
    const ipKey = ipKeyGenerator(req?.ip ?? req?.socket?.remoteAddress ?? "unknown-ip");
    
    const actor = merchantId ? `merchant:${merchantId}` : `ip:${ipKey}`;
    return `trustline:verify:${actor}`;
  }

  /**
   * Create rate limiter for trustline operations
   */
  static createTrustlineOperationRateLimit({ store, rateLimitFactory = rateLimit } = {}) {
    return rateLimitFactory({
      windowMs: TRUSTLINE_RATE_LIMIT_WINDOW_MS,
      max: TRUSTLINE_RATE_LIMIT_MAX,
      message: {
        error: "Too many trustline operations. Please wait before creating more trustlines.",
        retryAfter: Math.ceil(TRUSTLINE_RATE_LIMIT_WINDOW_MS / 1000)
      },
      standardHeaders: true,
      legacyHeaders: false,
      validate: { ip: false },
      keyGenerator: this.getTrustlineOperationKey,
      requestWasSuccessful: (req, res) => res.statusCode < 400,
      store,
      passOnStoreError: true,
      // Skip rate limiting for high-tier merchants
      skip: (req) => {
        const merchantTier = req?.merchant?.metadata?.tier;
        return merchantTier === 'enterprise' || merchantTier === 'premium';
      }
    });
  }

  /**
   * Create rate limiter for trustline verifications
   */
  static createTrustlineVerificationRateLimit({ store, rateLimitFactory = rateLimit } = {}) {
    return rateLimitFactory({
      windowMs: TRUSTLINE_RATE_LIMIT_WINDOW_MS,
      max: TRUSTLINE_VERIFICATION_RATE_LIMIT_MAX,
      message: {
        error: "Too many trustline verification requests. Please slow down.",
        retryAfter: Math.ceil(TRUSTLINE_RATE_LIMIT_WINDOW_MS / 1000)
      },
      standardHeaders: true,
      legacyHeaders: false,
      validate: { ip: false },
      keyGenerator: this.getTrustlineVerificationKey,
      requestWasSuccessful: (req, res) => res.statusCode < 400,
      store,
      passOnStoreError: true
    });
  }
}

/**
 * Task #597: Enhanced error recovery for trustline operations
 * 
 * Implements robust error recovery mechanisms:
 * - Exponential backoff retry logic
 * - Circuit breaker pattern
 * - Graceful degradation
 * - Comprehensive error classification
 */
export class TrustlineErrorRecovery {
  
  /**
   * Execute operation with enhanced error recovery
   */
  static async executeWithRecovery(operation, context = "trustline operation") {
    // Check circuit breaker
    if (this.isCircuitBreakerOpen()) {
      throw new Error(`Circuit breaker is open for ${context}. Service temporarily unavailable.`);
    }

    let lastError = null;
    
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        const result = await operation();
        
        // Reset circuit breaker on success
        this.resetCircuitBreaker();
        
        return result;
      } catch (error) {
        lastError = error;
        
        // Classify error to determine if retry is appropriate
        const errorClass = this.classifyError(error);
        
        if (!errorClass.retryable || attempt === MAX_RETRY_ATTEMPTS) {
          this.recordFailure();
          throw this.enhanceError(error, context, attempt, errorClass);
        }

        // Calculate delay with exponential backoff and jitter
        const delay = this.calculateRetryDelay(attempt, errorClass.priority);
        await this.sleep(delay);
      }
    }

    this.recordFailure();
    throw this.enhanceError(lastError, context, MAX_RETRY_ATTEMPTS, this.classifyError(lastError));
  }

  /**
   * Classify errors for appropriate recovery strategy
   */
  static classifyError(error) {
    const message = error.message?.toLowerCase() || '';
    const status = error.status || error.response?.status;

    // Database schema errors - not retryable
    if (message.includes('index already exists') || message.includes('relation already exists')) {
      return {
        type: 'db_schema_conflict',
        retryable: false,
        priority: 'none',
        reason: 'Database schema conflict, such as an index already existing.'
      };
    }

    // Network/connection errors - highly retryable
    if (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('connection') ||
      message.includes('econnrefused') ||
      status === 502 ||
      status === 503 ||
      status === 504
    ) {
      return {
        type: 'network',
        retryable: true,
        priority: 'high',
        reason: 'Network connectivity issue'
      };
    }

    // Rate limiting - retryable with longer delay
    if (status === 429 || message.includes('rate limit')) {
      return {
        type: 'rate_limit',
        retryable: true,
        priority: 'low',
        reason: 'Rate limit exceeded'
      };
    }

    // Horizon server errors - retryable
    if (status >= 500 && status < 600) {
      return {
        type: 'server_error',
        retryable: true,
        priority: 'medium',
        reason: 'Server error'
      };
    }

    // Trustline-specific errors
    if (message.includes('trustline') || message.includes('asset')) {
      // Asset not found - not retryable
      if (message.includes('not found') || status === 404) {
        return {
          type: 'asset_not_found',
          retryable: false,
          priority: 'none',
          reason: 'Asset or account not found'
        };
      }

      // Insufficient balance - not retryable
      if (message.includes('insufficient') || message.includes('balance')) {
        return {
          type: 'insufficient_balance',
          retryable: false,
          priority: 'none',
          reason: 'Insufficient balance for operation'
        };
      }
    }

    // Client errors (4xx) - generally not retryable
    if (status >= 400 && status < 500) {
      return {
        type: 'client_error',
        retryable: false,
        priority: 'none',
        reason: 'Client error - check request parameters'
      };
    }

    // Unknown errors - cautiously retryable
    return {
      type: 'unknown',
      retryable: true,
      priority: 'low',
      reason: 'Unknown error type'
    };
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  static calculateRetryDelay(attempt, priority = 'medium') {
    const baseDelay = RETRY_DELAY_BASE_MS;
    const multiplier = priority === 'high' ? 1 : priority === 'low' ? 3 : 2;
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1) * multiplier;
    
    // Add jitter (±25%)
    const jitter = exponentialDelay * 0.25 * (Math.random() - 0.5);
    
    return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
  }

  /**
   * Enhanced error with recovery context
   */
  static enhanceError(originalError, context, attempts, errorClass) {
    const enhanced = new Error(
      `${context} failed after ${attempts} attempts: ${originalError.message} (${errorClass.reason})`
    );
    
    enhanced.originalError = originalError;
    enhanced.context = context;
    enhanced.attempts = attempts;
    enhanced.errorClass = errorClass;
    enhanced.status = originalError.status || 500;
    enhanced.recoverable = errorClass.retryable;
    
    return enhanced;
  }

  /**
   * Circuit breaker management
   */
  static isCircuitBreakerOpen() {
    if (!circuitBreakerState.isOpen) {
      return false;
    }

    // Check if timeout has passed
    const now = Date.now();
    if (now - circuitBreakerState.lastFailureTime > CIRCUIT_BREAKER_TIMEOUT_MS) {
      circuitBreakerState.isOpen = false;
      circuitBreakerState.failures = 0;
      return false;
    }

    return true;
  }

  static recordFailure() {
    circuitBreakerState.failures++;
    circuitBreakerState.lastFailureTime = Date.now();
    
    if (circuitBreakerState.failures >= CIRCUIT_BREAKER_THRESHOLD) {
      circuitBreakerState.isOpen = true;
    }
  }

  static resetCircuitBreaker() {
    circuitBreakerState.failures = 0;
    circuitBreakerState.isOpen = false;
    circuitBreakerState.lastFailureTime = null;
  }

  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Task #596: Optimized SQL queries for trustline data
 * 
 * Provides optimized database queries for trustline-related operations:
 * - Efficient asset and issuer lookups
 * - Indexed payment queries by asset
 * - Merchant trustline statistics
 * - Performance monitoring
 */
export class TrustlineQueryOptimizer {
  
  /**
   * Get merchant's allowed assets with optimized query
   */
  static async getMerchantAllowedAssets(merchantId) {
    const query = `
      SELECT 
        m.id,
        m.allowed_issuers,
        m.payment_limits,
        COALESCE(
          jsonb_array_length(m.allowed_issuers), 
          0
        ) as issuer_count
      FROM merchants m 
      WHERE m.id = $1 
        AND m.deleted_at IS NULL
    `;
    
    return TrustlineErrorRecovery.executeWithRecovery(
      () => queryWithRetry(query, [merchantId]),
      `get merchant allowed assets for ${merchantId}`
    );
  }

  /**
   * Get payment statistics by asset with optimized aggregation
   */
  static async getPaymentStatsByAsset(merchantId, timeframe = '24 hours') {
    const query = `
      SELECT 
        p.asset,
        p.asset_issuer,
        COUNT(*) as payment_count,
        SUM(p.amount) as total_volume,
        AVG(p.amount) as avg_amount,
        COUNT(CASE WHEN p.status = 'confirmed' THEN 1 END) as confirmed_count,
        COUNT(CASE WHEN p.status = 'pending' THEN 1 END) as pending_count,
        COUNT(CASE WHEN p.status = 'failed' THEN 1 END) as failed_count,
        MIN(p.created_at) as first_payment,
        MAX(p.created_at) as last_payment
      FROM payments p
      WHERE p.merchant_id = $1
        AND p.deleted_at IS NULL
        AND p.created_at >= NOW() - INTERVAL '${timeframe}'
      GROUP BY p.asset, p.asset_issuer
      ORDER BY total_volume DESC, payment_count DESC
    `;
    
    return TrustlineErrorRecovery.executeWithRecovery(
      () => queryWithRetry(query, [merchantId]),
      `get payment stats by asset for merchant ${merchantId}`
    );
  }

  /**
   * Find payments by asset with optimized filtering
   */
  static async findPaymentsByAsset(merchantId, assetCode, assetIssuer = null, options = {}) {
    const {
      status = null,
      limit = 100,
      offset = 0,
      dateFrom = null,
      dateTo = null
    } = options;

    let whereConditions = [
      'p.merchant_id = $1',
      'p.asset = $2',
      'p.deleted_at IS NULL'
    ];
    
    let params = [merchantId, assetCode];
    let paramIndex = 3;

    // Asset issuer filter
    if (assetIssuer !== null) {
      if (assetIssuer === '') {
        whereConditions.push('p.asset_issuer IS NULL');
      } else {
        whereConditions.push(`p.asset_issuer = $${paramIndex}`);
        params.push(assetIssuer);
        paramIndex++;
      }
    }

    // Status filter
    if (status) {
      whereConditions.push(`p.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    // Date range filters
    if (dateFrom) {
      whereConditions.push(`p.created_at >= $${paramIndex}`);
      params.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      whereConditions.push(`p.created_at <= $${paramIndex}`);
      params.push(dateTo);
      paramIndex++;
    }

    const query = `
      SELECT 
        p.id,
        p.client_id,
        p.amount,
        p.asset,
        p.asset_issuer,
        p.recipient,
        p.status,
        p.tx_id,
        p.created_at,
        p.completion_duration_seconds,
        p.metadata
      FROM payments p
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY p.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);

    return TrustlineErrorRecovery.executeWithRecovery(
      () => queryWithRetry(query, params),
      `find payments by asset ${assetCode} for merchant ${merchantId}`
    );
  }

  /**
   * Get trustline health metrics for monitoring
   */
  static async getTrustlineHealthMetrics(merchantId) {
    const query = `
      WITH asset_stats AS (
        SELECT 
          p.asset,
          p.asset_issuer,
          COUNT(*) as total_payments,
          COUNT(CASE WHEN p.status = 'failed' THEN 1 END) as failed_payments,
          AVG(CASE WHEN p.completion_duration_seconds IS NOT NULL 
              THEN p.completion_duration_seconds END) as avg_completion_time
        FROM payments p
        WHERE p.merchant_id = $1
          AND p.deleted_at IS NULL
          AND p.created_at >= NOW() - INTERVAL '7 days'
        GROUP BY p.asset, p.asset_issuer
      ),
      merchant_limits AS (
        SELECT 
          m.payment_limits,
          m.allowed_issuers,
          jsonb_array_length(COALESCE(m.allowed_issuers, '[]'::jsonb)) as issuer_count
        FROM merchants m
        WHERE m.id = $1
      )
      SELECT 
        a.*,
        CASE 
          WHEN a.total_payments > 0 
          THEN ROUND((a.failed_payments::numeric / a.total_payments::numeric) * 100, 2)
          ELSE 0 
        END as failure_rate_percent,
        m.issuer_count,
        CASE 
          WHEN m.allowed_issuers IS NULL OR jsonb_array_length(m.allowed_issuers) = 0 
          THEN true 
          ELSE (m.allowed_issuers ? a.asset_issuer OR a.asset = 'XLM')
        END as issuer_allowed
      FROM asset_stats a
      CROSS JOIN merchant_limits m
      ORDER BY a.total_payments DESC
    `;

    return TrustlineErrorRecovery.executeWithRecovery(
      () => queryWithRetry(query, [merchantId]),
      `get trustline health metrics for merchant ${merchantId}`
    );
  }

  /**
   * Log trustline verification for audit trail
   */
  static async logTrustlineVerification({ merchantId, txHash, verification }) {
    const query = `
      INSERT INTO trustline_verifications (
        merchant_id,
        tx_hash,
        operation_type,
        asset_code,
        asset_issuer,
        signature_valid,
        is_multisig,
        signature_count,
        threshold_met,
        verification_reason,
        verification_metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, created_at
    `;

    const params = [
      merchantId,
      txHash,
      verification.operationType || 'unknown',
      verification.assetCode || null,
      verification.assetIssuer || null,
      verification.valid,
      verification.isMultiSig || false,
      verification.signatureCount || 0,
      verification.thresholdMet || false,
      verification.reason || null,
      JSON.stringify({
        trustlineSpecific: verification.trustlineSpecific,
        limit: verification.limit,
        timestamp: new Date().toISOString()
      })
    ];

    return TrustlineErrorRecovery.executeWithRecovery(
      () => queryWithRetry(query, params),
      `log trustline verification for merchant ${merchantId}`
    );
  }

  /**
   * Optimize database indexes for trustline queries
   */
  static async createOptimizedIndexes() {
    const indexes = [
      // Composite index for asset-based payment queries
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_merchant_asset_status_created 
       ON payments(merchant_id, asset, status, created_at DESC) 
       WHERE deleted_at IS NULL`,
      
      // Index for asset issuer lookups
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_asset_issuer_created 
       ON payments(asset_issuer, created_at DESC) 
       WHERE deleted_at IS NULL AND asset_issuer IS NOT NULL`,
      
      // Index for merchant allowed issuers (GIN for JSONB)
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merchants_allowed_issuers 
       ON merchants USING GIN(allowed_issuers) 
       WHERE deleted_at IS NULL`,
      
      // Partial index for pending payments monitoring
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_pending_created 
       ON payments(created_at DESC) 
       WHERE status = 'pending' AND deleted_at IS NULL`
    ];

    const results = [];
    for (const indexQuery of indexes) {
      try {
        await TrustlineErrorRecovery.executeWithRecovery(
          () => queryWithRetry(indexQuery, []),
          `create index: ${indexQuery.split(' ')[5]}`
        );
        results.push({ success: true, query: indexQuery });
      } catch (error) {
        // If the error is a connection failure, we should not continue.
        if (error.errorClass?.type === 'network') {
          throw error;
        }
        results.push({ success: false, query: indexQuery, error: error.message });
      }
    }

    return results;
  }
}

/**
 * Main Trustline Manager class that orchestrates all components
 */
export class TrustlineManager {
  constructor() {
    this.signatureVerifier = new TrustlineSignatureVerifier();
    this.rateLimiter = TrustlineRateLimiter;
    this.errorRecovery = TrustlineErrorRecovery;
    this.queryOptimizer = TrustlineQueryOptimizer;
  }

  /**
   * Comprehensive trustline verification with all enhancements
   */
  async verifyTrustlineTransaction(txHash, options = {}) {
    const {
      expectedOperation = 'changeTrust'
    } = options;

    return this.errorRecovery.executeWithRecovery(
      () => this.signatureVerifier.verifyTrustlineSignature(txHash, expectedOperation),
      `verify trustline transaction ${txHash}`
    );
  }

  /**
   * Get merchant trustline configuration with optimization
   */
  async getMerchantTrustlineConfig(merchantId) {
    const [allowedAssets, healthMetrics] = await Promise.all([
      this.queryOptimizer.getMerchantAllowedAssets(merchantId),
      this.queryOptimizer.getTrustlineHealthMetrics(merchantId)
    ]);

    return {
      merchant: allowedAssets.rows[0] || null,
      healthMetrics: healthMetrics.rows || [],
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Initialize trustline manager with database optimizations
   */
  async initialize() {
    try {
      const indexResults = await this.queryOptimizer.createOptimizedIndexes();
      console.log('Trustline Manager initialized with database optimizations:', indexResults);
      return { success: true, indexResults };
    } catch (error) {
      console.error('Failed to initialize Trustline Manager:', error);
      return { success: false, error: error.message };
    }
  }
}

// Export singleton instance
export const trustlineManager = new TrustlineManager();

// Export rate limiting middleware factories
export const createTrustlineRateLimits = (redisClient) => {
  const store = createRedisRateLimitStore({ 
    client: redisClient,
    prefix: `${RATE_LIMIT_REDIS_PREFIX}trustline:`
  });

  return {
    operations: TrustlineRateLimiter.createTrustlineOperationRateLimit({ store }),
    verifications: TrustlineRateLimiter.createTrustlineVerificationRateLimit({ store })
  };
};