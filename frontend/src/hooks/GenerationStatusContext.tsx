import { createContext, useCallback, useContext, useRef, useState } from "react";

export type GenStatus = "idle" | "generating" | "done";

interface GenStatusEntry {
  status: GenStatus;
  /** Timestamp when status last changed — used to auto-clear "done" after a timeout */
  ts: number;
}

interface GenerationStatusContextValue {
  /** Current status for a page (tool) */
  getPageStatus: (pageId: string) => GenStatus;
  /** Mark a page as generating */
  startPage: (pageId: string) => void;
  /** Mark a page as done (green tick, clears when user visits the page) */
  endPage: (pageId: string) => void;
  /** Clear the done indicator (called when user navigates to a page) */
  viewedPage: (pageId: string) => void;
  /** Full status map for rendering */
  statusMap: Record<string, GenStatusEntry>;
}

const GenerationStatusContext = createContext<GenerationStatusContextValue>({
  getPageStatus: () => "idle",
  startPage: () => {},
  endPage: () => {},
  viewedPage: () => {},
  statusMap: {},
});

export function GenerationStatusProvider({ children }: { children: React.ReactNode }) {
  const [statusMap, setStatusMap] = useState<Record<string, GenStatusEntry>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const startPage = useCallback((pageId: string) => {
    if (timers.current[pageId]) { clearTimeout(timers.current[pageId]); delete timers.current[pageId]; }
    setStatusMap((prev) => ({ ...prev, [pageId]: { status: "generating", ts: Date.now() } }));
  }, []);

  const endPage = useCallback((pageId: string) => {
    setStatusMap((prev) => ({ ...prev, [pageId]: { status: "done", ts: Date.now() } }));
    // Auto-clear "done" after 30 seconds if user never visits
    if (timers.current[pageId]) clearTimeout(timers.current[pageId]);
    timers.current[pageId] = setTimeout(() => {
      setStatusMap((prev) => {
        const entry = prev[pageId];
        if (entry?.status === "done") {
          const next = { ...prev };
          delete next[pageId];
          return next;
        }
        return prev;
      });
      delete timers.current[pageId];
    }, 30000);
  }, []);

  const viewedPage = useCallback((pageId: string) => {
    setStatusMap((prev) => {
      const entry = prev[pageId];
      if (!entry || entry.status === "idle") return prev;
      if (entry.status === "done") {
        const next = { ...prev };
        delete next[pageId];
        return next;
      }
      return prev;
    });
    if (timers.current[pageId]) { clearTimeout(timers.current[pageId]); delete timers.current[pageId]; }
  }, []);

  const getPageStatus = useCallback((pageId: string): GenStatus => {
    return statusMap[pageId]?.status ?? "idle";
  }, [statusMap]);

  return (
    <GenerationStatusContext.Provider value={{ getPageStatus, startPage, endPage, viewedPage, statusMap }}>
      {children}
    </GenerationStatusContext.Provider>
  );
}

export const useGenerationStatus = () => useContext(GenerationStatusContext);
