// Assignment-status store, persisted to localStorage. Holds the lifecycle status of
// each (event, partner) pair and any backups the user manually "assigns" in the
// overflow view. No real outreach happens — "send reminder" just advances a chip.
import { createContext, useContext, useState, useCallback, useMemo } from "react";

const KEY = "ftc-distribution-assignments-v1";
const StatusCtx = createContext(null);
const keyOf = (eventId, partnerId) => `${eventId}::${partnerId}`;

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export function StatusProvider({ children }) {
  const [map, setMap] = useState(load);

  const persist = useCallback((next) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore quota / private-mode errors */
    }
    setMap(next);
  }, []);

  const update = useCallback(
    (eventId, partnerId, patch) => {
      setMap((prev) => {
        const key = keyOf(eventId, partnerId);
        const next = { ...prev, [key]: { status: "proposed", ...(prev[key] || {}), ...patch } };
        try {
          localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    []
  );

  const api = useMemo(
    () => ({
      map,
      get: (eventId, partnerId) => map[keyOf(eventId, partnerId)] || null,
      statusOf: (eventId, partnerId) => (map[keyOf(eventId, partnerId)] || {}).status || "proposed",
      setStatus: (eventId, partnerId, status) => update(eventId, partnerId, { status }),
      assignBackup: (eventId, partnerId, meals) =>
        update(eventId, partnerId, { status: "proposed", manual: true, meals }),
      unassign: (eventId, partnerId) =>
        setMap((prev) => {
          const next = { ...prev };
          delete next[keyOf(eventId, partnerId)];
          try {
            localStorage.setItem(KEY, JSON.stringify(next));
          } catch {
            /* ignore */
          }
          return next;
        }),
      reset: () => persist({})
    }),
    [map, update, persist]
  );

  return <StatusCtx.Provider value={api}>{children}</StatusCtx.Provider>;
}

export const useStatus = () => useContext(StatusCtx);
