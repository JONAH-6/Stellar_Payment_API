"use client";

import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import confetti from "canvas-confetti";
import { useTranslations } from "next-intl";

interface PaymentSuccessAnimationProps {
  show: boolean;
  onComplete?: () => void;
  amount?: string;
  asset?: string;
  txId?: string;
  /** When true, the component indicates an optimistic (pre-confirmation) success state */
  isOptimistic?: boolean;
}

const containerVariants: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.4,
      ease: [0.16, 1, 0.3, 1],
      staggerChildren: 0.08,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: { duration: 0.25, ease: "easeIn" },
  },
};

const childVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
  },
};

const checkVariants: Variants = {
  hidden: { scale: 0, rotate: -30 },
  visible: {
    scale: 1,
    rotate: 0,
    transition: { type: "spring", stiffness: 320, damping: 18, delay: 0.05 },
  },
};

export const PaymentSuccessAnimation: React.FC<PaymentSuccessAnimationProps> = ({
  show,
  onComplete,
  amount = "0",
  asset = "XLM",
  txId,
  isOptimistic = false,
}) => {
  const t = useTranslations();
  const hasTriggeredConfettiRef = useRef(false);
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!show) {
      hasTriggeredConfettiRef.current = false;
      if (completeTimerRef.current) {
        clearTimeout(completeTimerRef.current);
        completeTimerRef.current = null;
      }
      return;
    }

    // Focus the close button when the dialog opens for keyboard accessibility
    const focusTimer = setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 100);

    if (!hasTriggeredConfettiRef.current) {
      hasTriggeredConfettiRef.current = true;
      const accent = "#00F5D4";
      const secondary = "#6C5CE7";
      confetti({
        particleCount: 120,
        spread: 78,
        startVelocity: 36,
        origin: { y: 0.65 },
        colors: [accent, secondary, "#00D4AA", "#ffffff"],
      });
      // Flanking burst 200ms later
      setTimeout(() => {
        confetti({
          particleCount: 40,
          spread: 120,
          startVelocity: 28,
          origin: { x: 0.3, y: 0.7 },
          colors: [accent, secondary],
        });
        confetti({
          particleCount: 40,
          spread: 120,
          startVelocity: 28,
          origin: { x: 0.7, y: 0.7 },
          colors: [accent, secondary],
        });
      }, 200);
    }

    completeTimerRef.current = setTimeout(() => {
      onComplete?.();
    }, 4000);

    return () => {
      clearTimeout(focusTimer);
      if (completeTimerRef.current) {
        clearTimeout(completeTimerRef.current);
        completeTimerRef.current = null;
      }
    };
  }, [show, onComplete]);

  // Trap focus within the dialog while it is open
  useEffect(() => {
    if (!show) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onComplete?.();
        return;
      }
      if (e.key !== "Tab") return;
      const container = containerRef.current;
      if (!container) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [show, onComplete]);

  if (!show) return null;

  const successAnnounce =
    t("payment.successAnnounce") ||
    `Payment successful! ${amount} ${asset} has been received.`;

  const optimisticNote =
    isOptimistic
      ? t("payment.optimisticNote") || "Transaction submitted — awaiting network confirmation."
      : null;

  return (
    <AnimatePresence>
      <motion.div
        ref={containerRef}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-success-title"
        aria-describedby="payment-success-description"
      >
        {/* Live region — announced immediately by screen readers */}
        <div
          className="sr-only"
          role="status"
          aria-live="assertive"
          aria-atomic="true"
        >
          {successAnnounce}
        </div>

        <motion.div
          className="relative w-full max-w-md overflow-hidden rounded-3xl border border-accent/30 bg-gradient-to-br from-black via-gray-900 to-black p-8 text-center shadow-2xl"
          variants={childVariants}
        >
          {/* Subtle radial glow */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-accent/10 blur-3xl"
          />

          {/* Close button */}
          <motion.button
            ref={closeButtonRef}
            onClick={onComplete}
            className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            aria-label={t("common.close") || "Close success animation"}
            variants={childVariants}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </motion.button>

          {/* Animated success icon */}
          <motion.div
            className="relative mx-auto mb-6 flex h-20 w-20 items-center justify-center"
            variants={childVariants}
          >
            {/* Pulsing glow ring */}
            <motion.div
              className="absolute inset-0 rounded-full bg-accent/20"
              animate={{ scale: [1, 1.22, 1], opacity: [0.45, 0.9, 0.45] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              aria-hidden="true"
            />
            {/* Inner ring */}
            <motion.div
              className="absolute inset-2 rounded-full bg-accent/10 ring-1 ring-accent/30"
              aria-hidden="true"
            />
            {/* Check icon */}
            <motion.div
              className="relative z-10 flex h-full w-full items-center justify-center"
              variants={checkVariants}
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-9 w-9 text-accent"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <motion.path
                  d="M5 13l4 4L19 7"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.5, ease: "easeOut", delay: 0.2 }}
                />
              </svg>
            </motion.div>
          </motion.div>

          {/* Heading */}
          <motion.h1
            id="payment-success-title"
            className="mb-3 text-3xl font-bold tracking-tight text-white"
            variants={childVariants}
          >
            {t("payment.successTitle") || "Payment Successful!"}
          </motion.h1>

          {/* Optimistic badge */}
          {isOptimistic && (
            <motion.div
              className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-yellow-400/30 bg-yellow-400/10 px-3 py-1 text-xs font-medium text-yellow-300"
              variants={childVariants}
              role="status"
              aria-live="polite"
            >
              <span
                className="relative flex h-1.5 w-1.5"
                aria-hidden="true"
              >
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400/75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-yellow-400" />
              </span>
              {optimisticNote}
            </motion.div>
          )}

          {/* Amount block */}
          <motion.div
            className="mb-4 rounded-xl bg-accent/10 p-4"
            variants={childVariants}
          >
            <p className="mb-1 text-sm text-slate-400">
              {t("payment.amountReceived") || "Amount Received"}
            </p>
            <p className="text-2xl font-bold text-accent">
              {amount} {asset}
            </p>
          </motion.div>

          {/* Description */}
          <motion.p
            id="payment-success-description"
            className="mb-6 text-slate-400"
            variants={childVariants}
          >
            {t("payment.successMessage") ||
              "Your payment has been processed successfully. The transaction is now confirmed on the Stellar network."}
          </motion.p>

          {/* Transaction ID */}
          {txId ? (
            <motion.div
              className="mb-6 rounded-lg bg-slate-800/50 p-3"
              variants={childVariants}
            >
              <p className="mb-1 text-xs text-slate-500">
                {t("payment.transactionId") || "Transaction ID"}
              </p>
              <p className="break-all font-mono text-xs text-slate-300">{txId}</p>
            </motion.div>
          ) : null}

          {/* CTA */}
          <motion.div
            className="flex w-full flex-col gap-3"
            variants={childVariants}
          >
            <button
              onClick={onComplete}
              className="flex items-center justify-center rounded-xl bg-accent px-6 py-3 font-semibold text-black transition-all hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              aria-label={t("common.continue") || "Continue"}
            >
              {t("common.continue") || "Continue"}
            </button>
          </motion.div>

          {/* Keyboard hint for screen readers */}
          <p className="sr-only">
            {t("payment.successHint") ||
              "Press Escape or the close button to dismiss this message."}
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default PaymentSuccessAnimation;
