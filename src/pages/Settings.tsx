import { useRef, useState } from "react";
import { Download, ShieldCheck, Check } from "lucide-react";
import { useStride } from "../state";
import { restoreData, saveSettings } from "../lib/storage";
import { parseBackup } from "../lib/validation";
import type { Data } from "../models";
import { Modal } from "../components/UI";
export default function Settings() {
  const { data, act, busy } = useStride();
  const [form, setForm] = useState(data.settings);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState<Data>();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  async function save() {
    setError("");
    const presets = form.presets.split(",").map((x) => Number(x.trim()));
    if (
      presets.length > 6 ||
      presets.length < 1 ||
      presets.some((n) => !Number.isInteger(n) || n < 1 || n > 1440) ||
      new Set(presets).size !== presets.length
    ) {
      setError("Enter 1–6 unique whole-minute presets, between 1 and 1440.");
      return;
    }
    if (form.notifications) {
      try {
        const allowed =
          "Notification" in window &&
          (await Notification.requestPermission()) === "granted";
        if (!allowed) {
          setError(
            "Notifications were not allowed. Enable permission or turn this preference off.",
          );
          return;
        }
      } catch (e) {
        setError(String(e));
        return;
      }
    }
    if (await act(() => saveSettings({ ...form, presets: presets.join(",") })))
      setSaved(true);
  }
  function exportData() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              format: "stride",
              version: 1,
              exportedAt: new Date().toISOString(),
              ...data,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `stride-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">WORKSPACE</span>
          <h1>Settings</h1>
          <p>Study preferences, appearance, and data.</p>
        </div>
      </div>
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onChange={() => setSaved(false)}
      >
        <section className="panel settings-section">
          <div>
            <h2>Study preferences</h2>
            <p>Set the threshold for a study day and your daily target.</p>
          </div>
          <div className="form-grid">
            <label>
              Minimum Day (minutes)
              <input
                required
                type="number"
                min={1}
                max={1440}
                value={form.minimum}
                onChange={(e) =>
                  setForm({ ...form, minimum: Number(e.target.value) })
                }
              />
              <small>Threshold for overall and subject streaks.</small>
            </label>
            <label>
              Daily study goal (minutes)
              <input
                required
                type="number"
                min={1}
                max={1440}
                value={form.goal}
                onChange={(e) =>
                  setForm({ ...form, goal: Number(e.target.value) })
                }
              />
              <small>Your dashboard progress target.</small>
            </label>
          </div>
          <label>
            Timer presets (minutes, separated by commas)
            <input
              required
              value={form.presets}
              onChange={(e) => setForm({ ...form, presets: e.target.value })}
            />
          </label>
        </section>
        <section className="panel settings-section">
          <h2>Your workspace</h2>
          <div className="form-grid">
            <label>
              Week starts on
              <select
                value={form.weekStart}
                onChange={(e) =>
                  setForm({ ...form, weekStart: Number(e.target.value) })
                }
              >
                <option value={1}>Monday</option>
                <option value={0}>Sunday</option>
              </select>
            </label>
            <label>
              Appearance
              <select
                value={form.theme}
                onChange={(e) => setForm({ ...form, theme: e.target.value })}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </label>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={form.notifications}
              onChange={(e) =>
                setForm({ ...form, notifications: e.target.checked })
              }
            />{" "}
            Notify when a countdown finishes
          </label>
          <p className="hint">
            Notifications are sent while Stride is open. Closed timers are
            recovered when you return.
          </p>
        </section>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <span className="muted">
            {saved && (
              <>
                <Check size={15} /> Preferences saved
              </>
            )}
          </span>
          <button disabled={busy}>Save preferences</button>
        </div>
      </form>
      <section className="panel data-settings">
        <ShieldCheck size={23} className="accent" />
        <div>
          <h2>Local data</h2>
          <p>
            Subjects, sessions, and settings are stored in this browser using
            IndexedDB.
          </p>
          <p className="hint">
            Export includes subjects, sessions, daily allocations, preferences,
            and active timer state. Keep an export before clearing browser data.
          </p>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="Import backup file"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            try {
              if (file.size > 25 * 1024 * 1024)
                throw new Error("Backups must be smaller than 25 MB.");
              setPending(parseBackup(await file.text()));
              setError("");
            } catch (error) {
              setError(error instanceof Error ? error.message : String(error));
            }
          }}
        />
        <button
          className="secondary"
          disabled={!!data.running}
          onClick={() => fileInput.current?.click()}
        >
          Import JSON
        </button>
        <button className="secondary" onClick={exportData}>
          <Download size={16} /> Export JSON
        </button>
      </section>
      {pending && (
        <Modal
          title="Restore this backup?"
          onClose={() => setPending(undefined)}
        >
          <p>
            This replaces this browser’s data with {pending.subjects.length}{" "}
            subjects and {pending.sessions.length} sessions. Export your current
            data first if you want to keep it. Any restored timer will be
            paused.
          </p>
          <div className="dialog-actions">
            <button className="secondary" onClick={() => setPending(undefined)}>
              Cancel
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                if (await act(() => restoreData(pending))) {
                  setForm(pending.settings);
                  setPending(undefined);
                  setSaved(true);
                }
              }}
            >
              Replace and restore
            </button>
          </div>
        </Modal>
      )}
      <p className="hint">Stride 0.2.0 · Open source · MIT licensed</p>
    </>
  );
}
