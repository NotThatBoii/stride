import { useEffect, useState } from "react";
import { Play, Pause, Check, Timer, ArrowRight } from "lucide-react";
import { useStride } from "../state";
import { activeSegments, elapsed } from "../lib/timer";
import { saveRunning, saveSession } from "../lib/storage";
import { splitSegments, formatTime } from "../lib/analytics";
import { Modal } from "../components/UI";
export default function Focus({
  initialSubject,
  onAdd,
}: {
  initialSubject?: string;
  onAdd: () => void;
}) {
  const { data, now, act, busy } = useStride();
  const active = data.subjects.filter((s) => !s.archived);
  const [subject, setSubject] = useState(
    initialSubject ??
      data.sessions.find((s) => active.some((a) => a.id === s.subject_id))
        ?.subject_id ??
      active[0]?.id ??
      "",
  );
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"stopwatch" | "countdown">("countdown");
  const [minutes, setMinutes] = useState(
    Number(data.settings.presets.split(",")[0]) || 25,
  );
  const [review, setReview] = useState(false);
  const [reviewTitle, setReviewTitle] = useState("");
  const [note, setNote] = useState("");
  const [discard, setDiscard] = useState(false);
  const timer = data.running;
  const seconds = timer ? elapsed(timer, now) : 0;
  const finished = timer?.mode === "countdown" && seconds >= timer.target;
  const display = timer
    ? timer.mode === "countdown"
      ? Math.max(0, timer.target - seconds)
      : seconds
    : mode === "countdown"
      ? minutes * 60
      : 0;
  useEffect(() => {
    if (!active.some((s) => s.id === subject)) setSubject(active[0]?.id ?? "");
  }, [data.subjects, subject]);
  useEffect(() => {
    if (timer) {
      const prevent = (e: BeforeUnloadEvent) => {
        e.preventDefault();
      };
      window.addEventListener("beforeunload", prevent);
      return () => window.removeEventListener("beforeunload", prevent);
    }
  }, [timer]);
  async function pause() {
    if (timer)
      await act(() =>
        saveRunning({
          ...timer,
          segments: activeSegments(timer),
          runningSince: null,
        }),
      );
  }
  async function finish() {
    if (!timer) return;
    setReviewTitle(timer.title);
    if (
      await act(() =>
        saveRunning({
          ...timer!,
          segments: activeSegments(timer!),
          runningSince: null,
        }),
      )
    )
      setReview(true);
  }
  async function save() {
    if (!timer) return;
    const segments = activeSegments(timer);
    const total = elapsed(timer);
    if (total < 1) return;
    const end = segments.at(-1)?.end ?? Date.now();
    const session = {
      id: timer.id,
      subject_id: timer.subjectId,
      started_at: timer.startedAt,
      ended_at: new Date(end).toISOString(),
      duration_seconds: total,
      session_title: reviewTitle,
      notes: note,
      mode: timer.mode,
      completed: 1,
    };
    if (
      await act(() => saveSession(session, splitSegments(timer.id, segments)))
    ) {
      setReview(false);
      setNote("");
    }
  }
  return (
    <div className="focus-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">FOCUS</span>
          <h1>{timer ? "Focus session" : "Start a session"}</h1>
          <p>
            {timer
              ? "Your timer is saved on this device."
              : "Choose a subject and a timer."}
          </p>
        </div>
      </div>
      {!active.length && !timer ? (
        <div className="empty">
          <Timer size={36} />
          <h2>What will you study first?</h2>
          <p>Add a subject to begin a focus session.</p>
          <button onClick={onAdd}>
            Add your first subject <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <div className="focus-stage">
          {timer ? (
            <div className="focus-subject">
              <i
                className="subject-dot"
                style={{
                  background: data.subjects.find(
                    (s) => s.id === timer.subjectId,
                  )?.color,
                }}
              />
              {data.subjects.find((s) => s.id === timer.subjectId)?.name}
            </div>
          ) : (
            <label className="focus-subject">
              Your subject
              <select
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              >
                {active.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!timer && (
            <div className="segmented">
              <button
                className={mode === "countdown" ? "selected" : ""}
                onClick={() => setMode("countdown")}
              >
                Countdown
              </button>
              <button
                className={mode === "stopwatch" ? "selected" : ""}
                onClick={() => setMode("stopwatch")}
              >
                Stopwatch
              </button>
            </div>
          )}
          <div
            className={`timer-clock ${timer && !timer.runningSince ? "paused" : ""}`}
            role="timer"
            aria-label={`${Math.floor(display / 60)} minutes ${Math.floor(display % 60)} seconds`}
          >
            {String(Math.floor(display / 3600)).padStart(2, "0")}
            <span>:</span>
            {String(Math.floor((display % 3600) / 60)).padStart(2, "0")}
            <span>:</span>
            {String(Math.floor(display % 60)).padStart(2, "0")}
          </div>
          <div className="timer-status">
            {timer
              ? finished
                ? "Session complete. Take a breath."
                : timer.runningSince
                  ? "IN FOCUS"
                  : "PAUSED · YOUR PROGRESS IS SAVED"
              : "READY"}
          </div>
          {!timer ? (
            <>
              <input
                className="focus-title"
                aria-label="Session title"
                placeholder="What are you working on? (optional)"
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              {mode === "countdown" && (
                <div className="presets">
                  {data.settings.presets
                    .split(",")
                    .map(Number)
                    .map((n) => (
                      <button
                        className={`secondary ${minutes === n ? "selected" : ""}`}
                        key={n}
                        onClick={() => setMinutes(n)}
                      >
                        {n} min
                      </button>
                    ))}
                  <label>
                    Custom{" "}
                    <input
                      aria-label="Custom duration in minutes"
                      type="number"
                      min={1}
                      max={1440}
                      value={minutes}
                      onChange={(e) => setMinutes(Number(e.target.value))}
                    />
                  </label>
                </div>
              )}
              <button
                className="large"
                disabled={busy || !subject || minutes < 1 || minutes > 1440}
                onClick={() =>
                  void act(() =>
                    saveRunning({
                      id: crypto.randomUUID(),
                      subjectId: subject,
                      startedAt: new Date().toISOString(),
                      title,
                      mode,
                      target: minutes * 60,
                      segments: [],
                      runningSince: Date.now(),
                      notified: false,
                    }),
                  )
                }
              >
                <Play size={17} fill="currentColor" /> Start session
              </button>
            </>
          ) : (
            <>
              <p className="focus-title">{timer.title || "Study session"}</p>
              <div className="focus-actions">
                {!finished && (
                  <button
                    className="secondary large"
                    disabled={busy}
                    onClick={() =>
                      timer.runningSince
                        ? void pause()
                        : void act(() =>
                            saveRunning({ ...timer, runningSince: Date.now() }),
                          )
                    }
                  >
                    {timer.runningSince ? (
                      <Pause size={17} />
                    ) : (
                      <Play size={17} />
                    )}{" "}
                    {timer.runningSince ? "Pause" : "Resume"}
                  </button>
                )}
                <button
                  className="large"
                  disabled={busy || seconds < 1}
                  onClick={() => void finish()}
                >
                  <Check size={18} /> Finish session
                </button>
              </div>
              <button className="subtle" onClick={() => setDiscard(true)}>
                Discard session
              </button>
              <p className="hint">
                Your timer is recoverable after reopening Stride. Pause before
                stepping away.
              </p>
            </>
          )}
        </div>
      )}
      {review && timer && (
        <Modal title="A step forward." onClose={() => setReview(false)}>
          <div className="completion">
            <Check size={24} />
            <h2>{formatTime(seconds)} of progress</h2>
            <p>{data.subjects.find((s) => s.id === timer.subjectId)?.name}</p>
          </div>
          <label>
            Session title
            <input
              value={reviewTitle}
              maxLength={160}
              onChange={(e) => setReviewTitle(e.target.value)}
            />
          </label>
          <label>
            A note for next time <span className="muted">optional</span>
            <textarea
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={4000}
              placeholder="What clicked? Where will you pick up?"
            />
          </label>
          <div className="dialog-actions">
            <button className="secondary" onClick={() => setReview(false)}>
              Back
            </button>
            <button disabled={busy} onClick={() => void save()}>
              Save session <Check size={16} />
            </button>
          </div>
        </Modal>
      )}
      {discard && (
        <Modal title="Discard this session?" onClose={() => setDiscard(false)}>
          <p>
            Your {formatTime(seconds)} of unsaved study time will be removed
            from Focus. A paused recovery copy stays on this device in Settings.
          </p>
          <div className="dialog-actions">
            <button className="secondary" onClick={() => setDiscard(false)}>
              Keep studying
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={async () => {
                if (await act(() => saveRunning(null))) setDiscard(false);
              }}
            >
              Discard
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
