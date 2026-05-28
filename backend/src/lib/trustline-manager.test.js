/**
 * Comprehensive test suite for Trustline Manager
 * Tests all four optimization tasks: signature verification, rate limiting, error recovery, and SQL optimization
 */

import { vi, describe, test, expect, beforeEach } from 'vitest';

// Mock dependencies first
const {
  mockQueryWithRetry,
  mockVerifyTransactionSignature,
  mockWithHorizonRetry,
  mockIsValidStellarAccountId,
  mockIsValidAssetCode,
  mockStellarTransaction,
  mockStellarServer,
  mockRateLimit,
  mockIpKeyGenerator,
} = vi.hoisted(() => ({
  mockQueryWithRetry: vi.fn(),
  mockVerifyTransactionSignature: vi.fn(),
  mockWithHorizonRetry: vi.fn(),
  mockIsValidStellarAccountId: vi.fn(),
  mockIsValidAssetCode: vi.fn(),
  mockStellarTransaction: vi.fn(),
  mockStellarServer: vi.fn().mockImplementation(() => ({
    transactions: () => ({
      transaction: vi.fn().mockReturnValue({
        call: vi.fn(),
      }),
    }),
  })),
  mockRateLimit: vi.fn(),
  mockIpKeyGenerator: vi.fn(),
}));

vi.mock('./db.js', () => ({ queryWithRetry: mockQueryWithRetry }));
vi.mock('./stellar.js', () => ({
  verifyTransactionSignature: mockVerifyTransactionSignature,
  withHorizonRetry: mockWithHorizonRetry,
  isValidStellarAccountId: mockIsValidStellarAccountId,
  isValidAssetCode: mockIsValidAssetCode,
}));
vi.mock('./rate-limit.js', () => ({
  createRedisRateLimitStore: vi.fn(),
  RATE_LIMIT_REDIS_PREFIX: 'rl:',
}));
vi.mock('stellar-sdk', () => ({
  Horizon: { Server: mockStellarServer },
  Networks: {
    PUBLIC: 'Public Global Stellar Network ; September 2015',
    TESTNET: 'Test SDF Network ; September 2015',
  },
  Transaction: mockStellarTransaction,
}));
vi.mock('express-rate-limit', () => ({ default: mockRateLimit, ipKeyGenerator: mockIpKeyGenerator }));

// Now import the modules
import {
  TrustlineSignatureVerifier,
  TrustlineRateLimiter,
  TrustlineErrorRecovery,
  TrustlineQueryOptimizer,
  TrustlineManager,
  trustlineManager
} from './trustline-manager.js';
import { queryWithRetry } from './db.js';
import { 
  verifyTransactionSignature,
  withHorizonRetry,
  isValidStellarAccountId,
  isValidAssetCode 
} from './stellar.js';
import * as StellarSdk from 'stellar-sdk';
import rateLimit from 'express-rate-limit';

