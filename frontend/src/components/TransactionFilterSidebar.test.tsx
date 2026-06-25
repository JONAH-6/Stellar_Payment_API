/** @vitest-environment jsdom */
/**
 * Unit tests for <TransactionFilterSidebar />
 *
 * Coverage
 * ────────
 * ✅ Rendering      — desktop panel, mobile drawer, all fields & options
 * ✅ Controlled     — every filter key reflected in the UI
 * ✅ Interactions   — every onChange / onClear handler fires correctly
 * ✅ Pending states — searchSyncPending, isFilterPending, anyPending
 * ✅ Accessibility  — roles, labels, aria-busy, aria-pressed,
 *                     aria-modal, aria-describedby, aria-live
 * ✅ Mobile drawer  — open/close via button and backdrop click
 * ✅ Edge cases     — disabled Clear All, hidden clear-search, "Clearing…"
 *
 * Component patches required (TransactionFilterSidebar.tsx):
 *   1. Add aria-label="Clear search" to the clear-search motion.button
 *   2. Add aria-hidden="true" to the SyncSpinner wrapper span inside asset buttons
 *      so the spinner text is excluded from the button's accessible name
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import TransactionFilterSidebar from "./TransactionFilterSidebar";

// ─── framer-motion mock ───────────────────────────────────────────────────────
// jsdom has no layout engine so framer-motion's measurement APIs fail.
// Every used export is replaced with a transparent pass-through that forwards
// ALL HTML/ARIA attributes (aria-pressed, aria-busy, aria-label, disabled…).

vi.mock("framer-motion", () => {
  const strip = (props: Record<string, unknown>) => {
    const { initial: _i, animate: _a, exit: _e, transition: _t, whileTap: _w, ...rest } = props;
    return rest;
  };

  return {
    motion: {
      div:    ({ children, ...p }: any) => <div    {...strip(p)}>{children}</div>,
      aside:  ({ children, ...p }: any) => <aside  {...strip(p)}>{children}</aside>,
      span:   ({ children, ...p }: any) => <span   {...strip(p)}>{children}</span>,
      // button MUST forward every prop including aria-* and disabled
      button: ({ children, ...p }: any) => <button {...strip(p)}>{children}</button>,
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DEFAULT_FILTERS = {
  search:   "",
  status:   "all",
  asset:    "all",
  dateFrom: "",
  dateTo:   "",
};

function buildProps(
  overrides: Partial<React.ComponentProps<typeof TransactionFilterSidebar>> = {},
) {
  return {
    filters:           DEFAULT_FILTERS,
    onFilterChange:    vi.fn(),
    onClearFilter:     vi.fn(),
    onClearAll:        vi.fn(),
    hasActiveFilters:  false,
    isOpen:            false,
    onClose:           vi.fn(),
    searchSyncPending: false,
    isFilterPending:   false,
    ...overrides,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the always-present desktop sticky panel. */
function getDesktopPanel(container: HTMLElement) {
  return container.querySelector(".hidden.lg\\:block") as HTMLElement;
}

/**
 * getByLabelText matches ANY element whose accessible name includes the text,
 * including role="status" spinners whose aria-label contains "Search", "From",
 * or "To". Adding selector: 'input' or selector: 'select' pins the query to
 * the actual form control so we never get a "Found multiple elements" error.
 */
function getInput(panel: HTMLElement, label: RegExp) {
  return within(panel).getByLabelText(label, { selector: "input" });
}
function getSelect(panel: HTMLElement, label: RegExp) {
  return within(panel).getByLabelText(label, { selector: "select" });
}

// =============================================================================

