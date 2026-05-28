/**
 * State logic for the Onboarding Progress Tracker, extracted from the component
 * so the optimistic-update lifecycle (optimistic → confirm/rollback) is a pure,
 * independently testable unit rather than being tangled with the view.
 */

export interface OnboardingState {
  currentStep: string | undefined;
  /** Optimistic step id set immediately on click before the change is confirmed. */
  optimisticStep: string | undefined;
  announcementText: string;
  /** Whether an optimistic update is awaiting confirmation. */
  isPending: boolean;
}

export type OnboardingAction =
  | { type: "SET_CURRENT_STEP"; payload: string }
  | { type: "OPTIMISTIC_STEP"; payload: string }
  | { type: "CONFIRM_STEP"; payload: string }
  | { type: "ROLLBACK_STEP" }
  | { type: "SET_ANNOUNCEMENT"; payload: string };

export function createInitialOnboardingState(
  currentStep?: string,
): OnboardingState {
  return {
    currentStep,
    optimisticStep: undefined,
    announcementText: "",
    isPending: false,
  };
}

export function onboardingReducer(
  state: OnboardingState,
  action: OnboardingAction,
): OnboardingState {
  switch (action.type) {
    case "SET_CURRENT_STEP":
      return { ...state, currentStep: action.payload, optimisticStep: undefined, isPending: false };
    case "OPTIMISTIC_STEP":
      return { ...state, optimisticStep: action.payload, isPending: true };
    case "CONFIRM_STEP":
      return { ...state, currentStep: action.payload, optimisticStep: undefined, isPending: false };
    case "ROLLBACK_STEP":
      return { ...state, optimisticStep: undefined, isPending: false };
    case "SET_ANNOUNCEMENT":
      return { ...state, announcementText: action.payload };
    default:
      return state;
  }
}
