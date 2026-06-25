"use client";

import React, { useId } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ─── Types ──────────────────────────────────────────────────────────────────

interface FilterState {
  search: string;
  status: string;
  asset: string;
  dateFrom: string;
  dateTo: string;
}

interface TransactionFilterSidebarProps {
  /** Optimistic filter state; updates synchronously on every interaction. */
  filters: FilterState;
  onFilterChange: (key: keyof FilterState, value: string) => void;
  onClearFilter: (key: keyof FilterState) => void;
  onClearAll: () => void;
  /** Reflects draft filters — keeps actions like Clear All responsive before URL sync. */
  hasActiveFilters: boolean;
  /**
   * When true the draft search value is ahead of the committed URL value;
   * a debounced flush is in flight.
   */
  searchSyncPending?: boolean;
  /**
   * When true a non-search filter is being committed to the URL inside a
   * React transition. Use to show a subtle loading state on the results area.
   */
  isFilterPending?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  "all",
  "pending",
  "confirmed",
  "failed",
  "refunded",
] as const;

const ASSET_OPTIONS = ["all", "XLM", "USDC"] as const;

// ─── Small reusable pieces ───────────────────────────────────────────────────

/** Spinning ring shown while a filter is syncing to the URL. */
function SyncSpinner({ label = "Syncing…" }: { label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--pluto-500)]"
    >
      {/* Accessible spinner */}
      <svg
        className="h-3 w-3 animate-spin"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Animated dot badge shown in the header when any filter is pending. */
function PendingBadge({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.span
          key="pending-badge"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={{ duration: 0.15 }}
          aria-hidden="true"
          className="ml-2 inline-flex items-center gap-1 rounded-full bg-[var(--pluto-50,#f0f4ff)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[var(--pluto-500)]"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--pluto-400)] opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--pluto-500)]" />
          </span>
          Applying
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/**
 * Thin animated progress bar shown at the top of the sidebar while any filter
 * change is in flight (either debounced search or transition-wrapped filter).
 */
