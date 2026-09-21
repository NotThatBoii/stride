import { useState } from "react";
import { useStride } from "../state";
import { dayKey, weekStart, formatTime } from "../lib/analytics";
import { SessionList } from "../components/Sessions";
export default function History() {
  const { data, now } = useStride();
  const today = dayKey(new Date(now));
  const [subject, setSubject] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const sessions = data.sessions.filter(
    (s) =>
      (!subject || s.subject_id === subject) &&
      data.slices.some(
        (x) =>
          x.session_id === s.id &&
          (!from || x.day >= from) &&
          (!to || x.day <= to),
      ),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ACTIVITY</span>
          <h1>Study history</h1>
          <p>Review, filter, and edit your sessions.</p>
        </div>
        <span className="pill">
          {sessions.length} sessions ·{" "}
          {formatTime(sessions.reduce((n, s) => n + s.duration_seconds, 0))}
        </span>
      </div>
      <div className="filters panel">
        <label>
          Subject
          <select value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">All subjects</option>
            {data.subjects.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
                {s.archived ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            min={from}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button
          className="secondary"
          onClick={() => {
            setFrom(weekStart(today, data.settings.weekStart));
            setTo(today);
          }}
        >
          This week
        </button>
        <button
          className="secondary"
          onClick={() => {
            setFrom(today.slice(0, 7) + "-01");
            setTo(today);
          }}
        >
          This month
        </button>
        <button
          className="subtle"
          onClick={() => {
            setFrom("");
            setTo("");
            setSubject("");
          }}
        >
          Reset
        </button>
      </div>
      <SessionList sessions={sessions} />
    </>
  );
}
