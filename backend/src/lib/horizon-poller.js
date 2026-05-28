/**
 * Background Horizon Poller — Ledger Monitor
 *
 * Periodically fetches all pending payments from the DB and checks Horizon
 * for matching transactions. When found, updates status to "confirmed" and
 * fires webhooks/SSE/email — exactly the same logic as the verify-payment route.
 *
 * This ensures payments confirm automatically even if the customer closes the
 * browser before the frontend calls /api/verify-payment/:id.
 *
 * Error Recovery (Issue #627)
 * ───────────────────────────
 * The poller is designed to be resilient against transient failures:
 *
 *  • Horizon calls are rate-limited inside the monitor to avoid accidental
 *    endpoint abuse during large pending-payment batches.
 *  • Per-payment errors are isolated — one bad payment never aborts the cycle.
 *  • Horizon connectivity failures trigger exponential back-off so the poller
 *    does not hammer an unavailable endpoint.
 *  • A consecutive-failure counter gates circuit-breaker behaviour: after
 *    MAX_CONSECUTIVE_FAILURES the poller pauses for CIRCUIT_BREAKER_RESET_MS
 *    before resuming normal operation.
 *  • Signature verification failures are logged with full context and the
 *    payment is skipped (not failed) so it can be re-checked next cycle.
 *  • Wrong-amount transactions are signature-verified before status changes.
 *  • DB update conflicts (unique constraint on tx_id) are handled gracefully.
 *  • All error paths emit structured log entries for observability.
 */

import { supabase } from "./supabase.js";
import {
  findMatchingPayment,
  findAnyRecentPayment,
  verifyTransactionSignature,
} from "./stellar.js";
import { sendWebhook, isEventSubscribed } from "./webhooks.js";
import { sendReceiptEmail } from "./email.js";
import { renderReceiptEmail } from "./email-templates.js";
import { getPayloadForVersion } from "../webhooks/resolver.js";
import { streamManager } from "./stream-manager.js";
import { connectRedisClient, invalidatePaymentCache } from "./redis.js";
import { logger } from "./logger.js";
import {
  paymentConfirmedCounter,
  paymentConfirmationLatency,
} from "./metrics.js";

// ── Tuning constants ──────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 15_000;       // 15 seconds between normal cycles
const BATCH_SIZE = 50;                 // max pending payments per cycle
const MAX_AGE_HOURS = 24;             // ignore payments older than 24 h (likely abandoned)
const HORIZON_REQUESTS_PER_SECOND = parsePositiveInt(
  process.env.LEDGER_MONITOR_HORIZON_RPS,
  5,
);
const TRANSIENT_DB_RETRY_ATTEMPTS = 2;
const MERCHANT_NOTIFICATION_FIELDS = [
  "webhook_secret",
  "webhook_version",
  "notification_email",
  "email",
  "business_name",
  "webhook_custom_headers",
].join(", ");

/** Back-off schedule (ms) applied after consecutive Horizon fetch failures. */
const BACKOFF_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];

/**
 * Number of consecutive full-cycle failures before the circuit breaker opens.
 * A "full-cycle failure" means the DB fetch itself failed, not individual
 * payment errors (those are always isolated).
 */
const MAX_CONSECUTIVE_FAILURES = 5;

/** How long the circuit breaker stays open before attempting recovery (ms). */
const CIRCUIT_BREAKER_RESET_MS = 5 * 60_000; // 5 minutes

// ── Module-level state ────────────────────────────────────────────────────────

let _io = null;
let _timer = null;
let _running = false;

/** Counts consecutive cycles where the DB fetch itself failed. */
let _consecutiveFailures = 0;

/** Timestamp (ms) when the circuit breaker was tripped. 0 = not tripped. */
let _circuitBreakerOpenAt = 0;

/** Current back-off delay index into BACKOFF_DELAYS_MS. */
let _backoffIndex = 0;
let _rateLimiter = createLedgerMonitorRateLimiter({
  maxPerSecond: HORIZON_REQUESTS_PER_SECOND,
});

// ── Public API ────────────────────────────────────────────────────────────────

export function startHorizonPoller(io) {
  _io = io;
  _timer = setInterval(pollPendingPayments, POLL_INTERVAL_MS);
  // Run immediately on startup too
  pollPendingPayments();
  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Horizon poller started");
}

export function stopHorizonPoller() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  logger.info("Horizon poller stopped");
}

/**
 * Expose internal state for testing / health-check endpoints.
 * @returns {{ consecutiveFailures: number, circuitBreakerOpen: boolean, backoffIndex: number }}
 */
