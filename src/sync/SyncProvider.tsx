import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { getActiveDatabase, getActiveWorkspace } from "../lib/local-database";
import { supabase } from "../lib/supabase";
import { createSyncAdapter } from "../lib/sync/client";
import { activeAccountGuard, SyncWorker } from "../lib/sync/worker";
import { useAuth } from "../auth/AuthProvider";

const SyncContext = createContext<SyncWorker | null>(null);
export function SyncProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [worker] = useState(() => {
    const db = getActiveDatabase();
    if (!supabase || !user?.id || db.accountId !== user.id.toLowerCase())
      throw new Error("Missing account synchronization context.");
    const guard = activeAccountGuard(db, getActiveWorkspace().generation);
    return new SyncWorker(
      db,
      createSyncAdapter(supabase, user.id, guard),
      guard,
    );
  });
  useLayoutEffect(() => {
    worker.start();
    return () => worker.stop();
  }, [worker]);
  return <SyncContext.Provider value={worker}>{children}</SyncContext.Provider>;
}
export function useSync() {
  const worker = useContext(SyncContext);
  if (!worker) throw new Error("Missing synchronization provider.");
  const snapshot = useSyncExternalStore(
    worker.subscribe,
    worker.getSnapshot,
    worker.getSnapshot,
  );
  return { worker, ...snapshot };
}
export function syncLabel(
  phase: ReturnType<typeof useSync>["phase"],
  pending: number,
  conflicts: number,
) {
  if (phase === "syncing") return "Syncing…";
  if (conflicts)
    return `${conflicts} conflict${conflicts === 1 ? " needs" : "s need"} attention`;
  if (phase === "offline") return "Offline · Saved on this device";
  if (phase === "auth") return "Account needs attention";
  if (phase === "error") return "Sync needs attention";
  if (pending) return `${pending} change${pending === 1 ? "" : "s"} pending`;
  return phase === "synced" ? "Synced" : "Never synced";
}
