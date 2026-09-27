import { useRef, useState } from "react";
import { Download, ShieldCheck, Check } from "lucide-react";
import { useStride } from "../state";
import { restoreData, saveSettings } from "../lib/storage";
import { parseBackup } from "../lib/validation";
import type { Data } from "../models";
import { Modal } from "../components/UI";
import {
  appVersion,
  isDesktop,
  requestNotifications,
  exportBackup,
  openDesktopBackup,
} from "../lib/platform";
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
        const allowed = await requestNotifications();
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
  async function exportData() {
    try {
      await exportBackup(
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
      );
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }
  async function importData() {
    if (!isDesktop) {
      fileInput.current?.click();
      return;
    }
    try {
      const text = await openDesktopBackup();
      if (text !== null) setPending(parseBackup(text));
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
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
            {isDesktop
              ? "Your study data is saved in Stride’s local Windows app profile. The app works without a server or internet connection."
              : "Subjects, sessions, and settings are stored in this browser using IndexedDB."}
          </p>
          <p className="hint">
            Export includes subjects, sessions, daily allocations, preferences,
            and active timer state.{" "}
            {isDesktop
              ? "To move your browser history here, export it from the web version and import that JSON file. Web and desktop have separate workspaces."
              : "Use Export JSON to move your history into the Windows app. Keep a backup before clearing browser data."}
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
          onClick={() => void importData()}
        >
          Import JSON
        </button>
        <button className="secondary" onClick={() => void exportData()}>
          <Download size={16} /> Export JSON
        </button>
      </section>
      {pending && (
        <Modal
          title="Restore this backup?"
          onClose={() => setPending(undefined)}
        >
          <p>
            This replaces this workspace’s data with {pending.subjects.length}{" "}
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
      <p className="hint">
        Stride {appVersion} · {isDesktop ? "Windows desktop" : "Web"} · MIT
        licensed
      </p>
    </>
  );
}
