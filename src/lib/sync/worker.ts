import { liveQuery } from "dexie";
import {
  getActiveDatabase,
  getActiveWorkspace,
  type StrideDatabase,
} from "../local-database";
import { bootstrapAccount } from "./bootstrap";
import { assertAccountDatabase } from "./conflicts";
import { pullChanges } from "./pull";
import { pushPending } from "./push";
import { publicSyncError } from "./failures";
import { SyncError, type SyncAdapter, type SyncGuard } from "./types";

export type SyncPhase =
  | "never"
  | "syncing"
  | "synced"
  | "offline"
  | "pending"
  | "conflict"
  | "error"
  | "auth";
export interface SyncSnapshot {
  phase: SyncPhase;
  pending: number;
  conflicts: number;
  error: string | null;
  lastSynced: string | null;
  nextRetryAt: number | null;
}
export function retryDelay(
  attempt: number,
  random = Math.random,
  retryAfterMs = 0,
): number {
  const ceiling = Math.min(300_000, 2_000 * 2 ** Math.min(attempt, 8));
  return Math.max(retryAfterMs, Math.round(ceiling * (0.5 + random() * 0.5)));
}

// Exposes an ordinary manual-sync action, also usable by isolated tests.
export let activeSyncWorker: SyncWorker | null = null;

export class SyncWorker {
  private snapshot: SyncSnapshot = {
    phase: "never",
    pending: 0,
    conflicts: 0,
    error: null,
    lastSynced: null,
    nextRetryAt: null,
  };
  private listeners = new Set<() => void>();
  private active = false;
  private lifecycle = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private observation?: { unsubscribe(): void };
  private controller: AbortController | null = null;
  private lifecycleController: AbortController | null = null;
  private running: Promise<boolean> | null = null;
  private exclusiveTail: Promise<unknown> = Promise.resolve();
  private attempts = 0;
  private retryNotBefore = 0;
  private dirty = false;
  private stoppedForError = false;
  private pendingSignature = "";
  private readonly online = () => {
    this.stoppedForError = false;
    this.attempts = 0;
    this.schedule(250);
  };
  private readonly foreground = () => {
    if (document.visibilityState === "visible") this.schedule(750);
  };

  constructor(
    readonly db: StrideDatabase,
    private readonly adapter: SyncAdapter,
    private readonly accountGuard: SyncGuard,
  ) {}
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = () => this.snapshot;