export function getPollerHealth() {
  const circuitBreakerOpen =
    _circuitBreakerOpenAt > 0 &&
    Date.now() - _circuitBreakerOpenAt < CIRCUIT_BREAKER_RESET_MS;

  return {
    consecutiveFailures: _consecutiveFailures,
    circuitBreakerOpen,
    backoffIndex: _backoffIndex,
    horizonRequestsPerSecond: _rateLimiter.maxPerSecond,
  };
}

/**
 * Reset error-recovery state. Useful in tests and after manual intervention.
 */
export function resetPollerState() {
  _consecutiveFailures = 0;
  _circuitBreakerOpenAt = 0;
  _backoffIndex = 0;
  _rateLimiter.reset();
}

/**
 * Run a single poll cycle immediately. Exposed for testing.
 * @returns {Promise<void>}
 */
export async function pollOnce() {
  return pollPendingPayments();
}

export function createLedgerMonitorRateLimiter({
  maxPerSecond,
  burst = maxPerSecond,
  now = () => Date.now(),
  sleepFn = sleep,
} = {}) {
  const safeMax = Math.max(1, Number(maxPerSecond) || 1);
  const safeBurst = Math.max(1, Number(burst) || safeMax);
  let tokens = safeBurst;
  let lastRefillAt = now();

  function refill() {
    const current = now();
    const elapsedMs = Math.max(0, current - lastRefillAt);
    tokens = Math.min(safeBurst, tokens + (elapsedMs / 1000) * safeMax);
    lastRefillAt = current;
  }

  return {
    maxPerSecond: safeMax,
    async waitForSlot() {
      refill();
      if (tokens >= 1) {
        tokens -= 1;
        return;
      }

      const delayMs = Math.ceil(((1 - tokens) / safeMax) * 1000);
      logger.warn(
        { delayMs, maxPerSecond: safeMax },
        "Horizon poller: rate limit reached — delaying Horizon request",
      );
      await sleepFn(delayMs);
      refill();
      tokens = Math.max(0, tokens - 1);
    },
    reset() {
      tokens = safeBurst;
      lastRefillAt = now();
    },
  };
}

export function setLedgerMonitorRateLimiterForTest(rateLimiter) {
  _rateLimiter = rateLimiter;
}

// ── Core polling loop ─────────────────────────────────────────────────────────

