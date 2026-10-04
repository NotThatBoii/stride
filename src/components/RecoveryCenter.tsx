import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import type { Data } from "../models";
import { formatTime } from "../lib/analytics";
import { exportBackup } from "../lib/platform";
import {
  createRecoveryExport,
  inspectFailedOperation,
  inspectRecoveryCopy,
  readRecoveryState,
  recoveryStudyBackup,
  repairFailedOperation,
  retryFailedOperation,
  type RepairPlan,
  type RecoveryState,
} from "../lib/sync/recovery";
import { useSync } from "../sync/SyncProvider";
import { HistoryImportDialog } from "./HistoryImport";
import { Modal } from "./UI";
import "./recovery.css";

const label = {
  pending: "Waiting to sync",
  confirmation: "Awaiting confirmation",
  conflict: "Needs review",
  failed: "Needs recovery",
};
const reason = {
  json_restore: "Import backup",
  conflict: "Preserved version",
  remote_apply: "Before a cloud change",
  local_delete: "Deleted session",
  timer_discard: "Discarded timer",
  operation_repair: "Preserved sync change",
};
function StudyPreview({ data }: { data: Data }) {
  return (
    <div className="recovery-preview">
      {data.subjects.slice(0, 5).map((subject) => (
        <div key={subject.id}>
          <strong>{subject.name}</strong>
          <p>{subject.description || "No description"}</p>
        </div>
      ))}
      {data.sessions.slice(0, 5).map((session) => (
        <div key={session.id}>
          <strong>{session.session_title || "Study session"}</strong>
          <p>
            {formatTime(session.duration_seconds)} ·{" "}
            {new Date(session.started_at).toLocaleString()}
          </p>
          <p>{session.notes || "No notes"}</p>
          <small>
            Recorded days:{" "}
            {data.slices
              .filter((slice) => slice.session_id === session.id)
              .map((slice) => slice.day)
              .join(", ")}
          </small>
        </div>
      ))}
      {data.sessions.length > 5 && (
        <p>
          {data.sessions.length - 5} more sessions are included in the export.
        </p>
      )}
      {data.running && (
        <p>
          Paused timer: {data.running.title || "Study session"}. An existing
          timer is kept when importing.
        </p>
      )}
    </div>
  );
}

