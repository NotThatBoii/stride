import { useState } from "react";
import { Modal } from "./UI";
import { useStride } from "../state";
import { saveSubject, deleteSubject } from "../lib/storage";
import type { Subject } from "../models";
export default function SubjectEditor({
  subject,
  onClose,
}: {
  subject?: Subject;
  onClose: () => void;
}) {
  const { data, act, busy } = useStride();
  const [name, setName] = useState(subject?.name ?? "");
  const [description, setDescription] = useState(subject?.description ?? "");
  const [color, setColor] = useState(subject?.color ?? "#8b91e8");
  const [icon, setIcon] = useState(subject?.icon ?? "book");
  const [confirm, setConfirm] = useState(false);
  const active = data.running?.subjectId === subject?.id && !!subject;
  async function submit() {
    const next: Subject = {
      id: subject?.id ?? crypto.randomUUID(),
      name: name.trim(),
      description,
      icon,
      color,
      created_at: subject?.created_at ?? new Date().toISOString(),
      archived: subject?.archived ?? 0,
    };
    if (await act(() => saveSubject(next))) onClose();
  }
  return (
    <Modal title={subject ? "Edit subject" : "A new subject"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label>
          Subject name
          <input
            autoFocus
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Differential Equations"
          />
        </label>
        <label>
          Description <span className="muted">optional</span>
          <textarea
            value={description}
            maxLength={500}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What are you learning?"
          />
        </label>
        <div className="form-grid">
          <label>
            Accent color
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
          <label>
            Symbol
            <select value={icon} onChange={(e) => setIcon(e.target.value)}>
              <option value="book">Book</option>
              <option>∑</option>
              <option>λ</option>
              <option>⌘</option>
              <option>π</option>
              <option>◈</option>
            </select>
          </label>
        </div>
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy || !name.trim()} type="submit">
            {subject ? "Save changes" : "Create subject"}
          </button>
        </div>
      </form>
      {subject && (
        <div className="danger-zone">
          <button
            disabled={busy || active}
            className="secondary"
            onClick={async () => {
              if (
                await act(() =>
                  saveSubject({
                    ...subject,
                    archived: subject.archived ? 0 : 1,
                  }),
                )
              )
                onClose();
            }}
          >
            {subject.archived ? "Restore subject" : "Archive subject"}
          </button>
          <button
            disabled={busy || active}
            className="danger subtle"
            onClick={() => setConfirm(true)}
          >
            Delete subject
          </button>
          {active && (
            <p>
              Finish the active session before archiving or deleting this
              subject.
            </p>
          )}
          {confirm && (
            <div role="alert">
              <p>
                Remove “{subject.name}” and all of its study sessions from your
                history? A recovery copy stays on this device and can be
                exported or imported in Settings.
              </p>
              <button
                disabled={busy}
                className="danger"
                onClick={async () => {
                  if (await act(() => deleteSubject(subject.id))) onClose();
                }}
              >
                Delete subject and sessions
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
