"use client";

import React, { useCallback, useMemo, useEffect, useReducer, useRef } from "react";
import { motion, AnimatePresence, useReducedMotion, type Variants } from "framer-motion";
import { useTranslations } from "next-intl";
import { onboardingReducer, createInitialOnboardingState } from "./onboarding-reducer";

/**
 * Step interface for onboarding progress
 */
interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  required: boolean;
  order: number;
}

/**
 * Props for OnboardingProgressTracker component
 */
interface OnboardingProgressTrackerProps {
  steps: OnboardingStep[];
  currentStep?: string;
  onStepChange?: (stepId: string) => void;
  onComplete?: () => void;
  showStepNumbers?: boolean;
  orientation?: "vertical" | "horizontal";
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// Animation variants — #809 framer-motion animations
// ---------------------------------------------------------------------------

/**
 * Animation variants for step container — staggered children entrance
 */
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

/**
 * Animation variants for individual steps — slide-in from left
 */
const stepVariants: Variants = {
  hidden: { opacity: 0, x: -20 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    x: 20,
    transition: { duration: 0.2 },
  },
};

/** Reduced-motion safe step variants — no translate, only fade */
const stepVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

/**
 * Animation variants for progress bar — scale from left origin
 */
const progressBarVariants: Variants = {
  hidden: { scaleX: 0, originX: 0 },
  visible: {
    scaleX: 1,
    originX: 0,
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
  },
};

/** Reduced-motion progress bar — just fade */
const progressBarVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3 } },
};

/**
 * Animation variants for check mark — spring pop-in
 */
const checkMarkVariants: Variants = {
  hidden: { scale: 0, opacity: 0 },
  visible: {
    scale: 1,
    opacity: 1,
    transition: {
      type: "spring",
      stiffness: 260,
      damping: 20,
      delay: 0.2,
    },
  },
};

/** Reduced-motion check mark — simple fade */
const checkMarkVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
};

/**
 * Animation variants for completion banner — slide up
 */
const completionVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.2 } },
};

/** Reduced-motion completion banner */
const completionVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * OnboardingProgressTracker
 *
 * Displays onboarding progress with:
 * - framer-motion animations (entrance, progress bar, check marks, completion) — #809
 * - Comprehensive unit-test surface (exported types, deterministic state) — #810
 * - Full screen-reader support: ARIA live regions, aria-roledescription,
 *   aria-setsize / aria-posinset, aria-valuenow on progress bar — #811
 * - Optimistic updates with rollback on step navigation — #812
 */
