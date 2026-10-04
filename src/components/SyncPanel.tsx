import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import type { Session, Subject } from "../models";
import type { SyncConflict } from "../lib/local-database";
import {
  canKeepBoth,
  conflictVersion,
  listUnresolvedConflicts,
  resolveConflict,
  type ConflictChoice,
} from "../lib/sync/conflicts";
import type { SharedSettings } from "../lib/sync/types";
import { formatTime } from "../lib/analytics";
import { syncLabel, useSync } from "../sync/SyncProvider";
import { LegacyImport, HistoryImportDialog } from "./HistoryImport";
import { getImportState, type ImportStage } from "../lib/sync/import";
import RecoveryCenter from "./RecoveryCenter";

function VersionPreview({
  conflict,
  value,
}: {
  conflict: SyncConflict;
  value: unknown;
}) {
  try {
    const version = conflictVersion(value);
    if (version.action === "delete") return <p>Deleted</p>;
    if (conflict.entity === "subject") {
      const subject = version.payload as Subject;
      return (
        <>
          <strong>{subject.name}</strong>
          <p>{subject.description || "No description"}</p>
          <small>{subject.archived ? "Archived" : "Active"}</small>
        </>
      );
    }
    if (conflict.entity === "session") {
      const { session, slices } = version.payload as {
        session: Session;
        slices: { day: string }[];
      };
      return (
        <>
          <strong>{session.session_title || "Study session"}</strong>
          <p>
            {formatTime(session.duration_seconds)} ·{" "}
            {slices.map((slice) => slice.day).join(", ")}
          </p>
          <small>{session.notes || "No notes"}</small>
        </>
      );
    }
    const settings = version.payload as SharedSettings;
    return (
      <p>
        Minimum day: {settings.minimum} min · Daily goal: {settings.goal} min
        <br />
        Timer presets: {settings.presets}
        <br />
        Week starts {settings.weekStart ? "Monday" : "Sunday"}
      </p>
    );
  } catch {
    return (
      <p>This version needs recovery review. Its stored copy is preserved.</p>
    );
  }
}

export default function SyncPanel() {
  const sync = useSync();
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [staged, setStaged] = useState<ImportStage>();
  const [resume, setResume] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  useEffect(() => {
    const subscription = liveQuery(async () => ({
      conflicts: await listUnresolvedConflicts(sync.worker.db),
      stage: await getImportState(sync.worker.db, "backup"),
    })).subscribe({
      next: (result) => {
        setConflicts(result.conflicts);
        setStaged(result.stage?.status === "staged" ? result.stage : undefined);
      },
      error: () =>
        setError(
          "Unable to read sync review items. Their local copies are preserved.",
        ),
    });
    return () => subscription.unsubscribe();
  }, [sync.worker]);
  async function choose(conflict: SyncConflict, choice: ConflictChoice) {
    setBusy(conflict.id);
    setError("");
    try {
      await sync.worker.runExclusive((db, guard) =>
        resolveConflict(db, conflict.id, choice, guard),
      );
      void sync.worker.syncNow();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <>
      <section
        className="panel settings-section sync-panel"
        aria-label="Cloud synchronization"
        id="sync-review"
      >
        <div className="row">
          <div>
            <h2>Cloud synchronization</h2>
            <p role="status">
              {syncLabel(sync.phase, sync.pending, sync.conflicts)}
            </p>
          </div>
          <button
            className="secondary"
            disabled={sync.phase === "syncing"}
            onClick={() => void sync.worker.syncNow()}
          >
            {sync.error ? "Retry sync" : "Sync now"}
          </button>
        </div>
        <p className="hint">
          Study history and study preferences sync across your devices.
          Appearance, notifications, and active timers stay on this device.
        </p>
        <p className="hint">
          {sync.lastSynced
            ? `Last successful sync: ${new Date(sync.lastSynced).toLocaleString()}`
            : "This account has not synced on this device yet."}
          {sync.pending
            ? ` ${sync.pending} change${sync.pending === 1 ? "" : "s"} saved locally and awaiting sync.`
            : ""}
        </p>
        {sync.error && <p className="hint">{sync.error}</p>}
        {sync.nextRetryAt && (
          <p className="hint">
            Next automatic retry:{" "}
            {new Date(sync.nextRetryAt).toLocaleTimeString()}.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {conflicts.map((conflict) => {
          const imported =
            conflict.source === "legacy" || conflict.source === "backup";
          return (
            <details key={conflict.id} className="sync-conflict">
              <summary>
                Two versions of{" "}
                {conflict.entity === "settings"
                  ? "study preferences"
                  : `a ${conflict.entity}`}{" "}
                need review
              </summary>
              <div className="conflict-versions">
                <div>
                  <h3>
                    {conflict.context?.recovered_local
                      ? "Recovered study session"
                      : imported
                        ? "Account version"
                        : "This device"}
                  </h3>
                  <VersionPreview
                    conflict={conflict}
                    value={conflict.local_snapshot}
                  />
                </div>
                <div>
                  <h3>{imported ? "Imported version" : "Cloud version"}</h3>
                  <VersionPreview
                    conflict={conflict}
                    value={conflict.remote_snapshot}
                  />
                </div>
              </div>
              {conflict.kind === "parent_deleted" && (
                <p className="hint">
                  This choice also preserves or reconciles the subject and its
                  study sessions.
                </p>
              )}
              {imported && conflict.entity === "subject" && (
                <p className="hint">
                  The imported subject includes{" "}
                  {conflict.context?.incoming_tree?.sessions.length ?? 0}{" "}
                  {conflict.context?.incoming_tree?.sessions.length === 1
                    ? "session"
                    : "sessions"}
                  {conflict.context?.incoming_tree?.running
                    ? " and a paused timer"
                    : ""}
                  . Keep account version leaves that imported history in its
                  backup. Import this version adds it here; Keep both adds a
                  separate subject with its history.
                </p>
              )}
              <div className="dialog-actions">
                <button
                  className="secondary"
                  disabled={!!busy}
                  onClick={() => void choose(conflict, "local")}
                >
                  {imported
                    ? "Keep account version"
                    : "Keep this device’s version"}
                </button>
                <button
                  className="secondary"
                  disabled={!!busy}
                  onClick={() => void choose(conflict, "remote")}
                >
                  {imported ? "Import this version" : "Use cloud version"}
                </button>
                {canKeepBoth(conflict) && (
                  <button
                    disabled={!!busy}
                    onClick={() => void choose(conflict, "both")}
                  >
                    Keep both
                  </button>
                )}
              </div>
            </details>
          );
        })}
        {staged && (
          <div className="row">
            <p>A backup import is staged safely on this device.</p>
            <button className="secondary" onClick={() => setResume(true)}>
              Continue backup import
            </button>
          </div>
        )}
      </section>
      <RecoveryCenter />
      <LegacyImport settings />
      {resume && staged && (
        <HistoryImportDialog
          source={staged.source}
          kind="backup"
          onClose={() => setResume(false)}
        />
      )}
    </>
  );
}
