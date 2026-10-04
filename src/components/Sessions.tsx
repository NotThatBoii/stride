import { Fragment, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { Session } from "../models";
import { useStride } from "../state";
import { dayKey, shiftDay, formatTime, splitSegments } from "../lib/analytics";
import { deleteSession, saveSession } from "../lib/storage";
import { Modal } from "./UI";
const localInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export function SessionList({ sessions }: { sessions: Session[] }) {
  const { data, act, busy, now } = useStride();
  const [editing, setEditing] = useState<Session>();
  const [deleting, setDeleting] = useState<Session>();
  const [visibleCount, setVisibleCount] = useState(20);
  const sorted = [...sessions].sort((a, b) =>
    b.started_at.localeCompare(a.started_at),
  );
  return (
    <>
      <div className="session-list">
        {sorted.slice(0, visibleCount).map((s, index) => {
          const subject = data.subjects.find((x) => x.id === s.subject_id);
          const date = dayKey(new Date(s.started_at));
          const heading =
            date === dayKey(new Date(now))
              ? "Today"
              : date === shiftDay(dayKey(new Date(now)), -1)
                ? "Yesterday"
                : new Date(s.started_at).toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  });
          return (
            <Fragment key={s.id}>
              {(index === 0 ||
                dayKey(new Date(sorted[index - 1].started_at)) !== date) && (
                <h3 className="session-date">{heading}</h3>
              )}
              <div className="session-row">
                <i
                  className="subject-dot"
                  style={{ background: subject?.color }}
                />
                <div className="session-main">
                  <strong>
                    {s.session_title || subject?.name || "Study session"}
                  </strong>
                  <span>
                    {subject?.name} ·{" "}
                    {new Date(s.started_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    ·{" "}
                    {new Date(s.started_at).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    –
                    {new Date(s.ended_at).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {s.notes && <p>{s.notes}</p>}
                </div>
                <strong className="duration">
                  {formatTime(s.duration_seconds)}
                </strong>
                <button
                  className="icon-button"
                  aria-label="Edit session"
                  onClick={() => setEditing(s)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Delete session"
                  onClick={() => setDeleting(s)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </Fragment>
          );
        })}
        {sessions.length > visibleCount && (
          <button
            className="subtle load-more"
            onClick={() => setVisibleCount((n) => n + 20)}
          >
            Show more sessions ({sessions.length - visibleCount} remaining)
          </button>
        )}
        {!sessions.length && (
          <div className="empty compact">
            <h3>No sessions yet</h3>
            <p>Your study sessions will appear here.</p>
          </div>
        )}
      </div>
      {editing && (
        <SessionEditor
          session={editing}
          onClose={() => setEditing(undefined)}
        />
      )}{" "}
      {deleting && (
        <Modal
          title="Delete this session?"
          onClose={() => setDeleting(undefined)}
        >
          <p>
            This removes {formatTime(deleting.duration_seconds)} from your
            history. Your heatmaps and streaks will update. A recovery copy
            stays on this device in Settings.
          </p>
          <div className="dialog-actions">
            <button
              className="secondary"
              onClick={() => setDeleting(undefined)}
            >
              Keep session
            </button>
            <button
              disabled={busy}
              className="danger"
              onClick={async () => {
                if (await act(() => deleteSession(deleting.id)))
                  setDeleting(undefined);
              }}
            >
              Delete session
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function SessionEditor({
  session: s,
  onClose,
}: {
  session: Session;
  onClose: () => void;
}) {
  const { data, act, busy } = useStride();
  const [title, setTitle] = useState(s.session_title);
  const [notes, setNotes] = useState(s.notes);
  const [subject, setSubject] = useState(s.subject_id);
  const [start, setStart] = useState(localInput(s.started_at));
  const [duration, setDuration] = useState(String(s.duration_seconds / 60));
  const [error, setError] = useState("");
  return (
    <Modal title="Edit study session" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const seconds = Number(duration) * 60;
          const from = new Date(start).getTime();
          const changed =
            start !== localInput(s.started_at) ||
            Math.abs(seconds - s.duration_seconds) > 0.001;
          const to = from + seconds * 1000;
          if (
            !Number.isFinite(from) ||
            seconds <= 0 ||
            seconds > 86400 ||
            to > Date.now() + 1000
          ) {
            setError(
              "Choose a past start time and a duration between 1 second and 24 hours.",
            );
            return;
          }
          const next = {
            ...s,
            subject_id: subject,
            session_title: title,
            notes,
            started_at: changed ? new Date(from).toISOString() : s.started_at,
            ended_at: changed ? new Date(to).toISOString() : s.ended_at,
            duration_seconds: seconds,
          };
          const slices = changed
            ? splitSegments(s.id, [{ start: from, end: to }])
            : data.slices.filter((x) => x.session_id === s.id);
          if (await act(() => saveSession(next, slices))) onClose();
        }}
      >
        <label>
          Subject
          <select value={subject} onChange={(e) => setSubject(e.target.value)}>
            {data.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
          />
        </label>
        <div className="form-grid">
          <label>
            Started
            <input
              required
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            Minutes
            <input
              required
              type="number"
              min="0.016"
              max="1440"
              step="any"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </label>
        </div>
        <p className="hint">
          Changing time redistributes this session as continuous study from the
          selected start. Editing only text preserves pauses and daily
          allocations.
        </p>
        <label>
          Notes
          <textarea
            value={notes}
            maxLength={4000}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy}>Save changes</button>
        </div>
      </form>
    </Modal>
  );
}
