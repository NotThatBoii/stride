import { useEffect, useState } from "react";
import type { Data } from "../models";
import { exportBackup } from "../lib/platform";
import { useSync } from "../sync/SyncProvider";
import {
  commitImport,
  deferLegacyImport,
  getImportState,
  getLegacyHistory,
  importBackup,
  shouldOfferLegacyImport,
  stageImport,
  type ImportKind,
  type ImportStage,
} from "../lib/sync/import";
import { Modal } from "./UI";

export function HistoryImportDialog({
  source,
  kind,
  onClose,
  onComplete,
}: {
  source: Data;
  kind: ImportKind;
  onClose: () => void;
  onComplete?: () => void;
}) {
  const { worker } = useSync();
  const [stage, setStage] = useState<ImportStage>();
  const [backedUp, setBackedUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    void worker
      .runExclusive((db, guard) => stageImport(db, source, kind, guard))
      .then((value) => {
        if (current) setStage(value);
      })
      .catch((problem) => {
        if (current) setError(problem.message);
      });
    return () => {
      current = false;
    };
  }, [worker, source, kind]);
  async function download() {
    if (!stage) return;
    setBusy(true);
    try {
      if (await exportBackup(importBackup(stage))) setBackedUp(true);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  }
  async function finish() {
    if (!stage || !backedUp) return;
    setBusy(true);
    setError("");
    try {
      // Reconcile against cloud before adding imported history to this account.
      if (!(await worker.syncNow()))
        throw new Error(
          "Connect and retry synchronization before importing. Your staged history and its backup are preserved.",
        );
      await worker.runExclusive((db, guard) =>
        commitImport(db, stage.id, guard),
      );
      onComplete?.();
      onClose();
      void worker.syncNow();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        kind === "legacy" ? "Review history import" : "Review backup import"
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>
        Add {source.subjects.length}{" "}
        {source.subjects.length === 1 ? "subject" : "subjects"} and{" "}
        {source.sessions.length}{" "}
        {source.sessions.length === 1 ? "session" : "sessions"} to your account.
        Matching records are kept once; different versions stay available for
        review.
      </p>
      <p className="hint">
        Download a JSON backup before importing. Existing history is preserved.
        Any imported timer is paused, and an existing timer is kept.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className="secondary"
          disabled={!stage || busy}
          onClick={() => void download()}
        >
          Download backup
        </button>
        <button
          disabled={!stage || !backedUp || busy}
          onClick={() => void finish()}
        >
          {busy ? "Preparing import…" : "Import history"}
        </button>
      </div>
    </Modal>
  );
}

export function LegacyImport({ settings = false }: { settings?: boolean }) {
  const { worker } = useSync();
  const [available, setAvailable] = useState(false);
  const [source, setSource] = useState<Data>();
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    void worker
      .runExclusive(async (db, guard) => {
        const stage = await getImportState(db);
        const show = settings
          ? stage?.status !== "complete" && !!(await getLegacyHistory())
          : await shouldOfferLegacyImport(db);
        guard();
        return show;
      })
      .then((show) => {
        if (current) setAvailable(show);
      })
      .catch((problem) => {
        if (current) setError(problem.message);
      });
    return () => {
      current = false;
    };
  }, [worker, settings]);
  async function open() {
    try {
      const value = await worker.runExclusive(async (db, guard) => {
        const staged = await getImportState(db);
        const history =
          staged?.status === "staged"
            ? staged.source
            : await getLegacyHistory();
        guard();
        return history;
      });
      if (value) setSource(value);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    }
  }
  async function defer() {
    try {
      await worker.runExclusive(async (db, guard) => {
        guard();
        await deferLegacyImport(db, guard);
      });
      setAvailable(false);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    }
  }
  if (!available && !error) return null;
  return (
    <div
      className={
        settings
          ? "legacy-import settings-section panel"
          : "legacy-import import-banner"
      }
    >
      <div>
        <strong>Existing study history found on this device</strong>
        <p className="hint">
          You can add it to your signed-in account. The original stays stored on
          this device.
        </p>
      </div>
      {available && (
        <div className="row">
          <button className="secondary" onClick={() => void open()}>
            {settings ? "Import stored history" : "Import into my account"}
          </button>
          {!settings && (
            <button className="subtle" onClick={() => void defer()}>
              Keep it stored for later
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {source && (
        <HistoryImportDialog
          source={source}
          kind="legacy"
          onClose={() => setSource(undefined)}
          onComplete={() => setAvailable(false)}
        />
      )}
    </div>
  );
}
