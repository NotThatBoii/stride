import { useEffect, useId, useRef, type ReactNode } from "react";
import { X, ArrowUpRight, BookOpen } from "lucide-react";
import type { Subject } from "../models";
import {
  aggregate,
  dayKey,
  formatTime,
  streaks,
  sumDays,
  weekStart,
  shiftDay,
} from "../lib/analytics";
import { useStride } from "../state";
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const { error } = useStride();
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      aria-labelledby={titleId}
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          aria-label="Close dialog"
          className="icon-button"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {children}
    </dialog>
  );
}
export function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="stat">
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
export function SubjectCard({
  subject,
  onClick,
}: {
  subject: Subject;
  onClick: () => void;
}) {
  const { data, now } = useStride();
  const today = dayKey(new Date(now));
  const days = aggregate(
    data.sessions.filter((s) => s.subject_id === subject.id),
    data.slices,
  );
  const streak = streaks(days, data.settings.minimum, today);
  return (
    <button className="subject-card" onClick={onClick}>
      <span className="subject-icon" style={{ color: subject.color }}>
        {subject.icon === "book" ? <BookOpen size={17} /> : subject.icon}
      </span>
      <span className="subject-name">
        <strong>{subject.name}</strong>
        <small>{formatTime(days.get(today) ?? 0)} today</small>
      </span>
      <span className="subject-week">
        <strong>
          {formatTime(
            sumDays(days, weekStart(today, data.settings.weekStart), today),
          )}
        </strong>
        <small>this week</small>
      </span>
      <span className="subject-streak">
        <strong>
          {streak.current} {streak.current === 1 ? "day" : "days"}
        </strong>
        <small>current streak</small>
      </span>
      <span className="spark" aria-label="Last 14 days">
        {Array.from({ length: 14 }, (_, i) => (
          <i
            key={i}
            title={`${shiftDay(today, i - 13)}: ${formatTime(days.get(shiftDay(today, i - 13)) ?? 0)}`}
            style={{
              height: `${Math.max(3, Math.min(23, (days.get(shiftDay(today, i - 13)) ?? 0) / 180))}px`,
              background: subject.color,
              opacity:
                (days.get(shiftDay(today, i - 13)) ?? 0) > 0 ? 0.75 : 0.16,
            }}
          />
        ))}
      </span>
      <ArrowUpRight size={14} className="muted" />
    </button>
  );
}
