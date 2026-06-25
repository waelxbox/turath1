/**
 * useSessionState — useState that persists to sessionStorage.
 *
 * State survives component unmount/remount (e.g. navigating between tabs)
 * but is cleared when the browser tab is closed.
 *
 * Key is scoped per-project so different projects don't collide.
 */
import { useState, useCallback, useRef } from "react";

export function useSessionState<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  // Read from sessionStorage on first render only
  const [state, setState] = useState<T>(() => {
    try {
      const stored = sessionStorage.getItem(key);
      if (stored !== null) {
        const parsed = JSON.parse(stored);
        return parsed as T;
      }
    } catch {
      // Ignore parse errors
    }
    return initialValue;
  });

  // Keep a ref to avoid stale closures in the setter
  const stateRef = useRef(state);
  stateRef.current = state;

  const setPersistedState = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next = typeof value === "function" ? (value as (prev: T) => T)(prev) : value;
        try {
          sessionStorage.setItem(key, JSON.stringify(next));
        } catch {
          // Storage full or unavailable — degrade gracefully
        }
        return next;
      });
    },
    [key]
  );

  const clear = useCallback(() => {
    sessionStorage.removeItem(key);
    setState(initialValue);
  }, [key, initialValue]);

  return [state, setPersistedState, clear];
}
