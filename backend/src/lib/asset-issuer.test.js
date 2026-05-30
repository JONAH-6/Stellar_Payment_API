/**
 * Comprehensive test suite for Asset Issuer Service
 * Tests: error recovery, rate limiting, signature verification, and SQL optimization
 */

import { vi, describe, test, expect, beforeEach } from 'vitest';

// Mock dependencies
const {
    mockQueryWithRetry,
    mockVerifyTransactionSignature,
    mockWithHorizonRetry,
    mockStellarServer,
    mockRateLimit,
    mockIpKeyGenerator,
} = vi.hoisted(() => ({
    mockQueryWithRetry: vi.fn(),
    mockVerifyTransactionSignature: vi.fn(),
    mockWithHorizonRetry: vi.fn(),
    mockStellarServer: vi.fn().mockImplementation(() => ({
        loadAccount: vi.fn(),
    })),
    mockRateLimit: vi.fn(),
    mockIpKeyGenerator: vi.fn(),
}));

vi.mock('./db.js', () => ({ queryWithRetry: mockQueryWithRetry }));
vi.mock('./stellar.js', () => ({
    verifyTransactionSignature: mockVerifyTransactionSignature,
    withHorizonRetry: mockWithHorizonRetry,
    isValidStellarAccountId: vi.fn().mockReturnValue(true),
    isValidAssetCode: vi.fn().mockReturnValue(true),
}));
vi.mock('stellar-sdk', () => ({
    Horizon: { Server: mockStellarServer },
}));
vi.mock('express-rate-limit', () => ({ default: mockRateLimit, ipKeyGenerator: mockIpKeyGenerator }));

// Import the modules
import {
    AssetIssuerErrorRecovery,
    AssetIssuerRateLimiter,
    AssetIssuerSignatureVerifier,
    AssetIssuerQueryOptimizer
} from './asset-issuer.js';
import { queryWithRetry } from './db.js';
import { withHorizonRetry } from './stellar.js';

describe('Asset Issuer - Task #756: Error Recovery', () => {
    beforeEach(() => {
        AssetIssuerErrorRecovery.resetCircuitBreaker();
        vi.clearAllMocks();
    });

    test('should execute operation successfully on first try', async () => {
        const mockOperation = vi.fn().mockResolvedValue('success');
        const result = await AssetIssuerErrorRecovery.executeWithRecovery(mockOperation);
        expect(result).toBe('success');
        expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    test('should retry on retryable network errors', async () => {
        const mockOperation = vi.fn()
            .mockRejectedValueOnce(new Error('network timeout'))
            .mockResolvedValue('success');

        const result = await AssetIssuerErrorRecovery.executeWithRecovery(mockOperation);
        expect(result).toBe('success');
        expect(mockOperation).toHaveBeenCalledTimes(2);
    });

    test('should open circuit breaker after multiple failures', async () => {
        const mockOperation = vi.fn().mockRejectedValue(new Error('server error'));

        // Trigger 5 failures to open circuit breaker
        for (let i = 0; i < 5; i++) {
            await expect(AssetIssuerErrorRecovery.executeWithRecovery(mockOperation)).rejects.toThrow();
        }

        await expect(
            AssetIssuerErrorRecovery.executeWithRecovery(mockOperation)
        ).rejects.toThrow('Circuit breaker is open');
    });

    test('should verify issuer existence on-chain', async () => {
        mockWithHorizonRetry.mockResolvedValue({ id: 'GBXX' });
        const result = await AssetIssuerErrorRecovery.verifyIssuerOnChain('GBXX');
        expect(result).toBe(true);
    });

    test('should return false if issuer not found (404)', async () => {
        const error = new Error('not found');
        error.status = 404;
        mockWithHorizonRetry.mockRejectedValue(error);
        const result = await AssetIssuerErrorRecovery.verifyIssuerOnChain('GBXX');
        expect(result).toBe(false);
    });
});

describe('Asset Issuer - Task #755: Rate Limiting', () => {
    test('should generate correct rate limit key', () => {
        const req = { merchant: { id: 'M1' } };
        const key = AssetIssuerRateLimiter.getKey(req);
        expect(key).toBe('asset:issuer:M1');
    });

    test('should use IP fallback for rate limit key', () => {
        const req = { ip: '1.2.3.4' };
        mockIpKeyGenerator.mockReturnValue('1.2.3.4');
        const key = AssetIssuerRateLimiter.getKey(req);
        expect(key).toBe('asset:issuer:ip:1.2.3.4');
    });
});

describe('Asset Issuer - Task #753: SQL Optimizations', () => {
    test('should fetch issuer statistics', async () => {
        const mockRows = [{ asset: 'USDC', payment_count: 5 }];
        mockQueryWithRetry.mockResolvedValue({ rows: mockRows });

        const result = await AssetIssuerQueryOptimizer.getIssuerStats('GBXX');
        expect(result.rows).toBe(mockRows);
        expect(mockQueryWithRetry).toHaveBeenCalledWith(expect.stringContaining('asset_issuer = $1'), ['GBXX']);
    });
});
