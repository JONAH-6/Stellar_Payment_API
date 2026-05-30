/**
 * Asset Issuer Service - Enhanced error recovery, rate limiting, signature verification, and optimized queries
 * 
 * This module provides comprehensive asset issuer management functionality with:
 * - Task #756: Enhanced error recovery mechanisms
 * - Task #755: Rate limiting for asset issuer operations
 * - Task #754: Cryptographic signature verification for asset operations
 * - Task #753: Optimized SQL queries for asset and issuer data
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
import { ipKeyGenerator } from "express-rate-limit";
import rateLimit from "express-rate-limit";

// Rate limiting constants
export const ASSET_ISSUER_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
export const ASSET_ISSUER_RATE_LIMIT_MAX = 50;

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
 * Task #756: Enhanced error recovery for asset issuer operations
 */
export class AssetIssuerErrorRecovery {

    static async executeWithRecovery(operation, context = "asset issuer operation") {
        if (this.isCircuitBreakerOpen()) {
            throw new Error(`Circuit breaker is open for ${context}. Service temporarily unavailable.`);
        }

        let lastError = null;

        for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
            try {
                const result = await operation();
                this.resetCircuitBreaker();
                return result;
            } catch (error) {
                lastError = error;
                const errorClass = this.classifyError(error);

                if (!errorClass.retryable || attempt === MAX_RETRY_ATTEMPTS) {
                    this.recordFailure();
                    throw this.enhanceError(error, context, attempt, errorClass);
                }

                const delay = this.calculateRetryDelay(attempt, errorClass.priority);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        this.recordFailure();
        throw this.enhanceError(lastError, context, MAX_RETRY_ATTEMPTS, this.classifyError(lastError));
    }

    static classifyError(error) {
        const message = error.message?.toLowerCase() || '';
        const status = error.status || error.response?.status;

        if (
            message.includes('network') ||
            message.includes('timeout') ||
            message.includes('connection') ||
            status === 502 ||
            status === 503 ||
            status === 504
        ) {
            return { type: 'network', retryable: true, priority: 'high', reason: 'Network connectivity issue' };
        }

        if (status === 429 || message.includes('rate limit')) {
            return { type: 'rate_limit', retryable: true, priority: 'low', reason: 'Rate limit exceeded' };
        }

        if (status >= 500 && status < 600) {
            return { type: 'server_error', retryable: true, priority: 'medium', reason: 'Server error' };
        }

        return { type: 'client_error', retryable: false, priority: 'none', reason: 'Client error' };
    }

    static calculateRetryDelay(attempt, priority = 'medium') {
        const baseDelay = RETRY_DELAY_BASE_MS;
        const multiplier = priority === 'high' ? 1 : priority === 'low' ? 3 : 2;
        const exponentialDelay = baseDelay * Math.pow(2, attempt - 1) * multiplier;
        const jitter = exponentialDelay * 0.25 * (Math.random() - 0.5);
        return Math.min(exponentialDelay + jitter, 30000);
    }

    static enhanceError(originalError, context, attempts, errorClass) {
        const enhanced = new Error(`${context} failed after ${attempts} attempts: ${originalError.message} (${errorClass.reason})`);
        enhanced.originalError = originalError;
        enhanced.context = context;
        enhanced.attempts = attempts;
        enhanced.errorClass = errorClass;
        enhanced.status = originalError.status || 500;
        return enhanced;
    }

    static isCircuitBreakerOpen() {
        if (!circuitBreakerState.isOpen) return false;
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

    /**
     * Verify that an asset issuer exists on-chain with robust error recovery
     */
    static async verifyIssuerOnChain(issuer) {
        return this.executeWithRecovery(
            async () => {
                const NETWORK = (process.env.STELLAR_NETWORK || "testnet").toLowerCase();
                const server = new StellarSdk.Horizon.Server(
                    process.env.STELLAR_HORIZON_URL ||
                    (NETWORK === "public"
                        ? "https://horizon.stellar.org"
                        : "https://horizon-testnet.stellar.org")
                );

                try {
                    await withHorizonRetry(
                        () => server.loadAccount(issuer),
                        `verify issuer ${issuer}`
                    );
                    return true;
                } catch (error) {
                    if (error.status === 404) {
                        return false;
                    }
                    throw error;
                }
            },
            "verify issuer on-chain"
        );
    }
}

/**
 * Task #755: Rate limiting for asset issuer operations
 */
export class AssetIssuerRateLimiter {
    static getKey(req) {
        const merchantId = req?.merchant?.id;
        const ipKey = ipKeyGenerator(req?.ip ?? req?.socket?.remoteAddress ?? "unknown-ip");
        return merchantId ? `asset:issuer:${merchantId}` : `asset:issuer:ip:${ipKey}`;
    }

    static createRateLimiter({ store } = {}) {
        return rateLimit({
            windowMs: ASSET_ISSUER_RATE_LIMIT_WINDOW_MS,
            max: ASSET_ISSUER_RATE_LIMIT_MAX,
            message: { error: "Too many asset issuer requests. Please slow down." },
            standardHeaders: true,
            legacyHeaders: false,
            keyGenerator: this.getKey,
            store,
            passOnStoreError: true
        });
    }
}

/**
 * Task #754: Cryptographic signature verification for asset operations
 */
export class AssetIssuerSignatureVerifier {
    static async verifyOperation(txHash) {
        return AssetIssuerErrorRecovery.executeWithRecovery(
            async () => {
                const verification = await verifyTransactionSignature(txHash);
                if (!verification.valid) {
                    return { valid: false, reason: verification.reason };
                }

                // Additional asset-issuer specific checks could go here
                return { valid: true, verification };
            },
            "verify asset issuer operation"
        );
    }
}

/**
 * Task #753: Optimized SQL queries for asset and issuer data
 */
export class AssetIssuerQueryOptimizer {
    static async getIssuerStats(issuer) {
        const query = `
      SELECT 
        asset,
        COUNT(*) as payment_count,
        SUM(amount) as total_volume,
        MAX(created_at) as last_activity
      FROM payments
      WHERE asset_issuer = $1
        AND deleted_at IS NULL
      GROUP BY asset
      ORDER BY total_volume DESC
    `;

        return AssetIssuerErrorRecovery.executeWithRecovery(
            () => queryWithRetry(query, [issuer]),
            `get stats for issuer ${issuer}`
        );
    }

    static async findPaymentsByAssetAndIssuer(assetCode, assetIssuer, limit = 50) {
        const query = `
      SELECT id, amount, asset, asset_issuer, status, created_at
      FROM payments
      WHERE asset = $1 AND asset_issuer = $2
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT $3
    `;

        return AssetIssuerErrorRecovery.executeWithRecovery(
            () => queryWithRetry(query, [assetCode, assetIssuer, limit]),
            `find payments for asset ${assetCode} by issuer ${assetIssuer}`
        );
    }
}