function SyncProgressBar({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="sync-bar"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-x-0 top-0 h-[2px] overflow-hidden rounded-t-2xl"
          aria-hidden="true"
        >
          <motion.div
            className="h-full bg-gradient-to-r from-[var(--pluto-300)] via-[var(--pluto-500)] to-[var(--pluto-300)]"
            initial={{ x: "-100%" }}
            animate={{ x: "100%" }}
            transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function TransactionFilterSidebar({
  filters,
  onFilterChange,
  onClearFilter,
  onClearAll,
  hasActiveFilters,
  searchSyncPending = false,
  isFilterPending = false,
  isOpen = false,
  onClose,
}: TransactionFilterSidebarProps) {
  // Stable IDs for desktop vs mobile duplicate inputs (avoids duplicate-id a11y violations)
  const uid = useId();
  const anyPending = searchSyncPending || isFilterPending;

  const activeFilterCount = [
    filters.search !== "",
    filters.status !== "all",
    filters.asset !== "all",
    filters.dateFrom !== "",
    filters.dateTo !== "",
  ].filter(Boolean).length;

  const renderContent = (isMobile: boolean) => {
    const suffix = isMobile ? `-${uid}-mobile` : `-${uid}-desktop`;

    return (
      <div className="relative flex h-full flex-col rounded-2xl bg-white p-6 shadow-xl border border-[#E8E8E8]">
        {/* ── Sync progress bar ── */}
        <SyncProgressBar visible={anyPending} />

        {/* ── Header ── */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center">
            <h2 className="text-xl font-bold text-[#0A0A0A]">Filters</h2>
            {/* Optimistic active-filter count badge — updates before URL sync */}
            {activeFilterCount > 0 && (
              <span
                className="ml-2 rounded-full bg-[var(--pluto-500)] px-2 py-0.5 text-[10px] font-bold text-white"
                aria-hidden="true"
              >
                {activeFilterCount}
              </span>
            )}
            <PendingBadge visible={anyPending} />
            {/* Screen-reader live region for filter count announcements */}
            <span
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="sr-only"
            >
              {activeFilterCount > 0
                ? `${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} active`
                : ""}
            </span>
          </div>
          {onClose && isMobile && (
            <button
              onClick={onClose}
              className="rounded-full p-2 hover:bg-[#F5F5F5] transition-colors lg:hidden"
              aria-label="Close filters"
            >
              <svg
                className="h-5 w-5 text-[#6B6B6B]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>

        {/* ── Filter fields ── */}
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto pr-1 custom-scrollbar">

          {/* Search */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor={`sidebar-search${suffix}`}
                className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]"
              >
                Search
              </label>
              <AnimatePresence>
                {searchSyncPending && (
                  <motion.span
                    key="search-sync"
                    initial={{ opacity: 0, x: 4 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 4 }}
                    transition={{ duration: 0.15 }}
                  >
                    <SyncSpinner label="Applying search to results" />
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            <div className="relative">
              <input
                id={`sidebar-search${suffix}`}
                type="text"
                value={filters.search}
                onChange={(e) => onFilterChange("search", e.target.value)}
                aria-busy={searchSyncPending}
                aria-describedby={
                  searchSyncPending
                    ? `sidebar-search-hint${suffix}`
                    : undefined
                }
                placeholder="ID or description…"
                className={[
                  "w-full rounded-xl border bg-[#F9F9F9] py-2.5 pl-10 pr-9 text-sm text-[#0A0A0A]",
                  "placeholder:text-[#6B6B6B] focus:bg-white focus:outline-none transition-all duration-200",
                  searchSyncPending
                    ? "border-dashed border-[var(--pluto-400)] focus:border-[var(--pluto-500)]"
                    : "border-[#E8E8E8] focus:border-[var(--pluto-500)]",
                ].join(" ")}
              />

              {/* Search icon */}
              <svg
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A0A0A0]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>

              {/* Clear search button — shown when there's a value */}
              <AnimatePresence>
                {filters.search && (
                  <motion.button
                    key="clear-search"
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                    transition={{ duration: 0.12 }}
                    type="button"
                    onClick={() => onClearFilter("search")}
                    aria-label="Clear search"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-[#A0A0A0] hover:bg-[#F0F0F0] hover:text-[#0A0A0A] transition-colors"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2.5}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </motion.button>
                )}
              </AnimatePresence>
            </div>

            {/* Accessible hint when debounce is pending */}
            {searchSyncPending && (
              <p
                id={`sidebar-search-hint${suffix}`}
                className="text-[10px] text-[var(--pluto-500)] font-medium"
                aria-live="polite"
              >
                Applying to results…
              </p>
            )}
          </div>

          {/* Status */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor={`sidebar-status${suffix}`}
                className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]"
              >
                Status
              </label>
              <AnimatePresence>
                {isFilterPending && filters.status !== "all" && (
                  <motion.span
                    key="status-sync"
                    initial={{ opacity: 0, x: 4 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 4 }}
                    transition={{ duration: 0.15 }}
                    aria-hidden="true"
                  >
                    <SyncSpinner label="Applying status filter" />
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            <div className="relative">
              <select
                id={`sidebar-status${suffix}`}
                value={filters.status}
                onChange={(e) => onFilterChange("status", e.target.value)}
                aria-busy={isFilterPending}
                className={[
                  "w-full rounded-xl border bg-[#F9F9F9] px-4 py-2.5 text-sm text-[#0A0A0A] appearance-none cursor-pointer",
                  "focus:bg-white focus:outline-none transition-all duration-200",
                  isFilterPending
                    ? "border-dashed border-[var(--pluto-400)]"
                    : "border-[#E8E8E8] focus:border-[var(--pluto-500)]",
                ].join(" ")}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s === "all"
                      ? "All Statuses"
                      : s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>

              {/* Chevron icon */}
              <svg
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A0A0A0]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </div>
          </div>

          {/* Asset */}
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
              Asset
            </p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Asset filter">
              {ASSET_OPTIONS.map((a) => {
                const isActive = filters.asset === a;
                return (
                  <motion.button
                    key={a}
                    type="button"
                    onClick={() => onFilterChange("asset", a)}
                    whileTap={{ scale: 0.93 }}
                    aria-pressed={isActive}
                    aria-busy={isFilterPending && isActive}
                    className={[
                      "rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-widest transition-all duration-200",
                      isActive
                        ? "bg-[var(--pluto-500)] text-white shadow-md shadow-[var(--pluto-500)]/20"
                        : "border border-[#E8E8E8] bg-[#F9F9F9] text-[#6B6B6B] hover:border-[var(--pluto-300)] hover:bg-[var(--pluto-50,#f0f4ff)]",
                      isFilterPending && isActive ? "opacity-70" : "",
                    ].join(" ")}
                  >
                    {a === "all" ? "All" : a}
                    {isFilterPending && isActive && (
                      <span className="ml-1.5 inline-block" aria-hidden="true">
                        <SyncSpinner />
                      </span>
                    )}
                  </motion.button>
                );
              })}
            </div>
          </div>

          {/* Date Range */}
          <div className="mt-2 flex flex-col gap-4 border-t border-[#F0F0F0] pt-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
              Date Range
            </p>
            <div className="flex flex-col gap-3">
              {/* From */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor={`sidebar-date-from${suffix}`}
                    className="text-[10px] font-medium text-[#A0A0A0]"
                  >
                    From
                  </label>
                  <AnimatePresence>
                    {isFilterPending && filters.dateFrom && (
                      <motion.span
                        key="from-sync"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        <SyncSpinner label="Applying date from" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
                <input
                  id={`sidebar-date-from${suffix}`}
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => onFilterChange("dateFrom", e.target.value)}
                  aria-busy={isFilterPending}
                  className={[
                    "w-full rounded-xl border bg-[#F9F9F9] px-3 py-2 text-sm text-[#0A0A0A]",
                    "focus:outline-none [color-scheme:light] transition-all duration-200",
                    isFilterPending && filters.dateFrom
                      ? "border-dashed border-[var(--pluto-400)]"
                      : "border-[#E8E8E8] focus:border-[var(--pluto-500)]",
                  ].join(" ")}
                />
              </div>

              {/* To */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor={`sidebar-date-to${suffix}`}
                    className="text-[10px] font-medium text-[#A0A0A0]"
                  >
                    To
                  </label>
                  <AnimatePresence>
                    {isFilterPending && filters.dateTo && (
                      <motion.span
                        key="to-sync"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        <SyncSpinner label="Applying date to" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
                <input
                  id={`sidebar-date-to${suffix}`}
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => onFilterChange("dateTo", e.target.value)}
                  aria-busy={isFilterPending}
                  className={[
                    "w-full rounded-xl border bg-[#F9F9F9] px-3 py-2 text-sm text-[#0A0A0A]",
                    "focus:outline-none [color-scheme:light] transition-all duration-200",
                    isFilterPending && filters.dateTo
                      ? "border-dashed border-[var(--pluto-400)]"
                      : "border-[#E8E8E8] focus:border-[var(--pluto-500)]",
                  ].join(" ")}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="mt-8 border-t border-[#F0F0F0] pt-6">
          <motion.button
            type="button"
            onClick={onClearAll}
            disabled={!hasActiveFilters}
            whileTap={hasActiveFilters ? { scale: 0.97 } : undefined}
            aria-label={
              activeFilterCount > 0
                ? `Clear all ${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"}`
                : "Clear all filters"
            }
            className={[
              "w-full rounded-xl py-3 text-[10px] font-bold uppercase tracking-widest transition-all duration-200",
              "bg-[#0A0A0A] text-white hover:bg-[#2A2A2A] active:scale-[0.98]",
              "disabled:cursor-not-allowed disabled:opacity-20",
            ].join(" ")}
          >
            {anyPending ? (
              <span className="flex items-center justify-center gap-2">
                <SyncSpinner label="Clearing filters" />
                Clearing…
              </span>
            ) : (
              "Clear All Filters"
            )}
          </motion.button>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Desktop: persistent sticky panel */}
      <div
        className="hidden lg:block w-[320px] h-fit sticky top-24"
        role="complementary"
        aria-label="Transaction filters"
      >
        {renderContent(false)}
      </div>

      {/* Mobile: animated drawer */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm lg:hidden"
              aria-hidden="true"
            />

            {/* Drawer */}
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="fixed inset-y-0 right-0 z-[110] w-[min(320px,90vw)] lg:hidden overflow-y-auto"
              role="dialog"
              aria-modal="true"
              aria-label="Filter sidebar"
            >
              {renderContent(true)}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}