describe("TransactionFilterSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Rendering ────────────────────────────────────────────────────────

  describe("1 · Rendering", () => {
    describe("desktop panel", () => {
      it("always renders the sticky desktop panel", () => {
        const { container } = render(<TransactionFilterSidebar {...buildProps()} />);
        expect(getDesktopPanel(container)).toBeInTheDocument();
      });

      it("renders the 'Filters' heading", () => {
        const { container } = render(<TransactionFilterSidebar {...buildProps()} />);
        expect(within(getDesktopPanel(container)).getByText("Filters")).toBeInTheDocument();
      });

      it("renders Search input, Status select, Asset group, From and To date inputs", () => {
        const { container } = render(<TransactionFilterSidebar {...buildProps()} />);
        const panel = getDesktopPanel(container);
        expect(getInput(panel, /Search/i)).toBeInTheDocument();
        expect(getSelect(panel, /Status/i)).toBeInTheDocument();
        expect(within(panel).getByRole("group", { name: /Asset filter/i })).toBeInTheDocument();
        expect(getInput(panel, /From/i)).toBeInTheDocument();
        expect(getInput(panel, /To/i)).toBeInTheDocument();
      });

      it("renders all 5 status options with correct display labels", () => {
        const { container } = render(<TransactionFilterSidebar {...buildProps()} />);
        const select = getSelect(getDesktopPanel(container), /Status/i) as HTMLSelectElement;
        expect(Array.from(select.options).map((o) => o.text)).toEqual([
          "All Statuses", "Pending", "Confirmed", "Failed", "Refunded",
        ]);
      });

      it("renders All / XLM / USDC asset buttons", () => {
        const { container } = render(<TransactionFilterSidebar {...buildProps()} />);
        const group = within(getDesktopPanel(container)).getByRole("group", { name: /Asset filter/i });
        expect(within(group).getByRole("button", { name: /^All$/i })).toBeInTheDocument();
        expect(within(group).getByRole("button", { name: /^XLM$/i })).toBeInTheDocument();
        expect(within(group).getByRole("button", { name: /^USDC$/i })).toBeInTheDocument();
      });

      it("renders the 'Clear All Filters' footer button", () => {
        const { container } = render(<TransactionFilterSidebar {...buildProps()} />);
        expect(
          within(getDesktopPanel(container)).getByRole("button", { name: /Clear All Filters/i }),
        ).toBeInTheDocument();
      });
    });

    describe("mobile drawer", () => {
      it("does NOT render the dialog when isOpen=false", () => {
        render(<TransactionFilterSidebar {...buildProps({ isOpen: false })} />);
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });

      it("renders the dialog when isOpen=true", () => {
        render(<TransactionFilterSidebar {...buildProps({ isOpen: true })} />);
        expect(screen.getByRole("dialog", { name: /Filter sidebar/i })).toBeInTheDocument();
      });

      it("dialog has aria-modal='true'", () => {
        render(<TransactionFilterSidebar {...buildProps({ isOpen: true })} />);
        expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
      });

      it("dialog contains all the same filter fields as the desktop panel", () => {
        render(<TransactionFilterSidebar {...buildProps({ isOpen: true })} />);
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByLabelText(/Search/i, { selector: "input" })).toBeInTheDocument();
        expect(within(dialog).getByLabelText(/Status/i, { selector: "select" })).toBeInTheDocument();
        expect(within(dialog).getByRole("group", { name: /Asset filter/i })).toBeInTheDocument();
        expect(within(dialog).getByLabelText(/From/i, { selector: "input" })).toBeInTheDocument();
        expect(within(dialog).getByLabelText(/To/i,   { selector: "input" })).toBeInTheDocument();
      });
    });

    describe("controlled values", () => {
      it("reflects search value in the search input", () => {
        const { container } = render(
          <TransactionFilterSidebar
            {...buildProps({ filters: { ...DEFAULT_FILTERS, search: "abc-123" } })}
          />,
        );
        expect(getInput(getDesktopPanel(container), /Search/i)).toHaveValue("abc-123");
      });

      it("reflects status value in the status select", () => {
        const { container } = render(
          <TransactionFilterSidebar
            {...buildProps({ filters: { ...DEFAULT_FILTERS, status: "failed" } })}
          />,
        );
        expect(getSelect(getDesktopPanel(container), /Status/i)).toHaveValue("failed");
      });

      it("reflects dateFrom value", () => {
        const { container } = render(
          <TransactionFilterSidebar
            {...buildProps({ filters: { ...DEFAULT_FILTERS, dateFrom: "2024-03-01" } })}
          />,
        );
        expect(getInput(getDesktopPanel(container), /From/i)).toHaveValue("2024-03-01");
      });

      it("reflects dateTo value", () => {
        const { container } = render(
          <TransactionFilterSidebar
            {...buildProps({ filters: { ...DEFAULT_FILTERS, dateTo: "2024-12-31" } })}
          />,
        );
        expect(getInput(getDesktopPanel(container), /To/i)).toHaveValue("2024-12-31");
      });

      it("marks active asset button with aria-pressed='true'", () => {
        const { container } = render(
          <TransactionFilterSidebar
            {...buildProps({ filters: { ...DEFAULT_FILTERS, asset: "USDC" } })}
          />,
        );
        const group = within(getDesktopPanel(container)).getByRole("group", { name: /Asset filter/i });
        expect(within(group).getByRole("button", { name: /^USDC$/i })).toHaveAttribute("aria-pressed", "true");
      });

      it("marks inactive asset buttons with aria-pressed='false'", () => {
        const { container } = render(
          <TransactionFilterSidebar
            {...buildProps({ filters: { ...DEFAULT_FILTERS, asset: "USDC" } })}
          />,
        );
        const group = within(getDesktopPanel(container)).getByRole("group", { name: /Asset filter/i });
        expect(within(group).getByRole("button", { name: /^XLM$/i })).toHaveAttribute("aria-pressed", "false");
        expect(within(group).getByRole("button", { name: /^All$/i })).toHaveAttribute("aria-pressed", "false");
      });
    });
  });

  // ── 2. Interactions ──────────────────────────────────────────────────────

  describe("2 · Interactions", () => {
    describe("search input", () => {
      it("calls onFilterChange('search', value) on change", async () => {
        const props = buildProps();
        const { container } = render(<TransactionFilterSidebar {...props} />);
        await userEvent.type(getInput(getDesktopPanel(container), /Search/i), "x");
        expect(props.onFilterChange).toHaveBeenCalledWith("search", "x");
      });

      it("does NOT render clear-search button when search is empty", () => {
        const { container } = render(<TransactionFilterSidebar {...buildProps()} />);
        expect(within(getDesktopPanel(container)).queryByLabelText(/Clear search/i)).not.toBeInTheDocument();
      });

      it("renders clear-search button when search has a value", () => {
        const { container } = render(
          <TransactionFilterSidebar
            {...buildProps({ filters: { ...DEFAULT_FILTERS, search: "query" } })}
          />,
        );
        expect(within(getDesktopPanel(container)).getByLabelText(/Clear search/i)).toBeInTheDocument();
      });

      it("calls onClearFilter('search') when clear-search button is clicked", () => {
        const props = buildProps({ filters: { ...DEFAULT_FILTERS, search: "query" } });
        const { container } = render(<TransactionFilterSidebar {...props} />);
        fireEvent.click(within(getDesktopPanel(container)).getByLabelText(/Clear search/i));
        expect(props.onClearFilter).toHaveBeenCalledWith("search");
      });
    });

    describe("status select", () => {
      it.each(["pending", "confirmed", "failed", "refunded"] as const)(
        "calls onFilterChange('status', '%s')",
        (status) => {
          const props = buildProps();
          const { container } = render(<TransactionFilterSidebar {...props} />);
          fireEvent.change(getSelect(getDesktopPanel(container), /Status/i), {
            target: { value: status },
          });
          expect(props.onFilterChange).toHaveBeenCalledWith("status", status);
        },
      );
    });

    describe("asset buttons", () => {
      it.each(["all", "XLM", "USDC"] as const)(
        "calls onFilterChange('asset', '%s') on click",
        (asset) => {
          const props = buildProps();
          const { container } = render(<TransactionFilterSidebar {...props} />);
          const group = within(getDesktopPanel(container)).getByRole("group", { name: /Asset filter/i });
          const label = asset === "all" ? /^All$/i : new RegExp(`^${asset}$`, "i");
          fireEvent.click(within(group).getByRole("button", { name: label }));
          expect(props.onFilterChange).toHaveBeenCalledWith("asset", asset);
        },
      );
    });

    describe("date inputs", () => {
      it("calls onFilterChange('dateFrom', value)", () => {
        const props = buildProps();
        const { container } = render(<TransactionFilterSidebar {...props} />);
        fireEvent.change(getInput(getDesktopPanel(container), /From/i), {
          target: { value: "2024-01-15" },
        });
        expect(props.onFilterChange).toHaveBeenCalledWith("dateFrom", "2024-01-15");
      });

      it("calls onFilterChange('dateTo', value)", () => {
        const props = buildProps();
        const { container } = render(<TransactionFilterSidebar {...props} />);
        fireEvent.change(getInput(getDesktopPanel(container), /To/i), {
          target: { value: "2024-06-30" },
        });
        expect(props.onFilterChange).toHaveBeenCalledWith("dateTo", "2024-06-30");
      });
    });

    describe("Clear All button", () => {
      it("is disabled when hasActiveFilters=false", () => {
        const { container } = render(
          <TransactionFilterSidebar {...buildProps({ hasActiveFilters: false })} />,
        );
        expect(
          within(getDesktopPanel(container)).getByRole("button", { name: /Clear All Filters/i }),
        ).toBeDisabled();
      });

      it("is enabled when hasActiveFilters=true", () => {
        const { container } = render(
          <TransactionFilterSidebar {...buildProps({ hasActiveFilters: true })} />,
        );
        expect(
          within(getDesktopPanel(container)).getByRole("button", { name: /Clear All Filters/i }),
        ).not.toBeDisabled();
      });

      it("calls onClearAll when clicked while enabled", () => {
        const props = buildProps({ hasActiveFilters: true });
        const { container } = render(<TransactionFilterSidebar {...props} />);
        fireEvent.click(
          within(getDesktopPanel(container)).getByRole("button", { name: /Clear All Filters/i }),
        );
        expect(props.onClearAll).toHaveBeenCalledTimes(1);
      });

      it("does NOT call onClearAll when clicked while disabled", () => {
        const props = buildProps({ hasActiveFilters: false });
        const { container } = render(<TransactionFilterSidebar {...props} />);
        fireEvent.click(
          within(getDesktopPanel(container)).getByRole("button", { name: /Clear All Filters/i }),
        );
        expect(props.onClearAll).not.toHaveBeenCalled();
      });
    });
  });

  // ── 3. Pending visual feedback ───────────────────────────────────────────

  describe("3 · Pending visual feedback", () => {
    describe("searchSyncPending", () => {
      it("sets aria-busy='true' on search input", () => {
        const { container } = render(
          <TransactionFilterSidebar
            {...buildProps({ filters: { ...DEFAULT_FILTERS, search: "q" }, searchSyncPending: true })}
          />,
        );
        expect(getInput(getDesktopPanel(container), /Search/i)).toHaveAttribute("aria-busy", "true");
      });

      it("sets aria-busy='false' on search input when not pending", () => {
        const { container } = render(<TransactionFilterSidebar {...buildProps()} />);
        expect(getInput(getDesktopPanel(container), /Search/i)).toHaveAttribute("aria-busy", "false");
      });

      it("shows 'Applying to results…' hint with aria-live='polite'", () => {
        const { container } = render(
          <TransactionFilterSidebar
            {...buildProps({ filters: { ...DEFAULT_FILTERS, search: "q" }, searchSyncPending: true })}
          />,
        );
        const hint = within(getDesktopPanel(container)).getByText(/Applying to results/i);
        expect(hint).toBeInTheDocument();
        expect(hint).toHaveAttribute("aria-live", "polite");
      });

      it("hides hint when not pending", () => {
        const { container } = render(<TransactionFilterSidebar {...buildProps()} />);
        expect(
          within(getDesktopPanel(container)).queryByText(/Applying to results/i),
        ).not.toBeInTheDocument();
      });

      it("links search input to hint via aria-describedby", () => {
        const { container } = render(
          <TransactionFilterSidebar
            {...buildProps({ filters: { ...DEFAULT_FILTERS, search: "q" }, searchSyncPending: true })}
          />,
        );
        const panel  = getDesktopPanel(container);
        const input  = getInput(panel, /Search/i);
        const hintId = input.getAttribute("aria-describedby");
        expect(hintId).toBeTruthy();
        // The hint <p> shares the same id suffix as the desktop input; query the
        // full container because both desktop and mobile panels are in the DOM.
        const hintEl = container.querySelector(`#${hintId}`);
        expect(hintEl).toBeInTheDocument();
        expect(hintEl?.textContent).toMatch(/Applying to results/i);
      });

      it("applies dashed border to search input", () => {
        const { container } = render(
          <TransactionFilterSidebar
            {...buildProps({ filters: { ...DEFAULT_FILTERS, search: "q" }, searchSyncPending: true })}
          />,
        );
        expect(getInput(getDesktopPanel(container), /Search/i).className).toContain("border-dashed");
      });

      it("does NOT apply dashed border when not pending", () => {
        const { container } = render(<TransactionFilterSidebar {...buildProps()} />);
        expect(getInput(getDesktopPanel(container), /Search/i).className).not.toContain("border-dashed");
      });
    });

    describe("isFilterPending", () => {
      it("sets aria-busy='true' on status select", () => {
        const { container } = render(
          <TransactionFilterSidebar {...buildProps({ isFilterPending: true })} />,
        );
        expect(getSelect(getDesktopPanel(container), /Status/i)).toHaveAttribute("aria-busy", "true");
      });

      it("applies dashed border to status select", () => {
        const { container } = render(
          <TransactionFilterSidebar {...buildProps({ isFilterPending: true })} />,
        );
        expect(getSelect(getDesktopPanel(container), /Status/i).className).toContain("border-dashed");
      });

      it("sets aria-busy='true' on dateFrom and dateTo inputs", () => {
        const { container } = render(
          <TransactionFilterSidebar {...buildProps({ isFilterPending: true })} />,
        );
        const panel = getDesktopPanel(container);
        expect(getInput(panel, /From/i)).toHaveAttribute("aria-busy", "true");
        expect(getInput(panel, /To/i)).toHaveAttribute("aria-busy", "true");
      });

      it("applies dashed border to dateFrom when set + pending", () => {
        const { container } = render(
          <TransactionFilterSidebar
            {...buildProps({
              filters: { ...DEFAULT_FILTERS, dateFrom: "2024-01-01" },
              isFilterPending: true,
            })}
          />,
        );
        expect(getInput(getDesktopPanel(container), /From/i).className).toContain("border-dashed");
      });

      it("applies dashed border to dateTo when set + pending", () => {
        const { container } = render(
          <TransactionFilterSidebar
            {...buildProps({
              filters: { ...DEFAULT_FILTERS, dateTo: "2024-12-31" },
              isFilterPending: true,
            })}
          />,
        );
        expect(getInput(getDesktopPanel(container), /To/i).className).toContain("border-dashed");
      });

      it("applies opacity-70 to the active asset button when pending — queried by aria-pressed", () => {
        // The XLM button's accessible name becomes "XLMSyncing…" when the SyncSpinner
        // is rendered inside it without aria-hidden. Until the component patch is applied
        // (aria-hidden="true" on the spinner wrapper), we locate the button via
        // aria-pressed="true" instead of by name.
        const { container } = render(
          <TransactionFilterSidebar
            {...buildProps({
              filters: { ...DEFAULT_FILTERS, asset: "XLM" },
              isFilterPending: true,
            })}
          />,
        );
        const group = within(getDesktopPanel(container)).getByRole("group", { name: /Asset filter/i });
        const activeBtn = within(group).getByRole("button", { pressed: true });
        expect(activeBtn.className).toContain("opacity-70");
      });

      it("does NOT apply opacity-70 to inactive asset buttons", () => {
        const { container } = render(
          <TransactionFilterSidebar
            {...buildProps({
              filters: { ...DEFAULT_FILTERS, asset: "XLM" },
              isFilterPending: true,
            })}
          />,
        );
        const group = within(getDesktopPanel(container)).getByRole("group", { name: /Asset filter/i });
        // USDC is inactive — its name is unambiguous regardless of patch status
        expect(within(group).getByRole("button", { name: /^USDC$/i }).className).not.toContain("opacity-70");
      });

      it("active asset button has aria-pressed='true'", () => {
        const { container } = render(
          <TransactionFilterSidebar
            {...buildProps({ filters: { ...DEFAULT_FILTERS, asset: "USDC" } })}
          />,
        );
        const group = within(getDesktopPanel(container)).getByRole("group", { name: /Asset filter/i });
        expect(within(group).getByRole("button", { name: /^USDC$/i })).toHaveAttribute("aria-pressed", "true");
      });

      it("inactive asset buttons have aria-pressed='false'", () => {
        const { container } = render(
          <TransactionFilterSidebar
            {...buildProps({ filters: { ...DEFAULT_FILTERS, asset: "USDC" } })}
          />,
        );
        const group = within(getDesktopPanel(container)).getByRole("group", { name: /Asset filter/i });
        // XLM is inactive here — no spinner inside, name is unambiguous
        expect(within(group).getByRole("button", { name: /^XLM$/i })).toHaveAttribute("aria-pressed", "false");
        expect(within(group).getByRole("button", { name: /^All$/i })).toHaveAttribute("aria-pressed", "false");
      });
    });

    describe("anyPending (searchSyncPending || isFilterPending)", () => {
      it("shows 'Clearing…' on Clear All when searchSyncPending=true", () => {
        const { container } = render(
          <TransactionFilterSidebar
            {...buildProps({ hasActiveFilters: true, searchSyncPending: true })}
          />,
        );
        expect(within(getDesktopPanel(container)).getByText(/Clearing…/i)).toBeInTheDocument();
      });

      it("shows 'Clearing…' on Clear All when isFilterPending=true", () => {
        const { container } = render(
          <TransactionFilterSidebar
            {...buildProps({ hasActiveFilters: true, isFilterPending: true })}
          />,
        );
        expect(within(getDesktopPanel(container)).getByText(/Clearing…/i)).toBeInTheDocument();
      });

      it("shows 'Clear All Filters' label when no pending flags are set", () => {
        const { container } = render(
          <TransactionFilterSidebar {...buildProps({ hasActiveFilters: true })} />,
        );
        const panel = getDesktopPanel(container);
        expect(within(panel).queryByText(/Clearing…/i)).not.toBeInTheDocument();
        expect(within(panel).getByText(/Clear All Filters/i)).toBeInTheDocument();
      });

      it("SyncSpinner renders with role='status' while pending", () => {
        const { container } = render(
          <TransactionFilterSidebar
            {...buildProps({ searchSyncPending: true, filters: { ...DEFAULT_FILTERS, search: "q" } })}
          />,
        );
        expect(within(getDesktopPanel(container)).getAllByRole("status").length).toBeGreaterThan(0);
      });
    });
  });

  // ── 4. Accessibility ─────────────────────────────────────────────────────

  describe("4 · Accessibility", () => {
    it("search input type is 'text'", () => {
      const { container } = render(<TransactionFilterSidebar {...buildProps()} />);
      expect(getInput(getDesktopPanel(container), /Search/i)).toHaveAttribute("type", "text");
    });

    it("date inputs type is 'date'", () => {
      const { container } = render(<TransactionFilterSidebar {...buildProps()} />);
      const panel = getDesktopPanel(container);
      expect(getInput(panel, /From/i)).toHaveAttribute("type", "date");
      expect(getInput(panel, /To/i)).toHaveAttribute("type", "date");
    });

    it("search input has a descriptive placeholder", () => {
      const { container } = render(<TransactionFilterSidebar {...buildProps()} />);
      expect(
        within(getDesktopPanel(container)).getByPlaceholderText(/ID or description/i),
      ).toBeInTheDocument();
    });

    it("decorative SVGs carry aria-hidden='true'", () => {
      const { container } = render(<TransactionFilterSidebar {...buildProps()} />);
      expect(
        getDesktopPanel(container).querySelectorAll("svg[aria-hidden='true']").length,
      ).toBeGreaterThan(0);
    });

    it("asset button group has role='group' with accessible aria-label", () => {
      const { container } = render(<TransactionFilterSidebar {...buildProps()} />);
      expect(
        within(getDesktopPanel(container)).getByRole("group", { name: /Asset filter/i }),
      ).toBeInTheDocument();
    });

    it("Status label is linked to the select element", () => {
      const { container } = render(<TransactionFilterSidebar {...buildProps()} />);
      expect(getSelect(getDesktopPanel(container), /Status/i).tagName).toBe("SELECT");
    });

    it("Search label is linked to a text input", () => {
      const { container } = render(<TransactionFilterSidebar {...buildProps()} />);
      const el = getInput(getDesktopPanel(container), /Search/i);
      expect(el.tagName).toBe("INPUT");
      expect(el).toHaveAttribute("type", "text");
    });
  });

  // ── 5. Mobile drawer ─────────────────────────────────────────────────────

  describe("5 · Mobile drawer", () => {
    it("renders Close filters button inside the dialog", () => {
      render(<TransactionFilterSidebar {...buildProps({ isOpen: true })} />);
      expect(
        within(screen.getByRole("dialog")).getByLabelText(/Close filters/i),
      ).toBeInTheDocument();
    });

    it("calls onClose when Close filters button is clicked", () => {
      const props = buildProps({ isOpen: true });
      render(<TransactionFilterSidebar {...props} />);
      fireEvent.click(screen.getByLabelText(/Close filters/i));
      expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    it("calls onClose when the backdrop overlay is clicked", () => {
      const props = buildProps({ isOpen: true });
      const { container } = render(<TransactionFilterSidebar {...props} />);
      const backdrop = container.querySelector(".fixed.inset-0[aria-hidden='true']");
      expect(backdrop).toBeInTheDocument();
      fireEvent.click(backdrop!);
      expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    it("mobile search input calls onFilterChange on change", () => {
      const props = buildProps({ isOpen: true });
      render(<TransactionFilterSidebar {...props} />);
      fireEvent.change(
        within(screen.getByRole("dialog")).getByLabelText(/Search/i, { selector: "input" }),
        { target: { value: "mobile-query" } },
      );
      expect(props.onFilterChange).toHaveBeenCalledWith("search", "mobile-query");
    });

    it("mobile Clear All button calls onClearAll", () => {
      const props = buildProps({ isOpen: true, hasActiveFilters: true });
      render(<TransactionFilterSidebar {...props} />);
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: /Clear All Filters/i }),
      );
      expect(props.onClearAll).toHaveBeenCalled();
    });
  });

  // ── 6. Edge cases ────────────────────────────────────────────────────────

  describe("6 · Edge cases", () => {
    it("renders without crashing when onClose is undefined (desktop-only usage)", () => {
      expect(() =>
        render(<TransactionFilterSidebar {...buildProps({ onClose: undefined })} />),
      ).not.toThrow();
    });

    it("renders without crashing with every flag and filter active simultaneously", () => {
      expect(() =>
        render(
          <TransactionFilterSidebar
            {...buildProps({
              filters: {
                search: "tx-999", status: "refunded",
                asset: "USDC", dateFrom: "2024-01-01", dateTo: "2024-12-31",
              },
              hasActiveFilters:  true,
              searchSyncPending: true,
              isFilterPending:   true,
              isOpen:            true,
            })}
          />,
        ),
      ).not.toThrow();
    });

    it("'Clearing…' button stays disabled even while pending when hasActiveFilters=false", () => {
      const { container } = render(
        <TransactionFilterSidebar
          {...buildProps({ hasActiveFilters: false, isFilterPending: true })}
        />,
      );
      const btn = within(getDesktopPanel(container)).getByText(/Clearing…/i).closest("button");
      expect(btn).toBeDisabled();
    });
  });

  // ── 7. Screen reader & optimistic updates (#939, #940, #941) ─────────────

  describe("7 · Screen reader & optimistic updates (#939 #940 #941)", () => {
    // #940 — desktop landmark role
    it("desktop panel has role='complementary' with accessible label", () => {
      const { container } = render(<TransactionFilterSidebar {...buildProps()} />);
      const panel = getDesktopPanel(container);
      expect(panel).toHaveAttribute("role", "complementary");
      expect(panel).toHaveAttribute("aria-label", "Transaction filters");
    });

    // #940 — SyncSpinner inside asset buttons must be decorative so it doesn't
    //         corrupt the button's accessible name with "Syncing…"
    it("SyncSpinner wrapper inside active asset button has aria-hidden='true'", () => {
      const { container } = render(
        <TransactionFilterSidebar
          {...buildProps({ filters: { ...DEFAULT_FILTERS, asset: "USDC" }, isFilterPending: true })}
        />,
      );
      const panel = getDesktopPanel(container);
      const usdc = within(panel).getByRole("button", { name: /USDC/i });
      // The span wrapping SyncSpinner must hide spinner text from the button label.
      const hiddenSpan = usdc.querySelector("span[aria-hidden='true']");
      expect(hiddenSpan).toBeInTheDocument();
    });

    // #941 — optimistic active-filter count badge
    it("shows no count badge when no filters are active", () => {
      const { container } = render(<TransactionFilterSidebar {...buildProps()} />);
      const panel = getDesktopPanel(container);
      // Badge is the aria-hidden span next to the heading.
      const badge = within(panel).queryByText(/^\d+$/);
      expect(badge).not.toBeInTheDocument();
    });

    it("shows count badge of 1 when only search is active", () => {
      const { container } = render(
        <TransactionFilterSidebar
          {...buildProps({ filters: { ...DEFAULT_FILTERS, search: "tx-abc" }, hasActiveFilters: true })}
        />,
      );
      const panel = getDesktopPanel(container);
      // aria-hidden badge with the count number
      expect(within(panel).getByText("1")).toBeInTheDocument();
    });

    it("shows correct count when multiple filters are active", () => {
      const { container } = render(
        <TransactionFilterSidebar
          {...buildProps({
            filters: {
              search: "tx-999",
              status: "confirmed",
              asset: "USDC",
              dateFrom: "2024-01-01",
              dateTo: "2024-12-31",
            },
            hasActiveFilters: true,
          })}
        />,
      );
      const panel = getDesktopPanel(container);
      expect(within(panel).getByText("5")).toBeInTheDocument();
    });

    // #940 — live region for screen-reader filter count announcements
    it("renders a polite live region for active filter count", () => {
      const { container } = render(<TransactionFilterSidebar {...buildProps()} />);
      const panel = getDesktopPanel(container);
      const live = within(panel).getByRole("status");
      expect(live).toBeInTheDocument();
      expect(live).toHaveAttribute("aria-live", "polite");
    });

    it("live region is empty when no filters are active", () => {
      const { container } = render(<TransactionFilterSidebar {...buildProps()} />);
      const panel = getDesktopPanel(container);
      const live = within(panel).getByRole("status");
      expect(live.textContent).toBe("");
    });

    it("live region announces singular count text when one filter is active", () => {
      const { container } = render(
        <TransactionFilterSidebar
          {...buildProps({ filters: { ...DEFAULT_FILTERS, search: "q" }, hasActiveFilters: true })}
        />,
      );
      const panel = getDesktopPanel(container);
      const live = within(panel).getByRole("status");
      expect(live).toHaveTextContent("1 filter active");
    });

    it("live region announces plural count text when multiple filters are active", () => {
      const { container } = render(
        <TransactionFilterSidebar
          {...buildProps({
            filters: { ...DEFAULT_FILTERS, search: "q", status: "confirmed" },
            hasActiveFilters: true,
          })}
        />,
      );
      const panel = getDesktopPanel(container);
      const live = within(panel).getByRole("status");
      expect(live).toHaveTextContent("2 filters active");
    });

    // #941 — Clear All accessible label reflects the active filter count
    it("Clear All button aria-label includes the active count", () => {
      const { container } = render(
        <TransactionFilterSidebar
          {...buildProps({
            filters: { ...DEFAULT_FILTERS, status: "confirmed", asset: "XLM" },
            hasActiveFilters: true,
          })}
        />,
      );
      const panel = getDesktopPanel(container);
      const btn = within(panel).getByRole("button", { name: /clear all 2 active filters/i });
      expect(btn).toBeInTheDocument();
    });

    it("Clear All button aria-label is generic when no filters are active", () => {
      const { container } = render(<TransactionFilterSidebar {...buildProps()} />);
      const panel = getDesktopPanel(container);
      const btn = within(panel).getByRole("button", { name: /clear all filters/i });
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveAttribute("aria-label", "Clear all filters");
    });

    // #940 — mobile dialog still has its landmark attributes
    it("mobile dialog retains role='dialog' and aria-modal when open", () => {
      render(<TransactionFilterSidebar {...buildProps({ isOpen: true })} />);
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute("aria-label", "Filter sidebar");
    });
  });
});