import { useEffect, useReducer, useCallback, useRef } from "react";

interface Balance {
  code: string;
  balance: string;
}

interface UseBalanceSyncOptions {
  pollingInterval?: number;
  onUpdate?: (balances: Balance[]) => void;
  enabled?: boolean;
  address?: string | null;
  horizonUrl?: string;
}

interface BalanceSyncState {
  balances: Balance[];
  isLoading: boolean;
  lastUpdated: Date | null;
  error: string | null;
}

type BalanceSyncAction =
  | { type: "FETCH_START" }
  | { type: "FETCH_SUCCESS"; balances: Balance[]; at: Date }
  | { type: "FETCH_ERROR"; error: string };

const initialState: BalanceSyncState = {
  balances: [],
  isLoading: false,
  lastUpdated: null,
  error: null,
};

// Consolidating the related pieces of state into a reducer keeps the
// fetch lifecycle (start → success → error) explicit and prevents the
// inconsistent intermediate renders that separate setState calls can cause.
function balanceSyncReducer(
  state: BalanceSyncState,
  action: BalanceSyncAction,
): BalanceSyncState {
  switch (action.type) {
    case "FETCH_START":
      return { ...state, isLoading: true, error: null };
    case "FETCH_SUCCESS":
      return {
        balances: action.balances,
        isLoading: false,
        lastUpdated: action.at,
        error: null,
      };
    case "FETCH_ERROR":
      return { ...state, isLoading: false, error: action.error };
    default:
      return state;
  }
}

/**
 * Hook for real-time balance synchronization with polling and race condition prevention.
 */
export function useBalanceSync(
  merchantId: string | null | undefined,
  apiKey: string | null | undefined,
  options: UseBalanceSyncOptions = {}
) {
  const {
    pollingInterval = 30000,
    onUpdate,
    enabled = true,
    address = null,
    horizonUrl = "https://horizon-testnet.stellar.org"
  } = options;
  const [state, dispatch] = useReducer(balanceSyncReducer, initialState);
  const { balances, isLoading, lastUpdated, error } = state;
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchBalances = useCallback(async () => {
    if (!enabled) return;
    if (!address && (!merchantId || !apiKey)) return;

    // Cancel previous request to prevent race conditions
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    dispatch({ type: "FETCH_START" });
    try {
      let newBalances: Balance[] = [];

      if (address) {
        // Fetch from Horizon directly if address is provided
        const response = await fetch(`${horizonUrl}/accounts/${address}`, {
          signal: abortControllerRef.current.signal,
        });
        if (!response.ok) throw new Error("Failed to fetch account from Horizon");
        const data = await response.json();
        newBalances = data.balances.map((b: any) => ({
          code: b.asset_type === "native" ? "XLM" : b.asset_code,
          balance: b.balance,
        }));
      } else {
        // Fetch from merchant API
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
        const response = await fetch(`${apiUrl}/api/merchant/balances`, {
          headers: {
            "x-api-key": apiKey!,
          },
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) throw new Error("Failed to fetch balances from API");

        const data = await response.json();
        newBalances = (data.balances || []).map((b: any) => ({
          code: b.asset || b.code,
          balance: b.amount || b.balance,
        }));
      }

      dispatch({ type: "FETCH_SUCCESS", balances: newBalances, at: new Date() });
      onUpdate?.(newBalances);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      const message = error instanceof Error ? error.message : "Balance sync failed";
      console.error("Balance sync error:", error);
      dispatch({ type: "FETCH_ERROR", error: message });
    }
  }, [merchantId, apiKey, enabled, onUpdate, address, horizonUrl]);

  /**
   * Optimistically set a balance locally so the UI reflects a just-submitted
   * change immediately; the next poll reconciles it with the authoritative value.
   */
  const applyOptimistic = useCallback((code: string, balance: string) => {
    setBalances((prev) => {
      const index = prev.findIndex((b) => b.code === code);
      if (index === -1) return [...prev, { code, balance }];
      const next = [...prev];
      next[index] = { ...next[index], balance };
      return next;
    });
  }, []);

  useEffect(() => {
    fetchBalances();

    if (enabled && pollingInterval > 0) {
      const interval = setInterval(fetchBalances, pollingInterval);
      return () => {
        clearInterval(interval);
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
      };
    }
  }, [fetchBalances, enabled, pollingInterval]);

  return {
    balances,
    isLoading,
    lastUpdated,
    error,
    refresh: fetchBalances,
    applyOptimistic,
    isStale: lastUpdated ? Date.now() - lastUpdated.getTime() > pollingInterval * 2 : true,
  };
}
