/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TransactionFilterSidebar from "./TransactionFilterSidebar";
import React from "react";
import "@testing-library/jest-dom/vitest";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    aside: ({ children, ...props }: any) => <aside {...props}>{children}</aside>,
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
    button: ({ children, onClick, disabled, className, type, style }: any) => (
      <button onClick={onClick} disabled={disabled} className={className} type={type} style={style}>{children}</button>
    ),
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
    svg: ({ children, ...props }: any) => <svg {...props}>{children}</svg>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
  useReducedMotion: () => false,
}));

describe("TransactionFilterSidebar — framer-motion animations", () => {
  const defaultFilters = {
    search: "",
    status: "all",
    asset: "all",
    dateFrom: "",
    dateTo: "",
  };

  const mockProps = {
    filters: defaultFilters,
    onFilterChange: vi.fn(),
    onClearFilter: vi.fn(),
    onClearAll: vi.fn(),
    hasActiveFilters: false,
    isOpen: true,
    onClose: vi.fn(),
  };

  beforeEach(() => vi.clearAllMocks());

  // ── Mount / stagger ────────────────────────────────────────────────────────

  describe("Mount animations", () => {
    it("renders all filter sections on mount", () => {
      render(<TransactionFilterSidebar {...mockProps} />);

      expect(screen.getAllByText("Filters").length).toBeGreaterThan(0);
      expect(screen.getAllByLabelText(/Search/i).length).toBeGreaterThan(0);
      expect(screen.getAllByLabelText(/Status/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Asset/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Date Range/i).length).toBeGreaterThan(0);
    });

    it("renders Clear All Filters button on mount", () => {
      render(<TransactionFilterSidebar {...mockProps} />);
      expect(screen.getAllByRole("button", { name: /Clear All Filters/i }).length).toBeGreaterThan(0);
    });
  });

  // ── Date Range collapsible ─────────────────────────────────────────────────

  describe("Date Range collapsible section", () => {
    it("starts collapsed when no date filters are active", () => {
      render(<TransactionFilterSidebar {...mockProps} />);

      // Date inputs should not be in the DOM when collapsed
      const fromInputs = screen.queryAllByLabelText(/^From$/i, { selector: "input" });
      expect(fromInputs.length).toBe(0);
    });

    it("starts expanded when dateFrom is pre-filled", () => {
      render(
        <TransactionFilterSidebar
          {...mockProps}
          filters={{ ...defaultFilters, dateFrom: "2024-01-01" }}
        />,
      );

      const fromInputs = screen.getAllByLabelText(/^From$/i, { selector: "input" });
      expect(fromInputs.length).toBeGreaterThan(0);
    });

    it("starts expanded when dateTo is pre-filled", () => {
      render(
        <TransactionFilterSidebar
          {...mockProps}
          filters={{ ...defaultFilters, dateTo: "2024-12-31" }}
        />,
      );

      const toInputs = screen.getAllByLabelText(/^To$/i, { selector: "input" });
      expect(toInputs.length).toBeGreaterThan(0);
    });

    it("expands when Date Range toggle is clicked", async () => {
      render(<TransactionFilterSidebar {...mockProps} />);

      const toggleButtons = screen.getAllByRole("button", { name: "" });
      // The Date Range toggle button has aria-expanded
      const dateToggle = screen
        .getAllByRole("button")
        .find((b) => b.getAttribute("aria-expanded") !== null);

      expect(dateToggle).toBeDefined();
      fireEvent.click(dateToggle!);

      await waitFor(() => {
        const fromInputs = screen.getAllByLabelText(/^From$/i, { selector: "input" });
        expect(fromInputs.length).toBeGreaterThan(0);
      });
    });

    it("has aria-expanded=false when collapsed", () => {
      render(<TransactionFilterSidebar {...mockProps} />);

      const dateToggle = screen
        .getAllByRole("button")
        .find((b) => b.getAttribute("aria-expanded") === "false");

      expect(dateToggle).toBeDefined();
    });

    it("has aria-expanded=true when expanded", () => {
      render(
        <TransactionFilterSidebar
          {...mockProps}
          filters={{ ...defaultFilters, dateFrom: "2024-01-01" }}
        />,
      );

      const dateToggle = screen
        .getAllByRole("button")
        .find((b) => b.getAttribute("aria-expanded") === "true");

      expect(dateToggle).toBeDefined();
    });
  });

  // ── Clear-search animated button ───────────────────────────────────────────

  describe("Animated clear-search button", () => {
    it("renders clear button when search has a value", () => {
      render(
        <TransactionFilterSidebar
          {...mockProps}
          filters={{ ...defaultFilters, search: "something" }}
        />,
      );

      const clearButtons = screen.getAllByLabelText(/Clear search/i);
      expect(clearButtons.length).toBeGreaterThan(0);
    });

    it("does not render clear button when search is empty", () => {
      render(<TransactionFilterSidebar {...mockProps} />);
      expect(screen.queryByLabelText(/Clear search/i)).not.toBeInTheDocument();
    });

    it("calls onClearFilter with 'search' when clear button clicked", () => {
      render(
        <TransactionFilterSidebar
          {...mockProps}
          filters={{ ...defaultFilters, search: "something" }}
        />,
      );

      const clearButtons = screen.getAllByLabelText(/Clear search/i);
      fireEvent.click(clearButtons[0]);
      expect(mockProps.onClearFilter).toHaveBeenCalledWith("search");
    });
  });

  // ── Close button rotation ──────────────────────────────────────────────────

  describe("Animated close button (mobile)", () => {
    it("renders close button in mobile drawer", () => {
      render(<TransactionFilterSidebar {...mockProps} />);
      const closeButtons = screen.getAllByLabelText(/Close filters/i);
      expect(closeButtons.length).toBeGreaterThan(0);
    });

    it("calls onClose when close button clicked", () => {
      render(<TransactionFilterSidebar {...mockProps} />);
      const closeButtons = screen.getAllByLabelText(/Close filters/i);
      fireEvent.click(closeButtons[0]);
      expect(mockProps.onClose).toHaveBeenCalled();
    });
  });

  // ── Optimistic pending states ──────────────────────────────────────────────

  describe("Optimistic visual feedback", () => {
    it("shows 'Applying to results…' hint when searchSyncPending", () => {
      render(
        <TransactionFilterSidebar
          {...mockProps}
          filters={{ ...defaultFilters, search: "q" }}
          searchSyncPending
        />,
      );

      expect(screen.getAllByText(/Applying to results/i).length).toBeGreaterThan(0);
    });

    it("sets aria-busy on search input when searchSyncPending", () => {
      render(
        <TransactionFilterSidebar
          {...mockProps}
          filters={{ ...defaultFilters, search: "q" }}
          searchSyncPending
        />,
      );

      const inputs = screen.getAllByLabelText(/Search/i);
      expect(inputs[0]).toHaveAttribute("aria-busy", "true");
    });

    it("sets aria-busy on status select when isFilterPending", () => {
      render(
        <TransactionFilterSidebar
          {...mockProps}
          filters={{ ...defaultFilters, status: "confirmed" }}
          isFilterPending
        />,
      );

      const selects = screen.getAllByLabelText(/Status/i);
      expect(selects[0]).toHaveAttribute("aria-busy", "true");
    });

    it("applies pending opacity to active asset button when isFilterPending", () => {
      render(
        <TransactionFilterSidebar
          {...mockProps}
          filters={{ ...defaultFilters, asset: "XLM" }}
          isFilterPending
        />,
      );

      const xlmButtons = screen.getAllByRole("button", { name: /^XLM$/i });
      expect(xlmButtons[0].className).toContain("opacity-70");
    });
  });

  // ── Asset button interactions ──────────────────────────────────────────────

  describe("Asset button animations", () => {
    it("marks active asset button with aria-pressed=true", () => {
      render(
        <TransactionFilterSidebar
          {...mockProps}
          filters={{ ...defaultFilters, asset: "USDC" }}
        />,
      );

      const usdcButtons = screen.getAllByRole("button", { name: /^USDC$/i });
      expect(usdcButtons[0]).toHaveAttribute("aria-pressed", "true");
    });

    it("marks inactive asset buttons with aria-pressed=false", () => {
      render(
        <TransactionFilterSidebar
          {...mockProps}
          filters={{ ...defaultFilters, asset: "USDC" }}
        />,
      );

      const xlmButtons = screen.getAllByRole("button", { name: /^XLM$/i });
      expect(xlmButtons[0]).toHaveAttribute("aria-pressed", "false");
    });

    it("calls onFilterChange when an asset button is clicked", () => {
      render(<TransactionFilterSidebar {...mockProps} />);

      const xlmButtons = screen.getAllByRole("button", { name: /^XLM$/i });
      fireEvent.click(xlmButtons[0]);
      expect(mockProps.onFilterChange).toHaveBeenCalledWith("asset", "XLM");
    });
  });

  // ── Clear All flash ────────────────────────────────────────────────────────

  describe("Clear All button", () => {
    it("calls onClearAll when clicked and enabled", () => {
      render(<TransactionFilterSidebar {...mockProps} hasActiveFilters />);

      const clearAllButtons = screen.getAllByRole("button", { name: /Clear All Filters/i });
      fireEvent.click(clearAllButtons[0]);
      expect(mockProps.onClearAll).toHaveBeenCalled();
    });

    it("is disabled when hasActiveFilters is false", () => {
      render(<TransactionFilterSidebar {...mockProps} hasActiveFilters={false} />);

      const clearAllButtons = screen.getAllByRole("button", { name: /Clear All Filters/i });
      expect(clearAllButtons[0]).toBeDisabled();
    });
  });

  // ── Accessibility ──────────────────────────────────────────────────────────

  describe("Accessibility", () => {
    it("has dialog role with label on mobile drawer", () => {
      render(<TransactionFilterSidebar {...mockProps} />);
      expect(screen.getByRole("dialog", { name: /Filter sidebar/i })).toBeInTheDocument();
    });

    it("asset group has accessible label", () => {
      render(<TransactionFilterSidebar {...mockProps} />);
      expect(screen.getAllByRole("group", { name: /Asset filter/i }).length).toBeGreaterThan(0);
    });
  });
});