async function pollPendingPayments() {
  if (_running) return; // skip if previous cycle still running
  _running = true;

  try {
    // ── Circuit breaker check ─────────────────────────────────────────────
    if (_circuitBreakerOpenAt > 0) {
      const elapsed = Date.now() - _circuitBreakerOpenAt;
      if (elapsed < CIRCUIT_BREAKER_RESET_MS) {
        logger.warn(
          { remainingMs: CIRCUIT_BREAKER_RESET_MS - elapsed },
          "Horizon poller: circuit breaker open — skipping cycle",
        );
        return;
      }
      // Reset circuit breaker and try again
      logger.info("Horizon poller: circuit breaker reset — resuming normal operation");
      _circuitBreakerOpenAt = 0;
      _consecutiveFailures = 0;
      _backoffIndex = 0;
    }

    const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();

    const { data: pending, error } = await fetchPendingPayments(cutoff);

    if (error) {
      _consecutiveFailures += 1;
      logger.warn(
        { err: error, consecutiveFailures: _consecutiveFailures },
        "Horizon poller: failed to fetch pending payments",
      );

      // Apply back-off delay before next cycle
      const delay = BACKOFF_DELAYS_MS[Math.min(_backoffIndex, BACKOFF_DELAYS_MS.length - 1)];
      _backoffIndex = Math.min(_backoffIndex + 1, BACKOFF_DELAYS_MS.length - 1);
      logger.info({ delayMs: delay }, "Horizon poller: applying back-off delay");
      await sleep(delay);

      // Trip circuit breaker after too many consecutive failures
      if (_consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        _circuitBreakerOpenAt = Date.now();
        logger.error(
          { consecutiveFailures: _consecutiveFailures, resetMs: CIRCUIT_BREAKER_RESET_MS },
          "Horizon poller: circuit breaker tripped — pausing polling",
        );
      }
      return;
    }

    // Successful DB fetch — reset failure counters
    if (_consecutiveFailures > 0) {
      logger.info(
        { previousFailures: _consecutiveFailures },
        "Horizon poller: DB fetch recovered — resetting failure counters",
      );
      _consecutiveFailures = 0;
      _backoffIndex = 0;
    }

    if (!pending || pending.length === 0) return;

    logger.info({ count: pending.length }, "Horizon poller: checking pending payments");

    // Group by recipient+asset to process same-address payments sequentially.
    // This prevents two payments with identical recipient+amount from both
    // claiming the same on-chain transaction in the same cycle.
    const groups = new Map();
    for (const p of pending) {
      const key = `${p.recipient}:${p.asset}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }

    // Process each group sequentially, different groups in parallel
    const merchantConfigCache = new Map();
    await Promise.allSettled(
      Array.from(groups.values()).map(async (group) => {
        for (const p of group) {
          await checkPayment(p, { merchantConfigCache });
        }
      })
    );

  } catch (err) {
    logger.warn({ err }, "Horizon poller: unexpected error in poll cycle");
  } finally {
    _running = false;
  }
}

// ── Per-payment check ─────────────────────────────────────────────────────────

async function checkPayment(payment, { merchantConfigCache = new Map() } = {}) {
  try {
    // Guard: skip if essential fields are missing
    if (!payment.asset || !payment.recipient) {
      logger.warn(
        { paymentId: payment.id },
        "Horizon poller: skipping payment with missing asset or recipient",
      );
      return;
    }

    let match;
    try {
      match = await withLedgerMonitorRateLimit(
        () => findMatchingPayment({
          recipient: payment.recipient,
          amount: payment.amount,
          assetCode: payment.asset,
          assetIssuer: payment.asset_issuer,
          memo: payment.memo,
          memoType: payment.memo_type,
          createdAt: payment.created_at,
        }),
        { paymentId: payment.id, operation: "findMatchingPayment" },
      );
    } catch (horizonErr) {
      // Horizon errors during payment lookup are transient — log and skip.
      // The payment will be retried on the next poll cycle.
      logger.warn(
        { err: horizonErr, paymentId: payment.id },
        "Horizon poller: Horizon error during payment lookup — will retry next cycle",
      );
      return;
    }

    // ── Signature verification (Issue #630) ──────────────────────────────
    if (match) {
      if (!(await verifyLedgerTransactionSignature(match.transaction_hash, payment.id))) {
        return;
      }
    }

    if (!match) {
      logger.info({ paymentId: payment.id }, "Horizon poller: no match yet");

      // Check for wrong-amount payment
      let anyPayment;
      try {
        anyPayment = await withLedgerMonitorRateLimit(
          () => findAnyRecentPayment({
            recipient: payment.recipient,
            assetCode: payment.asset,
            assetIssuer: payment.asset_issuer,
            createdAt: payment.created_at,
          }),
          { paymentId: payment.id, operation: "findAnyRecentPayment" },
        );
      } catch (horizonErr) {
        logger.warn(
          { err: horizonErr, paymentId: payment.id },
          "Horizon poller: Horizon error during wrong-amount check — skipping",
        );
        return;
      }

      if (anyPayment) {
        if (!(await verifyLedgerTransactionSignature(anyPayment.transaction_hash, payment.id))) {
          return;
        }

        const received = Number(anyPayment.received_amount);
        const expected = Number(payment.amount);
        const diff = received - expected;

        if (diff < -0.0000001) {
          // Underpayment — mark failed
          await retryTransientDbOperation(
            () => supabase.from("payments").update({
              status: "failed",
              tx_id: anyPayment.transaction_hash,
              metadata: {
                ...(payment.metadata || {}),
                failure_reason: "underpayment",
                expected_amount: expected,
                received_amount: received,
                shortfall: Number((expected - received).toFixed(7)),
              },
            }).eq("id", payment.id).eq("status", "pending"),
            { paymentId: payment.id, operation: "markUnderpaymentFailed" },
          );

          await safeInvalidatePaymentCache(payment.id);
          logger.info(
            { paymentId: payment.id, expected, received },
            "Horizon poller: underpayment detected — marked failed",
          );

          streamManager.notify(payment.id, "payment.failed", {
            status: "failed",
            reason: "underpayment",
            expected_amount: expected,
            received_amount: received,
          });
          if (_io && payment.merchant_id) {
            _io.to(`merchant:${payment.merchant_id}`).emit("payment:failed", {
              id: payment.id,
              reason: "underpayment",
              expected_amount: expected,
              received_amount: received,
            });
          }
        } else if (diff > 0.0000001) {
          // Overpayment — confirm but flag
          const latencySeconds = (Date.now() - new Date(payment.created_at).getTime()) / 1000;
          const { data: updated } = await retryTransientDbOperation(
            () => supabase.from("payments").update({
              status: "confirmed",
              tx_id: anyPayment.transaction_hash,
              completion_duration_seconds: Math.floor(latencySeconds),
              metadata: {
                ...(payment.metadata || {}),
                overpayment: true,
                expected_amount: expected,
                received_amount: received,
                excess: Number((received - expected).toFixed(7)),
              },
            }).eq("id", payment.id).eq("status", "pending").is("tx_id", null).select("id").maybeSingle(),
            { paymentId: payment.id, operation: "confirmOverpayment" },
          );

          if (!updated) return; // already claimed

          await safeInvalidatePaymentCache(payment.id);
          logger.info(
            { paymentId: payment.id, expected, received },
            "Horizon poller: overpayment — confirmed with flag",
          );
          streamManager.notify(payment.id, "payment.confirmed", {
            status: "confirmed",
            tx_id: anyPayment.transaction_hash,
            overpayment: true,
          });
          if (_io && payment.merchant_id) {
            _io.to(`merchant:${payment.merchant_id}`).emit("payment:confirmed", {
              id: payment.id,
              tx_id: anyPayment.transaction_hash,
              overpayment: true,
            });
          }
        }
      }
      return;
    }

    // Guard: ensure this tx_hash hasn't already confirmed a different payment
    const { data: existing } = await supabase
      .from("payments")
      .select("id")
      .eq("tx_id", match.transaction_hash)
      .neq("id", payment.id)
      .maybeSingle();

    if (existing) {
      logger.warn(
        { paymentId: payment.id, txHash: match.transaction_hash },
        "Horizon poller: tx_hash already used by another payment — skipping",
      );
      return;
    }

    const createdAt = new Date(payment.created_at);
    const latencySeconds = (Date.now() - createdAt.getTime()) / 1000;

    // Atomic update: only succeeds if tx_id is still NULL (not claimed by another payment).
    // The unique index on tx_id provides the final database-level guarantee.
    const { data: updated, error: updateError } = await retryTransientDbOperation(
      () => supabase
        .from("payments")
        .update({
          status: "confirmed",
          tx_id: match.transaction_hash,
          completion_duration_seconds: Math.floor(latencySeconds),
        })
        .eq("id", payment.id)
        .eq("status", "pending")
        .is("tx_id", null)
        .select("id")
        .maybeSingle(),
      { paymentId: payment.id, operation: "confirmPayment" },
    );

    if (updateError) {
      // Unique constraint violation — another payment already claimed this tx
      if (updateError.code === "23505") {
        logger.warn(
          { paymentId: payment.id, txHash: match.transaction_hash },
          "Horizon poller: tx_hash already claimed by another payment (unique constraint)",
        );
        return;
      }
      logger.warn(
        { err: updateError, paymentId: payment.id },
        "Horizon poller: DB update failed",
      );
      return;
    }

    // If updated is null, the row was already confirmed or claimed — skip
    if (!updated) {
      logger.info(
        { paymentId: payment.id },
        "Horizon poller: payment already processed, skipping",
      );
      return;
    }

    // Invalidate Redis cache
    await safeInvalidatePaymentCache(payment.id);

    // Metrics
    paymentConfirmedCounter.inc({ asset: payment.asset });
    paymentConfirmationLatency.observe({ asset: payment.asset }, latencySeconds);

    logger.info(
      { paymentId: payment.id, txHash: match.transaction_hash },
      "Horizon poller: payment confirmed",
    );

    // SSE → customer checkout page
    streamManager.notify(payment.id, "payment.confirmed", {
      status: "confirmed",
      tx_id: match.transaction_hash,
    });

    // Socket.io → merchant dashboard
    if (_io && payment.merchant_id) {
      _io.to(`merchant:${payment.merchant_id}`).emit("payment:confirmed", {
        id: payment.id,
        amount: payment.amount,
        asset: payment.asset,
        asset_issuer: payment.asset_issuer,
        recipient: payment.recipient,
        tx_id: match.transaction_hash,
        confirmed_at: new Date().toISOString(),
      });
    }

    // Webhook
    const merchant = await loadMerchantNotificationConfig(payment.merchant_id, merchantConfigCache);
    if (merchant) {
      const webhookPayload = getPayloadForVersion(
        merchant.webhook_version || "v1",
        "payment.confirmed",
        {
          payment_id: payment.id,
          amount: payment.amount,
          asset: payment.asset,
          asset_issuer: payment.asset_issuer,
          recipient: payment.recipient,
          tx_id: match.transaction_hash,
        }
      );

      if (payment.webhook_url && isEventSubscribed(merchant, "payment.confirmed")) {
        sendWebhook(
          payment.webhook_url,
          webhookPayload,
          merchant.webhook_secret,
          payment.id,
          merchant.webhook_custom_headers ?? {},
        ).catch(err =>
          logger.warn({ err, paymentId: payment.id }, "Horizon poller: webhook failed")
        );
      }

      // Receipt email
      const receiptTo = merchant.notification_email || merchant.email;
      if (receiptTo) {
        const html = renderReceiptEmail({
          payment: { ...payment, tx_id: match.transaction_hash },
          merchant,
        });
        sendReceiptEmail({
          to: receiptTo,
          subject: `Payment Receipt – ${payment.id}`,
          html,
        }).catch(err =>
          logger.warn({ err, paymentId: payment.id }, "Horizon poller: receipt email failed")
        );
      }
    }

  } catch (err) {
    // Non-fatal — log and continue with other payments
    logger.warn({ err, paymentId: payment.id }, "Horizon poller: error checking payment");
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function withLedgerMonitorRateLimit(operation, context) {
  await _rateLimiter.waitForSlot();
  try {
    return await operation();
  } catch (err) {
    logger.warn(
      { err, ...context },
      "Horizon poller: rate-limited Horizon operation failed",
    );
    throw err;
  }
}

async function verifyLedgerTransactionSignature(txHash, paymentId) {
  let sigResult;
  try {
    sigResult = await withLedgerMonitorRateLimit(
      () => verifyTransactionSignature(txHash),
      { paymentId, txHash, operation: "verifyTransactionSignature" },
    );
  } catch (sigErr) {
    logger.warn(
      { err: sigErr, paymentId, txHash },
      "Horizon poller: unexpected error during signature verification — skipping payment",
    );
    return false;
  }

  if (!sigResult?.valid) {
    logger.warn(
      {
        paymentId,
        txHash,
        reason: sigResult?.reason ?? "Signature verifier returned no result",
        isMultiSig: sigResult?.isMultiSig ?? false,
        signatureCount: sigResult?.signatureCount ?? 0,
        thresholdMet: sigResult?.thresholdMet ?? false,
      },
      "Horizon poller: signature verification failed — skipping payment",
    );
    return false;
  }

  logger.debug(
    {
      paymentId,
      txHash,
      isMultiSig: sigResult.isMultiSig,
      signatureCount: sigResult.signatureCount,
    },
    "Horizon poller: signature verification passed",
  );
  return true;
}

async function fetchPendingPayments(cutoff) {
  return supabase
    .from("payments")
    .select("id, amount, asset, asset_issuer, recipient, memo, memo_type, webhook_url, created_at, merchant_id, metadata")
    .eq("status", "pending")
    .is("deleted_at", null)
    .is("tx_id", null)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);
}

async function retryTransientDbOperation(operation, context) {
  let lastResult;
  for (let attempt = 0; attempt <= TRANSIENT_DB_RETRY_ATTEMPTS; attempt += 1) {
    lastResult = await operation();
    if (!isTransientDbError(lastResult?.error)) {
      return lastResult;
    }

    const delayMs = 100 * 2 ** attempt;
    logger.warn(
      { err: lastResult.error, attempt: attempt + 1, delayMs, ...context },
      "Horizon poller: transient DB operation failed — retrying",
    );
    await sleep(delayMs);
  }
  return lastResult;
}

function isTransientDbError(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const message = String(error.message || "").toLowerCase();
  return (
    code.startsWith("08") ||
    code === "40001" ||
    code === "40P01" ||
    message.includes("timeout") ||
    message.includes("temporarily unavailable") ||
    message.includes("connection")
  );
}

async function safeInvalidatePaymentCache(paymentId) {
  try {
    const redis = await connectRedisClient();
    await invalidatePaymentCache(redis, paymentId);
  } catch (err) {
    logger.warn(
      { err, paymentId },
      "Horizon poller: cache invalidation failed — continuing notifications",
    );
  }
}

async function loadMerchantNotificationConfig(merchantId, cache = new Map()) {
  if (!merchantId) {
    return null;
  }

  if (cache.has(merchantId)) {
    return cache.get(merchantId);
  }

  const { data, error } = await supabase
    .from("merchants")
    .select(MERCHANT_NOTIFICATION_FIELDS)
    .eq("id", merchantId)
    .maybeSingle();

  if (error) {
    logger.warn(
      { err: error, merchantId },
      "Horizon poller: failed to load merchant notification config",
    );
    cache.set(merchantId, null);
    return null;
  }

  const merchant = data ?? null;
  cache.set(merchantId, merchant);
  return merchant;
}