  start() {
    if (this.active) return;
    this.active = true;
    ++this.lifecycle;
    this.lifecycleController = new AbortController();
    activeSyncWorker = this;
    this.observation = liveQuery(async () => ({
      pending: await this.db.pendingOperations.toArray(),
      conflicts: await this.db.conflicts.filter((c) => !c.resolved_at).count(),
      last:
        (await this.db.syncMetadata.get("last_successful_sync"))?.value ?? null,
      errors: await this.db.syncMetadata
        .filter((row) => row.key.startsWith("op_error:"))
        .count(),
    })).subscribe({
      next: (result) => {
        if (!this.active) return;
        const signature = result.pending
          .map((op) => `${op.id}:${op.status}:${op.updated_at}`)
          .join("|");
        const changed = signature !== this.pendingSignature;
        this.pendingSignature = signature;
        this.publish({
          pending: result.pending.length,
          conflicts: result.conflicts,
          lastSynced: result.last,
        });
        if (!this.running && !this.snapshot.error)
          this.publish({
            phase: result.errors
              ? "error"
              : result.conflicts
                ? "conflict"
                : result.pending.length
                  ? "pending"
                  : result.last
                    ? "synced"
                    : "never",
          });
        if (changed && result.pending.length && !this.stoppedForError)
          this.schedule(750);
      },
      error: () => {
        if (this.active)
          this.publish({
            phase: "error",
            error:
              "Unable to read synchronization status. Your local data is preserved.",
          });
      },
    });
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.online);
      document.addEventListener("visibilitychange", this.foreground);
      this.interval = setInterval(() => {
        if (document.visibilityState === "visible" && !this.stoppedForError)
          this.schedule(0);
      }, 60_000);
    }
    this.schedule(250);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    ++this.lifecycle;
    this.controller?.abort();
    this.lifecycleController?.abort();
    if (this.timer) clearTimeout(this.timer);
    if (this.interval) clearInterval(this.interval);
    this.timer = this.interval = null;
    this.observation?.unsubscribe();
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.online);
      document.removeEventListener("visibilitychange", this.foreground);
    }
    if (activeSyncWorker === this) activeSyncWorker = null;
  }

  private publish(change: Partial<SyncSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((listener) => listener());
  }
  private schedule(delay: number) {
    if (!this.active || this.stoppedForError) return;
    if (this.running) {
      this.dirty = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.max(
      delay,
      this.retryNotBefore - Date.now(),
      (this.snapshot.nextRetryAt ?? 0) - Date.now(),
    );
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow(false);
    }, wait);
  }

  async runExclusive<T>(
    work: (db: StrideDatabase, guard: SyncGuard) => Promise<T>,
  ): Promise<T> {
    const lifecycle = this.lifecycle;
    const lifecycleSignal = this.lifecycleController?.signal;
    const guard = () => {
      if (!this.active || lifecycle !== this.lifecycle)
        throw new SyncError("Synchronization stopped.", "cancelled");
      this.accountGuard();
    };
    const execute = async () => {
      guard();
      await assertAccountDatabase(this.db);
      guard();
      const perform = async () => {
        guard();
        const result = await work(this.db, guard);
        guard();
        return result;
      };
      // Web Locks serialize windows sharing this account's IndexedDB. A
      // missing lock API fails closed rather than risking concurrent imports.
      if (typeof navigator !== "undefined" && navigator.locks) {
        return navigator.locks.request(
          `stride-sync-${this.db.name}`,
          { mode: "exclusive", signal: lifecycleSignal },
          perform,
        );
      }
      if (typeof window !== "undefined")
        throw new SyncError(
          "This browser cannot safely coordinate synchronization. Local study remains available.",
          "permanent",
        );
      return perform(); // Unit-test runtime has no browser windows.
    };
    const result = this.exclusiveTail.then(execute, execute);
    this.exclusiveTail = result.catch(() => {});
    return result;
  }

  readonly syncNow = (manual = true): Promise<boolean> => {
    if (!this.active) return Promise.resolve(false);
    if (this.running) return this.running;
    if (Date.now() < this.retryNotBefore) {
      this.schedule(this.retryNotBefore - Date.now());
      return Promise.resolve(false);
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (manual) {
      this.stoppedForError = false;
      this.attempts = 0;
    }
    this.dirty = false;
    const lifecycle = this.lifecycle;
    const controller = new AbortController();
    this.controller = controller;
    this.publish({ phase: "syncing", error: null, nextRetryAt: null });
    this.running = this.runExclusive(async (db, guard) => {
      if (typeof navigator !== "undefined" && navigator.onLine === false)
        throw new SyncError(
          "You are offline. Changes are saved on this device and will sync when you reconnect.",
          "transient",
        );
      const initial = await pullChanges(db, this.adapter, guard, {
        signal: controller.signal,
        maxPages: 20,
      });
      guard();
      if (initial.hasMore) {
        this.dirty = true;
        return false;
      }
      await db.transaction("rw", db.syncMetadata, async () => {
        guard();
        await db.syncMetadata.put({
          key: "initial_pull_complete",
          value: new Date().toISOString(),
        });
        guard();
      });
      guard();
      await bootstrapAccount(db, guard);
      const pushed = await pushPending(db, this.adapter, guard, {
        signal: controller.signal,
        limit: 100,
      });
      const final = await pullChanges(db, this.adapter, guard, {
        signal: controller.signal,
        maxPages: 20,
      });
      guard();
      if (final.hasMore) {
        this.dirty = true;
        return false;
      }
      const [pending, conflicts, errors] = await Promise.all([
        db.pendingOperations.count(),
        db.conflicts.filter((c) => !c.resolved_at).count(),
        db.syncMetadata
          .filter((row) => row.key.startsWith("op_error:"))
          .count(),
      ]);
      guard();
      const lastSynced = new Date().toISOString();
      await db.transaction("rw", db.syncMetadata, async () => {
        guard();
        await db.syncMetadata.put({
          key: "last_successful_sync",
          value: lastSynced,
        });
        await db.syncMetadata.delete("last_sync_error");
        guard();
      });
      guard();
      this.attempts = 0;
      this.retryNotBefore = 0;
      this.publish({
        pending,
        conflicts,
        lastSynced,
        phase: errors
          ? "error"
          : conflicts
            ? "conflict"
            : pending
              ? "pending"
              : "synced",
        error: errors
          ? "A change needs review before it can sync. Its local copy is preserved."
          : null,
      });
      if (pending && pushed.blocked < pending) this.dirty = true;
      return true;
    })
      .catch(async (error) => {
        if (
          !this.active ||
          lifecycle !== this.lifecycle ||
          controller.signal.aborted
        )
          return false;
        const problem =
          error instanceof SyncError
            ? error
            : new SyncError(
                "Synchronization could not finish. Your local data and pending changes are preserved.",
                "permanent",
              );
        if (problem.kind === "cancelled") return false;
        const transient = problem.kind === "transient";
        try {
          await this.db.transaction("rw", this.db.syncMetadata, async () => {
            if (!this.active || lifecycle !== this.lifecycle)
              throw new SyncError("Synchronization stopped.", "cancelled");
            this.accountGuard();
            await this.db.syncMetadata.put({
              key: "last_sync_error",
              value: JSON.stringify({
                kind: problem.kind,
                message: publicSyncError(problem.kind),
                at: new Date().toISOString(),
              }),
            });
            this.accountGuard();
            if (!this.active || lifecycle !== this.lifecycle)
              throw new SyncError("Synchronization stopped.", "cancelled");
          });
        } catch {
          /* Error reporting must never alter the preserved study data. */
        }
        if (!this.active || lifecycle !== this.lifecycle) return false;
        this.stoppedForError = !transient;
        const delay = transient
          ? retryDelay(this.attempts++, Math.random, problem.retryAfterMs)
          : null;
        if (transient && problem.retryAfterMs)
          this.retryNotBefore = Date.now() + problem.retryAfterMs;
        this.publish({
          phase:
            problem.kind === "auth" ? "auth" : transient ? "offline" : "error",
          error: publicSyncError(problem.kind),
          nextRetryAt: delay === null ? null : Date.now() + delay,
        });
        if (delay !== null) {
          this.dirty = false;
          this.timer = setTimeout(() => {
            this.timer = null;
            void this.syncNow(false);
          }, delay);
        }
        return false;
      })
      .finally(() => {
        this.running = null;
        this.controller = null;
        if (lifecycle !== this.lifecycle) {
          if (this.active) this.schedule(250);
          return;
        }
        if (this.active && this.dirty && !this.stoppedForError)
          this.schedule(1_000);
      });
    return this.running;
  };
}

export function activeAccountGuard(
  db: StrideDatabase,
  generation: number,
): SyncGuard {
  return () => {
    if (
      !db.accountId ||
      getActiveDatabase() !== db ||
      getActiveWorkspace().generation !== generation ||
      getActiveWorkspace().accountId !== db.accountId
    )
      throw new SyncError(
        "The account workspace changed. Synchronization stopped safely.",
        "cancelled",
      );
  };
}