describe('Trustline Manager - Task #595: Cryptographic Signature Verification', () => {
  let verifier;

  beforeEach(() => {
    verifier = new TrustlineSignatureVerifier();
    vi.clearAllMocks();
  });

  describe('TrustlineSignatureVerifier', () => {
    test('should verify valid trustline signature', async () => {
      const txHash = 'valid_tx_hash';
      
      mockVerifyTransactionSignature.mockResolvedValue({
        valid: true,
        reason: 'Signature verification passed',
        isMultiSig: false,
        signatureCount: 1,
        thresholdMet: true
      });

      mockWithHorizonRetry.mockResolvedValue({
        envelope_xdr: 'mock_xdr'
      });

      // Mock Transaction constructor
      const mockTransaction = {
        operations: [{
          type: 'changeTrust',
          asset: {
            isNative: () => false,
            getCode: () => 'USDC',
            getIssuer: () => 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
          },
          limit: '1000'
        }]
      };

      mockStellarTransaction.mockImplementation(() => mockTransaction);
      mockIsValidAssetCode.mockReturnValue(true);
      mockIsValidStellarAccountId.mockReturnValue(true);

      const result = await verifier.verifyTrustlineSignature(txHash);
      expect(result.valid).toBe(true);
      expect(result.trustlineSpecific).toBe(true);
      expect(result.operationType).toBe('changeTrust');
      expect(result.assetCode).toBe('USDC');
    });

    test('should reject invalid transaction hash', async () => {
      const result = await verifier.verifyTrustlineSignature('');
      
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid transaction hash');
    });

    test('should handle signature verification failure', async () => {
      const txHash = 'invalid_tx_hash';
      
      mockVerifyTransactionSignature.mockResolvedValue({
        valid: false,
        reason: 'Invalid signature',
        isMultiSig: false,
        signatureCount: 0,
        thresholdMet: false
      });

      const result = await verifier.verifyTrustlineSignature(txHash);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Basic signature verification failed: Invalid signature');
    });

    test('should validate trustline operation type', async () => {
      const txHash = 'valid_tx_hash';
      
      mockVerifyTransactionSignature.mockResolvedValue({
        valid: true,
        reason: 'Signature verification passed',
        isMultiSig: false,
        signatureCount: 1,
        thresholdMet: true
      });

      mockWithHorizonRetry.mockResolvedValue({
        envelope_xdr: 'mock_xdr'
      });

      mockStellarTransaction.mockImplementation(() => ({
        operations: [{
          type: 'payment', // Wrong operation type
          destination: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          amount: '100'
        }]
      }));

      const result = await verifier.verifyTrustlineSignature(txHash);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('No trustline operations found');
    });

    test('should cache verification results', async () => {
      const txHash = 'cached_tx_hash';
      
      mockVerifyTransactionSignature.mockResolvedValue({
        valid: true,
        reason: 'Signature verification passed',
        isMultiSig: false,
        signatureCount: 1,
        thresholdMet: true
      });

      mockWithHorizonRetry.mockResolvedValue({
        envelope_xdr: 'mock_xdr'
      });

      mockStellarTransaction.mockImplementation(() => ({
        operations: [{
          type: 'changeTrust',
          asset: {
            isNative: () => false,
            getCode: () => 'USDC',
            getIssuer: () => 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
          },
          limit: '1000'
        }]
      }));

      mockIsValidAssetCode.mockReturnValue(true);
      mockIsValidStellarAccountId.mockReturnValue(true);

      // First call
      await verifier.verifyTrustlineSignature(txHash);
      
      // Second call should use cache
      await verifier.verifyTrustlineSignature(txHash);

      expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Trustline Manager - Task #594: Rate Limiting', () => {
  describe('TrustlineRateLimiter', () => {
    test('should generate correct rate limit key for merchant', () => {
      const req = {
        merchant: { id: 'merchant_123' },
        ip: '192.168.1.1'
      };

      const key = TrustlineRateLimiter.getTrustlineOperationKey(req);
      expect(key).toBe('trustline:ops:merchant:merchant_123');
    });

    test('should generate correct rate limit key for API key', () => {
      const req = {
        headers: { 'x-api-key': 'test_api_key' },
        ip: '192.168.1.1'
      };
      mockIpKeyGenerator.mockReturnValue('hashed-ip');
      const key = TrustlineRateLimiter.getTrustlineOperationKey(req);
      expect(key).toMatch(/^trustline:ops:api:[a-f0-9]{16}$/);
    });

    test('should generate correct rate limit key for IP', () => {
      const req = {
        ip: '192.168.1.1'
      };
      mockIpKeyGenerator.mockReturnValue('192.168.1.1');
      const key = TrustlineRateLimiter.getTrustlineOperationKey(req);
      expect(key).toBe('trustline:ops:ip:192.168.1.1');
    });

    test('should create trustline operation rate limiter', () => {
      const mockStore = {};
      const rateLimitFactory = mockRateLimit;

      TrustlineRateLimiter.createTrustlineOperationRateLimit({
        store: mockStore,
        rateLimitFactory: rateLimitFactory
      });

      expect(rateLimitFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          windowMs: 5 * 60 * 1000, // 5 minutes
          max: 20,
          keyGenerator: TrustlineRateLimiter.getTrustlineOperationKey
        })
      );
    });

    test('should skip rate limiting for premium merchants', () => {
      const mockStore = {};
      const rateLimitFactory = mockRateLimit;

      TrustlineRateLimiter.createTrustlineOperationRateLimit({
        store: mockStore,
        rateLimitFactory: rateLimitFactory
      });

      const config = rateLimitFactory.mock.calls[0][0];
      
      // Test skip function for premium merchant
      const premiumReq = {
        merchant: { metadata: { tier: 'premium' } }
      };
      expect(config.skip(premiumReq)).toBe(true);

      // Test skip function for regular merchant
      const regularReq = {
        merchant: { metadata: { tier: 'basic' } }
      };
      expect(config.skip(regularReq)).toBe(false);
    });
  });
});

describe('Trustline Manager - Task #597: Error Recovery', () => {
  beforeEach(() => {
    // Reset circuit breaker state
    TrustlineErrorRecovery.resetCircuitBreaker();
    vi.clearAllMocks();
  });

  describe('TrustlineErrorRecovery', () => {
    test('should execute operation successfully on first try', async () => {
      const mockOperation = vi.fn().mockResolvedValue('success');
      
      const result = await TrustlineErrorRecovery.executeWithRecovery(mockOperation);
      
      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    test('should retry on retryable errors', async () => {
      const mockOperation = vi.fn()
        .mockRejectedValueOnce(new Error('network timeout'))
        .mockRejectedValueOnce(new Error('connection refused'))
        .mockResolvedValue('success');
      
      const result = await TrustlineErrorRecovery.executeWithRecovery(mockOperation);
      
      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(3);
    });

    test('should not retry on non-retryable errors', async () => {
      const error = new Error('asset not found');
      error.status = 404;
      const mockOperation = vi.fn().mockRejectedValue(error);
      
      await expect(
        TrustlineErrorRecovery.executeWithRecovery(mockOperation)
      ).rejects.toThrow('asset not found');
      
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    test('should classify network errors as retryable', () => {
      const networkError = new Error('network timeout');
      const classification = TrustlineErrorRecovery.classifyError(networkError);
      
      expect(classification.type).toBe('network');
      expect(classification.retryable).toBe(true);
      expect(classification.priority).toBe('high');
    });

    test('should classify rate limit errors as retryable with low priority', () => {
      const rateLimitError = new Error('rate limit exceeded');
      rateLimitError.status = 429;
      const classification = TrustlineErrorRecovery.classifyError(rateLimitError);
      
      expect(classification.type).toBe('rate_limit');
      expect(classification.retryable).toBe(true);
      expect(classification.priority).toBe('low');
    });

    test('should classify client errors as non-retryable', () => {
      const clientError = new Error('bad request');
      clientError.status = 400;
      const classification = TrustlineErrorRecovery.classifyError(clientError);
      
      expect(classification.type).toBe('client_error');
      expect(classification.retryable).toBe(false);
    });

    test('should open circuit breaker after threshold failures', async () => {
      vi.spyOn(TrustlineErrorRecovery, 'sleep').mockResolvedValue(undefined);
      const mockOperation = vi.fn().mockRejectedValue(new Error('server error'));
      
      // Trigger multiple failures to open circuit breaker
      for (let i = 0; i < 5; i++) {
        await expect(TrustlineErrorRecovery.executeWithRecovery(mockOperation)).rejects.toThrow();
      }
      
      // Circuit breaker should now be open
      await expect(
        TrustlineErrorRecovery.executeWithRecovery(mockOperation)
      ).rejects.toThrow('Circuit breaker is open');

      vi.restoreAllMocks();
    });

    test('should calculate retry delay with exponential backoff', () => {
      const delay1 = TrustlineErrorRecovery.calculateRetryDelay(1, 'high');
      const delay2 = TrustlineErrorRecovery.calculateRetryDelay(2, 'high');
      const delay3 = TrustlineErrorRecovery.calculateRetryDelay(3, 'high');
      
      expect(delay2).toBeGreaterThan(delay1);
      expect(delay3).toBeGreaterThan(delay2);
      expect(delay3).toBeLessThanOrEqual(30000); // Capped at 30 seconds
    });
  });
});

describe('Trustline Manager - Task #596: SQL Query Optimization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('TrustlineQueryOptimizer', () => {
    test('should get merchant allowed assets', async () => {
      const merchantId = 'merchant_123';
      const mockResult = {
        rows: [{
          id: merchantId,
          allowed_issuers: ['GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'],
          payment_limits: { USDC: { min: 1, max: 10000 } },
          issuer_count: 1
        }]
      };

      queryWithRetry.mockResolvedValue(mockResult);

      const result = await TrustlineQueryOptimizer.getMerchantAllowedAssets(merchantId);

      expect(result).toBe(mockResult);
      expect(mockQueryWithRetry).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        [merchantId]
      );
    });

    test('should get payment statistics by asset', async () => {
      const merchantId = 'merchant_123';
      const mockResult = {
        rows: [{
          asset: 'USDC',
          asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          payment_count: 10,
          total_volume: 1000,
          avg_amount: 100,
          confirmed_count: 8,
          pending_count: 1,
          failed_count: 1
        }]
      };

      queryWithRetry.mockResolvedValue(mockResult);

      const result = await TrustlineQueryOptimizer.getPaymentStatsByAsset(merchantId);

      expect(result).toBe(mockResult);
      expect(mockQueryWithRetry).toHaveBeenCalledWith(
        expect.stringContaining('GROUP BY p.asset, p.asset_issuer'),
        [merchantId]
      );
    });

    test('should find payments by asset with filters', async () => {
      const merchantId = 'merchant_123';
      const assetCode = 'USDC';
      const assetIssuer = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
      const options = {
        status: 'confirmed',
        limit: 50,
        offset: 0
      };

      const mockResult = {
        rows: [{
          id: 'payment_123',
          amount: 100,
          asset: assetCode,
          asset_issuer: assetIssuer,
          status: 'confirmed'
        }]
      };

      queryWithRetry.mockResolvedValue(mockResult);

      const result = await TrustlineQueryOptimizer.findPaymentsByAsset(
        merchantId, 
        assetCode, 
        assetIssuer, 
        options
      );

      expect(result).toBe(mockResult);
      expect(mockQueryWithRetry).toHaveBeenCalledWith(
        expect.stringContaining('WHERE'),
        expect.arrayContaining([merchantId, assetCode, assetIssuer, 'confirmed', 50, 0])
      );
    });

    test('should get trustline health metrics', async () => {
      const merchantId = 'merchant_123';
      const mockResult = {
        rows: [{
          asset: 'USDC',
          asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          total_payments: 100,
          failed_payments: 5,
          failure_rate_percent: 5.0,
          avg_completion_time: 30,
          issuer_allowed: true
        }]
      };

      queryWithRetry.mockResolvedValue(mockResult);

      const result = await TrustlineQueryOptimizer.getTrustlineHealthMetrics(merchantId);

      expect(result).toBe(mockResult);
      expect(mockQueryWithRetry).toHaveBeenCalledWith(
        expect.stringContaining('WITH asset_stats AS'),
        [merchantId]
      );
    });

    test('should create optimized indexes', async () => {
      queryWithRetry.mockResolvedValue({ rows: [] });

      const result = await TrustlineQueryOptimizer.createOptimizedIndexes();

      expect(result).toHaveLength(4); // Four indexes
      expect(result.every(r => r.success)).toBe(true);
      expect(mockQueryWithRetry).toHaveBeenCalledTimes(4);
    });

    test('should handle index creation errors gracefully', async () => {
      queryWithRetry
        .mockResolvedValueOnce({ rows: [] }) // First index succeeds
        .mockRejectedValueOnce(new Error('Index already exists')) // Second fails
        .mockResolvedValueOnce({ rows: [] }) // Third succeeds
        .mockResolvedValueOnce({ rows: [] }); // Fourth succeeds

      const result = await TrustlineQueryOptimizer.createOptimizedIndexes();

      expect(result).toHaveLength(4);
      expect(result[0].success).toBe(true);
      expect(result[1].success).toBe(false);
      expect(result[1].error).toContain('Index already exists');
      expect(result[2].success).toBe(true);
      expect(result[3].success).toBe(true);
    });
  });
});

describe('Trustline Manager - Integration Tests', () => {
  let manager;

  beforeEach(() => {
    manager = new TrustlineManager();
    vi.clearAllMocks();
  });

  test('should verify trustline transaction with all enhancements', async () => {
    const txHash = 'integration_test_hash';
    
    verifyTransactionSignature.mockResolvedValue({
      valid: true,
      reason: 'Signature verification passed',
      isMultiSig: false,
      signatureCount: 1,
      thresholdMet: true
    });

    withHorizonRetry.mockResolvedValue({
      envelope_xdr: 'mock_xdr'
    });

    StellarSdk.Transaction.mockImplementation(() => ({
      operations: [{
        type: 'changeTrust',
        asset: {
          isNative: () => false,
          getCode: () => 'USDC',
          getIssuer: () => 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
        },
        limit: '1000'
      }]
    }));

    isValidAssetCode.mockReturnValue(true);
    isValidStellarAccountId.mockReturnValue(true);

    const result = await manager.verifyTrustlineTransaction(txHash);

    expect(result.valid).toBe(true);
    expect(result.trustlineSpecific).toBe(true);
  });

  test('should get merchant trustline configuration', async () => {
    const merchantId = 'merchant_123';
    
    queryWithRetry
      .mockResolvedValueOnce({
        rows: [{
          id: merchantId,
          allowed_issuers: ['GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'],
          payment_limits: { USDC: { min: 1, max: 10000 } }
        }]
      })
      .mockResolvedValueOnce({
        rows: [{
          asset: 'USDC',
          total_payments: 100,
          failure_rate_percent: 2.0
        }]
      });

    const result = await manager.getMerchantTrustlineConfig(merchantId);

    expect(result.merchant).toBeDefined();
    expect(result.healthMetrics).toBeDefined();
    expect(result.timestamp).toBeDefined();
  });

  test('should initialize with database optimizations', async () => {
    queryWithRetry.mockResolvedValue({ rows: [] });

    const result = await manager.initialize();

    expect(result.success).toBe(true);
    expect(result.indexResults).toBeDefined();
  });

  test('should handle initialization errors gracefully', async () => {
    queryWithRetry.mockRejectedValue(new Error('Database connection failed'));

    const result = await manager.initialize();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Database connection failed');
  });
});

describe('Trustline Manager - Singleton Instance', () => {
  test('should export singleton instance', () => {
    expect(trustlineManager).toBeInstanceOf(TrustlineManager);
  });

  test('should have all required components', () => {
    expect(trustlineManager.signatureVerifier).toBeInstanceOf(TrustlineSignatureVerifier);
    expect(trustlineManager.rateLimiter).toBe(TrustlineRateLimiter);
    expect(trustlineManager.errorRecovery).toBe(TrustlineErrorRecovery);
    expect(trustlineManager.queryOptimizer).toBe(TrustlineQueryOptimizer);
  });
});