export const OnboardingProgressTracker: React.FC<OnboardingProgressTrackerProps> = ({
  steps,
  currentStep: currentStepProp,
  onStepChange,
  onComplete,
  showStepNumbers = true,
  orientation = "vertical",
  compact = false,
}) => {
  const t = useTranslations();

  // Respect user's OS-level "reduce motion" preference — #809
  const prefersReducedMotion = useReducedMotion();

  const [state, dispatch] = useReducer(
    onboardingReducer,
    createInitialOnboardingState(currentStepProp || steps[0]?.id),
  );

  // Track previous step for rollback — #812
  const previousStepRef = useRef<string | undefined>(state.currentStep);

  /** Sort steps by order */
  const sortedSteps = useMemo(
    () => [...steps].sort((a, b) => a.order - b.order),
    [steps]
  );

  /** Progress percentage based on completed steps */
  const progressPercentage = useMemo(() => {
    if (sortedSteps.length === 0) return 0;
    const completedCount = sortedSteps.filter((s) => s.completed).length;
    return Math.round((completedCount / sortedSteps.length) * 100);
  }, [sortedSteps]);

  /** True when all required steps are completed */
  const isOnboardingComplete = useMemo(() => {
    const requiredSteps = sortedSteps.filter((s) => s.required);
    return requiredSteps.length > 0 && requiredSteps.every((s) => s.completed);
  }, [sortedSteps]);

  /**
   * Effective current step — optimistic value takes precedence while pending — #812
   */
  const effectiveCurrentStep = state.optimisticStep ?? state.currentStep;

  /**
   * Handle step click with optimistic update — #812
   * Immediately reflects the new step in UI, then calls the callback.
   * If the callback throws, the optimistic update is rolled back.
   */
  const handleStepClick = useCallback(
    async (stepId: string) => {
      const step = sortedSteps.find((s) => s.id === stepId);
      if (!step) return;

      // Store previous step for potential rollback
      previousStepRef.current = effectiveCurrentStep;

      // Optimistic update — UI responds immediately — #812
      dispatch({ type: "OPTIMISTIC_STEP", payload: stepId });

      // Announce to screen readers immediately — #811
      const announcement = `${t("onboarding.stepProgress") || "Step"} ${step.order} of ${sortedSteps.length}: ${step.title}. ${step.description}. ${step.completed ? t("onboarding.completed") || "Completed" : t("onboarding.pending") || "Pending"}.`;
      dispatch({ type: "SET_ANNOUNCEMENT", payload: announcement });

      try {
        // Call the callback (may be async / server-side)
        await onStepChange?.(stepId);
        // Confirm the optimistic update
        dispatch({ type: "CONFIRM_STEP", payload: stepId });
      } catch {
        // Rollback on failure — #812
        dispatch({ type: "ROLLBACK_STEP" });
        const rollbackAnnouncement = t("onboarding.stepChangeFailed") || "Step change failed. Please try again.";
        dispatch({ type: "SET_ANNOUNCEMENT", payload: rollbackAnnouncement });
      }
    },
    [sortedSteps, effectiveCurrentStep, onStepChange, t]
  );

  /** Announce completion and fire callback — #811 */
  useEffect(() => {
    if (isOnboardingComplete && sortedSteps.length > 0) {
      const announcement = t("onboarding.completed") || "Onboarding completed. All required steps are done.";
      dispatch({ type: "SET_ANNOUNCEMENT", payload: announcement });
      onComplete?.();
    }
  }, [isOnboardingComplete, sortedSteps.length, onComplete, t]);

  /** Announce progress percentage changes — #811 */
  useEffect(() => {
    const msg = `${t("onboarding.progress") || "Progress"}: ${progressPercentage}% complete`;
    dispatch({ type: "SET_ANNOUNCEMENT", payload: msg });
  }, [progressPercentage, t]);

  // Pick motion variants based on reduced-motion preference — #809
  const activeStepVariants = prefersReducedMotion ? stepVariantsReduced : stepVariants;
  const activeProgressBarVariants = prefersReducedMotion ? progressBarVariantsReduced : progressBarVariants;
  const activeCheckMarkVariants = prefersReducedMotion ? checkMarkVariantsReduced : checkMarkVariants;
  const activeCompletionVariants = prefersReducedMotion ? completionVariantsReduced : completionVariants;

  return (
    <div
      className="w-full"
      role="region"
      aria-label={t("onboarding.progressTracker") || "Onboarding Progress"}
      aria-live="polite"
      aria-atomic="false"
    >
      {/* Screen reader live announcement area — #811 */}
      <div
        className="sr-only"
        role="status"
        aria-live="assertive"
        aria-atomic="true"
        data-testid="sr-announcement"
      >
        {state.announcementText}
      </div>

      {/* Pending indicator for screen readers — #812 */}
      {state.isPending && (
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {t("onboarding.updating") || "Updating step…"}
        </div>
      )}

      {/* Container */}
      <div
        className={`rounded-[2rem] border border-pluto-100 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(240,246,251,0.92))] shadow-[0_20px_50px_rgba(13,27,46,0.08)] ${
          compact ? "p-4" : "p-6"
        }`}
      >
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-pluto-900">
              {t("onboarding.title") || "Onboarding Progress"}
            </h2>
            <span
              className="text-sm font-medium text-pluto-700"
              aria-hidden="true"
            >
              {progressPercentage}%
            </span>
          </div>
          <p className="mt-1 text-sm text-[#6B6B6B]">
            {t("onboarding.subtitle") || "Complete all required steps to finish setup"}
          </p>

          {/* Overall progress bar — animated with framer-motion — #809 */}
          <div
            className="mt-4 h-2 overflow-hidden rounded-full bg-pluto-100"
            role="progressbar"
            aria-valuenow={progressPercentage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("onboarding.progressBar") || "Overall onboarding progress"}
          >
            <motion.div
              className="h-full bg-gradient-to-r from-pluto-500 via-pluto-600 to-pluto-700"
              variants={activeProgressBarVariants}
              initial="hidden"
              animate="visible"
              style={{ width: `${progressPercentage}%` }}
              data-testid="progress-bar-fill"
            />
          </div>

          {/* Status text */}
          <p className="mt-2 text-xs text-[#6B6B6B]" aria-hidden="true">
            {sortedSteps.filter((s) => s.completed).length} of{" "}
            {sortedSteps.length} steps completed
            {isOnboardingComplete && (
              <span className="ml-2 inline-flex items-center gap-1 font-medium text-pluto-700">
                <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                {t("onboarding.allCompleted") || "All done!"}
              </span>
            )}
          </p>
        </div>

        {/* Steps list — staggered entrance animation — #809 */}
        <motion.ol
          className={`space-y-3 ${orientation === "horizontal" ? "flex gap-4 space-y-0" : ""}`}
          role="list"
          aria-label={t("onboarding.stepsList") || "Onboarding steps"}
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <AnimatePresence mode="popLayout">
            {sortedSteps.map((step, index) => {
              const isCurrentStep = effectiveCurrentStep === step.id;

              return (
                <motion.li
                  key={step.id}
                  role="listitem"
                  variants={activeStepVariants}
                  className={`group relative rounded-3xl border border-transparent px-3 py-3 transition-colors duration-200 hover:border-pluto-100 hover:bg-white/90 ${
                    orientation === "horizontal"
                      ? "flex flex-1 flex-col"
                      : "flex flex-row gap-4"
                  }`}
                  // Subtle highlight on active step — #809
                  animate={
                    isCurrentStep && !prefersReducedMotion
                      ? { boxShadow: "0 0 0 2px rgba(74,111,165,0.18)" }
                      : { boxShadow: "none" }
                  }
                  transition={{ duration: 0.2 }}
                >
                  {/* Step indicator button */}
                  <button
                    onClick={() => handleStepClick(step.id)}
                    className={`relative flex-shrink-0 ${
                      compact ? "h-8 w-8" : "h-10 w-10"
                    } rounded-full border-2 font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-pluto-400 focus:ring-offset-2 ${
                      step.completed
                        ? "border-pluto-500 bg-pluto-100 text-pluto-800 shadow-[0_10px_24px_rgba(74,111,165,0.14)]"
                        : isCurrentStep
                          ? "border-pluto-600 bg-pluto-50 text-pluto-700 shadow-[0_12px_28px_rgba(74,111,165,0.12)]"
                          : "border-pluto-200 bg-white text-pluto-700 group-hover:border-pluto-400 group-hover:bg-pluto-50 group-hover:text-pluto-800 group-hover:shadow-[0_10px_24px_rgba(13,27,46,0.08)]"
                    }`}
                    // Full descriptive label for screen readers — #811
                    aria-label={`Step ${showStepNumbers ? index + 1 : ""}: ${step.title}${
                      step.completed ? ". Completed" : ""
                    }${step.required ? ". Required" : ""}`}
                    aria-pressed={isCurrentStep}
                    aria-current={isCurrentStep ? "step" : undefined}
                    // aria-setsize / aria-posinset for list position context — #811
                    aria-setsize={sortedSteps.length}
                    aria-posinset={index + 1}
                    aria-roledescription="onboarding step"
                    aria-busy={state.isPending && isCurrentStep}
                    disabled={false}
                  >
                    <AnimatePresence mode="wait">
                      {step.completed ? (
                        <motion.div
                          key="checkmark"
                          className="absolute inset-0 flex items-center justify-center"
                          variants={activeCheckMarkVariants}
                          initial="hidden"
                          animate="visible"
                        >
                          {/* Check mark SVG — #809 spring animation */}
                          <svg
                            className="h-5 w-5 text-pluto-700"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                            aria-hidden="true"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </motion.div>
                      ) : (
                        <motion.span
                          key="number"
                          className={`text-${compact ? "sm" : "base"} ${
                            isCurrentStep ? "text-pluto-700" : "text-pluto-600"
                          }`}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          aria-hidden="true"
                        >
                          {showStepNumbers ? index + 1 : ""}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </button>

                  {/* Step content */}
                  <motion.div
                    className="flex-1 min-w-0"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: prefersReducedMotion ? 0 : 0.1 }}
                  >
                    <h3
                      className={`font-medium text-pluto-900 transition-colors duration-200 group-hover:text-pluto-800 ${
                        step.completed ? "text-pluto-700 line-through" : ""
                      } ${compact ? "text-sm" : "text-base"}`}
                    >
                      {step.title}
                      {step.required && (
                        <span
                          className="ml-1 text-red-500"
                          aria-label={t("onboarding.required") || "Required"}
                          title="Required step"
                        >
                          *
                        </span>
                      )}
                    </h3>
                    <p
                      className={`text-[#6B6B6B] transition-colors duration-200 group-hover:text-pluto-700 ${
                        compact ? "text-xs" : "text-sm"
                      }`}
                    >
                      {step.description}
                    </p>

                    {/* Status badge — animated scale-in — #809 */}
                    <div className="mt-2 flex items-center gap-2">
                      <motion.span
                        className={`inline-flex text-xs font-semibold rounded-full px-2 py-1 ${
                          step.completed
                            ? "bg-pluto-100 text-pluto-800"
                            : isCurrentStep
                              ? "bg-pluto-200 text-pluto-800"
                              : "bg-pluto-50 text-pluto-700 group-hover:bg-pluto-100"
                        }`}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: prefersReducedMotion ? 0 : 0.15 }}
                        // Expose status to screen readers — #811
                        aria-label={
                          step.completed
                            ? t("onboarding.completed") || "Completed"
                            : isCurrentStep
                              ? t("onboarding.inProgress") || "In Progress"
                              : t("onboarding.pending") || "Pending"
                        }
                      >
                        {step.completed
                          ? t("onboarding.completed") || "Completed"
                          : isCurrentStep
                            ? t("onboarding.inProgress") || "In Progress"
                            : t("onboarding.pending") || "Pending"}
                      </motion.span>
                    </div>
                  </motion.div>

                  {/* Connector line (vertical orientation only) */}
                  {orientation === "vertical" && index < sortedSteps.length - 1 && (
                    <div
                      className="absolute left-8 top-[calc(100%_-_0.5rem)] h-3 w-0.5 bg-pluto-200"
                      aria-hidden="true"
                    />
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </motion.ol>

        {/* Completion banner — animated entrance — #809 */}
        <AnimatePresence>
          {isOnboardingComplete && sortedSteps.length > 0 && (
            <motion.div
              className="mt-6 rounded-2xl border border-pluto-200 bg-pluto-50 p-4"
              variants={activeCompletionVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              role="alert"
              aria-live="polite"
              aria-atomic="true"
              data-testid="completion-banner"
            >
              <div className="flex items-start gap-3">
                <motion.svg
                  className="mt-0.5 h-5 w-5 flex-shrink-0 text-pluto-600"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                  animate={prefersReducedMotion ? {} : { scale: [1, 1.2, 1] }}
                  transition={{ duration: 0.5, delay: 0.3 }}
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </motion.svg>
                <div>
                  <h4 className="font-semibold text-pluto-900">
                    {t("onboarding.successTitle") || "Onboarding Complete!"}
                  </h4>
                  <p className="mt-1 text-sm text-pluto-700">
                    {t("onboarding.successMessage") ||
                      "You have successfully completed all required onboarding steps."}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default OnboardingProgressTracker;