export default function RecoveryCenter() {
  const { worker, phase } = useSync();
  const [state, setState] = useState<RecoveryState>();
  const [limit, setLimit] = useState(20);
  const [plan, setPlan] = useState<RepairPlan>();
  const [copy, setCopy] =
    useState<Awaited<ReturnType<typeof inspectRecoveryCopy>>>();
  const [importing, setImporting] = useState<Data>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let current = true;
    const subscription = liveQuery(() =>
      readRecoveryState(worker.db, limit),
    ).subscribe({
      next: (result) => {
        if (current) setState(result);
      },
      error: () => {
        if (current)
          setError(
            "Recovery review could not open. Stored copies remain preserved; try reopening Stride.",
          );
      },
    });
    return () => {
      current = false;
      subscription.unsubscribe();
    };
  }, [worker, limit]);
  async function exportAll() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const recovery = await worker.runExclusive((db, guard) =>
        createRecoveryExport(db, guard),
      );
      if (await exportBackup(recovery, "recovery"))
        setNotice(
          "Recovery export prepared. It contains your workspace, pending changes, and every preserved copy.",
        );
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "Recovery export could not finish.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function inspect(sequence: number) {
    setError("");
    try {
      setPlan(
        await worker.runExclusive((db, guard) =>
          inspectFailedOperation(db, sequence, guard),
        ),
      );
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "This change could not be inspected.",
      );
    }
  }
  async function perform(action: "rebuild" | "retry") {
    if (!plan) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const recovery = await worker.runExclusive((db, guard) =>
        createRecoveryExport(db, guard),
      );
      if (!(await exportBackup(recovery, "recovery"))) return;
      await worker.runExclusive((db, guard) =>
        action === "rebuild"
          ? repairFailedOperation(db, plan, guard)
          : retryFailedOperation(db, plan, guard),
      );
      setPlan(undefined);
      setNotice(
        action === "rebuild"
          ? "The current record is queued again. The original change remains preserved."
          : "The original request is ready to retry. Its stored copy remains preserved.",
      );
      void worker.syncNow();
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "The recovery action could not finish.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section
        className="panel settings-section recovery-center"
        aria-label="Recovery and sync issues"
      >
        <div className="row">
          <div>
            <h2>Recovery and sync issues</h2>
            <p>Inspect saved changes and preserved copies on this device.</p>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void exportAll()}
          >
            Export recovery data
          </button>
        </div>
        <p className="hint">
          Recovery exports include study notes and preserved versions. Study
          backups from an individual copy can be imported through the usual
          review flow. Stored copies are kept.
        </p>
        {state && (
          <>
            <p role="status">
              {state.failed} change{state.failed === 1 ? " needs" : "s need"}{" "}
              recovery · {state.pending} pending · {state.copies} preserved{" "}
              {state.copies === 1 ? "copy" : "copies"}
            </p>
            <p className="hint">
              {state.lastSynced
                ? `Last successful sync: ${new Date(state.lastSynced).toLocaleString()}`
                : "No successful sync yet on this device."}
            </p>
            {state.lastError && <p className="hint">{state.lastError}</p>}
            {!!state.unresolved && (
              <a href="#sync-review">
                Review {state.unresolved} unresolved{" "}
                {state.unresolved === 1 ? "conflict" : "conflicts"} above
              </a>
            )}
            <details>
              <summary>Pending changes ({state.pending})</summary>
              {!state.pending && <p>No changes are waiting to sync.</p>}
              <div className="recovery-list">
                {state.operations.map((operation) => (
                  <div className="recovery-item" key={operation.sequence}>
                    <div>
                      <strong>{operation.title}</strong>
                      <p>{label[operation.status]}</p>
                      <small>{operation.message}</small>
                    </div>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void inspect(operation.sequence)}
                    >
                      Inspect change
                    </button>
                  </div>
                ))}
              </div>
            </details>
            <details>
              <summary>Preserved copies ({state.copies})</summary>
              {!state.copies && (
                <p>
                  Copies are saved before a deletion, replacement, import, or
                  sync repair.
                </p>
              )}
              <div className="recovery-list">
                {state.preserved.map(({ copy: item, preview }) => (
                  <div className="recovery-item" key={item.id}>
                    <div>
                      <strong>{preview.title}</strong>
                      <p>
                        {reason[item.reason] ?? "Preserved study data"} ·{" "}
                        {new Date(item.created_at).toLocaleString()}
                      </p>
                    </div>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        setError("");
                        void worker
                          .runExclusive((db) =>
                            inspectRecoveryCopy(db, item.id),
                          )
                          .then(setCopy)
                          .catch(() =>
                            setError(
                              "This copy could not be inspected. It remains stored and available in recovery exports.",
                            ),
                          );
                      }}
                    >
                      Inspect copy
                    </button>
                  </div>
                ))}
              </div>
            </details>
            {(state.pending > limit || state.copies > limit) && (
              <button
                className="secondary"
                onClick={() => setLimit((value) => value + 20)}
              >
                Show more recovery items
              </button>
            )}
          </>
        )}
        {notice && (
          <p role="status" className="hint">
            {notice}
          </p>
        )}
        {error && !plan && !copy && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>
      {plan && (
        <Modal
          title="Review saved change"
          onClose={() => {
            if (!busy) {
              setPlan(undefined);
              setError("");
            }
          }}
        >
          <div className="recovery-preview">
            <strong>{plan.preview.title}</strong>
            {plan.preview.lines.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
          <p>{plan.message}</p>
          <p className="hint">
            Download recovery data before continuing. Rebuilding uses the
            current record and preserves the original request; retrying sends
            the original request unchanged.
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="dialog-actions recovery-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setPlan(undefined)}
            >
              Close
            </button>
            {plan.canRetry && (
              <button
                disabled={busy || phase === "syncing"}
                onClick={() => void perform("retry")}
              >
                Export and retry original request
              </button>
            )}
            {plan.canRebuild && (
              <button
                disabled={busy || phase === "syncing"}
                onClick={() => void perform("rebuild")}
              >
                Export and rebuild change
              </button>
            )}
            {!plan.canRetry && !plan.canRebuild && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void exportAll()}
              >
                Export recovery data
              </button>
            )}
          </div>
        </Modal>
      )}
      {copy && (
        <Modal
          title="Inspect preserved copy"
          onClose={() => {
            if (!busy) {
              setCopy(undefined);
              setError("");
            }
          }}
        >
          <p className="hint">
            Saved {new Date(copy.copy.created_at).toLocaleString()} · This
            stored copy is kept after export or import.
          </p>
          {copy.data ? (
            <StudyPreview data={copy.data} />
          ) : (
            <div className="recovery-preview">
              <strong>{copy.preview.title}</strong>
              {copy.preview.lines.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
              <p>
                This copy cannot be imported automatically. Export recovery data
                to retain its original stored values.
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="dialog-actions recovery-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setCopy(undefined)}
            >
              Close
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void exportAll()}
            >
              Export recovery data
            </button>
            {copy.data && (
              <>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void exportBackup(recoveryStudyBackup(copy.data!))
                      .catch(() =>
                        setError("The study backup could not be exported."),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  Export study backup
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setImporting(copy.data!);
                    setCopy(undefined);
                  }}
                >
                  Review history import
                </button>
              </>
            )}
          </div>
        </Modal>
      )}
      {importing && (
        <HistoryImportDialog
          source={importing}
          kind="backup"
          onClose={() => setImporting(undefined)}
        />
      )}
    </>
  );
}
