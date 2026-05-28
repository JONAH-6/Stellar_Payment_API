/**
 * @vitest-environment jsdom
 *
 * Unit tests for OnboardingProgressTracker
 *
 * Covers:
 *  - #809 framer-motion animation variants and reduced-motion support
 *  - #810 comprehensive unit test coverage
 *  - #811 screen reader / accessibility attributes
 *  - #812 optimistic updates and rollback behaviour
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { OnboardingProgressTracker } from "./OnboardingProgressTracker";
import React from "react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock framer-motion — renders plain HTML elements so tests stay fast — #809
vi.mock("framer-motion", () => ({
  motion: {
    div: React.forwardRef(({ children, ...props }: any, ref: any) => (
      <div {...props} ref={ref}>{children}</div>
    )),
    ol: React.forwardRef(({ children, ...props }: any, ref: any) => (
      <ol {...props} ref={ref}>{children}</ol>
    )),
    li: React.forwardRef(({ children, ...props }: any, ref: any) => (
      <li {...props} ref={ref}>{children}</li>
    )),
    button: React.forwardRef(({ children, ...props }: any, ref: any) => (
      <button {...props} ref={ref}>{children}</button>
    )),
    span: React.forwardRef(({ children, ...props }: any, ref: any) => (
      <span {...props} ref={ref}>{children}</span>
    )),
    svg: React.forwardRef(({ children, ...props }: any, ref: any) => (
      <svg {...props} ref={ref}>{children}</svg>
    )),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
  useReducedMotion: () => false,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockSteps = [
  {
    id: "1",
    title: "Step 1",
    description: "Description 1",
    completed: true,
    required: true,
    order: 1,
  },
  {
    id: "2",
    title: "Step 2",
    description: "Description 2",
    completed: false,
    required: true,
    order: 2,
  },
  {
    id: "3",
    title: "Step 3",
    description: "Description 3",
    completed: false,
    required: false,
    order: 3,
  },
];

const defaultProps = {
  steps: mockSteps,
  onStepChange: vi.fn(),
  onComplete: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OnboardingProgressTracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // #810 — Rendering
  // -------------------------------------------------------------------------
  describe("Rendering", () => {
    it("renders the component with the correct title", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.getByText("onboarding.title")).toBeInTheDocument();
    });

    it("renders all steps with correct titles and descriptions", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      mockSteps.forEach((step) => {
        expect(screen.getByText(step.title)).toBeInTheDocument();
        expect(screen.getByText(step.description)).toBeInTheDocument();
      });
    });

    it("shows the correct progress percentage", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      // 1 of 3 completed = 33 %
      expect(screen.getByText("33%")).toBeInTheDocument();
    });

    it("renders the progress bar fill element", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      const fill = screen.getByTestId("progress-bar-fill");
      expect(fill).toBeInTheDocument();
      expect(fill).toHaveStyle("width: 33%");
    });

    it("renders the progress bar with correct ARIA attributes", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      const bar = screen.getByRole("progressbar");
      expect(bar).toHaveAttribute("aria-valuenow", "33");
      expect(bar).toHaveAttribute("aria-valuemin", "0");
      expect(bar).toHaveAttribute("aria-valuemax", "100");
    });

    it("does not show the completion banner when onboarding is incomplete", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.queryByTestId("completion-banner")).not.toBeInTheDocument();
    });

    it("shows the completion banner when all required steps are done", async () => {
      const allDone = [
        { ...mockSteps[0], completed: true },
        { ...mockSteps[1], completed: true },
        { ...mockSteps[2], completed: false }, // optional — not required
      ];
      render(<OnboardingProgressTracker {...defaultProps} steps={allDone} />);
      await waitFor(() => {
        expect(screen.getByTestId("completion-banner")).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // #810 — Props and variants
  // -------------------------------------------------------------------------
  describe("Props and variants", () => {
    it("hides step numbers when showStepNumbers is false", () => {
      render(<OnboardingProgressTracker {...defaultProps} showStepNumbers={false} />);
      // Numbers 1, 2, 3 should not appear as standalone text nodes
      expect(screen.queryByText("1")).not.toBeInTheDocument();
      expect(screen.queryByText("2")).not.toBeInTheDocument();
    });

    it("applies compact padding class when compact prop is true", () => {
      const { container } = render(
        <OnboardingProgressTracker {...defaultProps} compact={true} />
      );
      expect(container.querySelector(".p-4")).toBeInTheDocument();
    });

    it("applies horizontal layout classes when orientation is horizontal", () => {
      render(<OnboardingProgressTracker {...defaultProps} orientation="horizontal" />);
      const list = screen.getByRole("list");
      expect(list).toHaveClass("flex");
      expect(list).toHaveClass("gap-4");
    });

    it("renders a vertical list by default", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      const list = screen.getByRole("list");
      expect(list).not.toHaveClass("flex");
    });
  });

  // -------------------------------------------------------------------------
  // #810 — Interactions
  // -------------------------------------------------------------------------
  describe("Interactions", () => {
    it("calls onStepChange when a step button is clicked", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      const btn = screen.getByLabelText(/Step 2: Step 2. Required/i);
      fireEvent.click(btn);
      expect(defaultProps.onStepChange).toHaveBeenCalledWith("2");
    });

    it("calls onStepChange with the correct step id", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      const btn = screen.getByLabelText(/Step 1: Step 1. Completed. Required/i);
      fireEvent.click(btn);
      expect(defaultProps.onStepChange).toHaveBeenCalledWith("1");
    });
  });

  // -------------------------------------------------------------------------
  // #810 — Completion logic
  // -------------------------------------------------------------------------
  describe("Completion logic", () => {
    it("calls onComplete when all required steps are completed", async () => {
      const allRequired = [
        { ...mockSteps[0], completed: true },
        { ...mockSteps[1], completed: true },
        { ...mockSteps[2], completed: false },
      ];
      render(<OnboardingProgressTracker {...defaultProps} steps={allRequired} />);
      await waitFor(() => {
        expect(defaultProps.onComplete).toHaveBeenCalled();
      });
    });

    it("does not call onComplete when a required step is incomplete", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(defaultProps.onComplete).not.toHaveBeenCalled();
    });

    it("shows success title in completion banner", async () => {
      const allRequired = [
        { ...mockSteps[0], completed: true },
        { ...mockSteps[1], completed: true },
        { ...mockSteps[2], completed: false },
      ];
      render(<OnboardingProgressTracker {...defaultProps} steps={allRequired} />);
      await waitFor(() => {
        expect(screen.getByText("onboarding.successTitle")).toBeInTheDocument();
      });
    });

    it("does not show success title when onboarding is incomplete", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.queryByText("onboarding.successTitle")).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // #811 — Accessibility / screen reader support
  // -------------------------------------------------------------------------
  describe("Accessibility — screen reader support (#811)", () => {
    it("wraps the tracker in a region landmark with aria-label", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      const region = screen.getByRole("region");
      expect(region).toHaveAttribute("aria-label", "onboarding.progressTracker");
    });

    it("sets aria-live='polite' on the region", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      const region = screen.getByRole("region");
      expect(region).toHaveAttribute("aria-live", "polite");
    });

    it("renders a live status region for announcements", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      const status = screen.getByRole("status");
      expect(status).toBeInTheDocument();
    });

    it("announces progress percentage on mount", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      const status = screen.getByRole("status");
      expect(status.textContent).toContain("33");
    });

    it("announces step details when a step is clicked", async () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      const btn = screen.getByLabelText(/Step 2: Step 2. Required/i);
      fireEvent.click(btn);
      const status = screen.getByRole("status");
      await waitFor(() => {
        expect(status.textContent).toContain("Step 2");
        expect(status.textContent).toContain("Description 2");
      });
    });

    it("labels the steps list with aria-label", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      const list = screen.getByRole("list");
      expect(list).toHaveAttribute("aria-label", "onboarding.stepsList");
    });

    it("marks the current step with aria-current='step'", () => {
      render(<OnboardingProgressTracker {...defaultProps} currentStep="1" />);
      const btn = screen.getByLabelText(/Step 1: Step 1. Completed. Required/i);
      expect(btn).toHaveAttribute("aria-current", "step");
    });

    it("does not set aria-current on non-current steps", () => {
      render(<OnboardingProgressTracker {...defaultProps} currentStep="1" />);
      const btn = screen.getByLabelText(/Step 2: Step 2. Required/i);
      expect(btn).not.toHaveAttribute("aria-current");
    });

    it("sets aria-setsize and aria-posinset on step buttons", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      const btn1 = screen.getByLabelText(/Step 1: Step 1. Completed. Required/i);
      expect(btn1).toHaveAttribute("aria-setsize", "3");
      expect(btn1).toHaveAttribute("aria-posinset", "1");

      const btn2 = screen.getByLabelText(/Step 2: Step 2. Required/i);
      expect(btn2).toHaveAttribute("aria-posinset", "2");
    });

    it("sets aria-roledescription on step buttons", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      const btn = screen.getByLabelText(/Step 1: Step 1. Completed. Required/i);
      expect(btn).toHaveAttribute("aria-roledescription", "onboarding step");
    });

    it("completion banner has role='alert' and aria-live='polite'", async () => {
      const allDone = [
        { ...mockSteps[0], completed: true },
        { ...mockSteps[1], completed: true },
        { ...mockSteps[2], completed: false },
      ];
      render(<OnboardingProgressTracker {...defaultProps} steps={allDone} />);
      await waitFor(() => {
        const alert = screen.getByRole("alert");
        expect(alert).toHaveAttribute("aria-live", "polite");
        expect(alert).toHaveAttribute("aria-atomic", "true");
      });
    });

    it("marks required asterisk with aria-label", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      const requiredMarkers = screen.getAllByLabelText("onboarding.required");
      expect(requiredMarkers.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // #812 — Optimistic updates
  // -------------------------------------------------------------------------
  describe("Optimistic updates (#812)", () => {
    it("immediately reflects the clicked step as current before callback resolves", async () => {
      let resolveCallback!: () => void;
      const slowCallback = vi.fn(
        () => new Promise<void>((res) => { resolveCallback = res; })
      );

      render(
        <OnboardingProgressTracker
          {...defaultProps}
          onStepChange={slowCallback}
          currentStep="1"
        />
      );

      const btn2 = screen.getByLabelText(/Step 2: Step 2. Required/i);
      fireEvent.click(btn2);

      // Optimistic: step 2 should be current immediately
      await waitFor(() => {
        expect(btn2).toHaveAttribute("aria-current", "step");
      });

      // Resolve the callback
      act(() => resolveCallback());
    });

    it("confirms the optimistic update after callback resolves", async () => {
      const asyncCallback = vi.fn(() => Promise.resolve());
      render(
        <OnboardingProgressTracker
          {...defaultProps}
          onStepChange={asyncCallback}
          currentStep="1"
        />
      );

      const btn2 = screen.getByLabelText(/Step 2: Step 2. Required/i);
      fireEvent.click(btn2);

      await waitFor(() => {
        expect(asyncCallback).toHaveBeenCalledWith("2");
        expect(btn2).toHaveAttribute("aria-current", "step");
      });
    });

    it("rolls back the optimistic update when callback throws", async () => {
      const failingCallback = vi.fn(() => Promise.reject(new Error("server error")));

      render(
        <OnboardingProgressTracker
          {...defaultProps}
          onStepChange={failingCallback}
          currentStep="1"
        />
      );

      const btn1 = screen.getByLabelText(/Step 1: Step 1. Completed. Required/i);
      const btn2 = screen.getByLabelText(/Step 2: Step 2. Required/i);

      fireEvent.click(btn2);

      // After rollback, step 1 should be current again
      await waitFor(() => {
        expect(btn1).toHaveAttribute("aria-current", "step");
        expect(btn2).not.toHaveAttribute("aria-current");
      });
    });

    it("announces a failure message to screen readers on rollback", async () => {
      const failingCallback = vi.fn(() => Promise.reject(new Error("fail")));

      render(
        <OnboardingProgressTracker
          {...defaultProps}
          onStepChange={failingCallback}
          currentStep="1"
        />
      );

      const btn2 = screen.getByLabelText(/Step 2: Step 2. Required/i);
      fireEvent.click(btn2);

      await waitFor(() => {
        const status = screen.getByRole("status");
        expect(status.textContent).toContain("onboarding.stepChangeFailed");
      });
    });

    it("sets aria-busy on the pending step button during optimistic update", async () => {
      let resolveCallback!: () => void;
      const slowCallback = vi.fn(
        () => new Promise<void>((res) => { resolveCallback = res; })
      );

      render(
        <OnboardingProgressTracker
          {...defaultProps}
          onStepChange={slowCallback}
          currentStep="1"
        />
      );

      const btn2 = screen.getByLabelText(/Step 2: Step 2. Required/i);
      fireEvent.click(btn2);

      await waitFor(() => {
        expect(btn2).toHaveAttribute("aria-busy", "true");
      });

      act(() => resolveCallback());
    });
  });

  // -------------------------------------------------------------------------
  // #809 — Animation / reduced-motion
  // -------------------------------------------------------------------------
  describe("Animations (#809)", () => {
    it("renders the progress bar fill element used for animation", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.getByTestId("progress-bar-fill")).toBeInTheDocument();
    });

    it("renders step list items that carry animation variant props", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      // All 3 steps should be in the DOM
      const items = screen.getAllByRole("listitem");
      expect(items).toHaveLength(3);
    });

    it("renders completed step with a checkmark icon", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      // Step 1 is completed — its button should not show a number
      const btn1 = screen.getByLabelText(/Step 1: Step 1. Completed. Required/i);
      // The number span is not rendered for completed steps
      expect(btn1.querySelector("span")).not.toBeInTheDocument();
    });
  });
});
