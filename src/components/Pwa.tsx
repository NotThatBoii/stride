import { useState, useSyncExternalStore } from "react";
import {
  activatePwaUpdate,
  checkForPwaUpdate,
  getPwaSnapshot,
  installWebPwa,
  subscribePwa,
} from "../lib/pwa";
import "../pwa.css";
function usePwa() {
  return useSyncExternalStore(subscribePwa, getPwaSnapshot, getPwaSnapshot);
}
function UpdateButton({ busy, timer }: { busy?: boolean; timer?: boolean }) {
  const pwa = usePwa();
  return (
    <button
      disabled={busy || timer || pwa.working}
      onClick={() => void activatePwaUpdate()}
    >
      Reload to update
    </button>
  );
}
export function PwaUpdateNotice({
  busy,
  timer,
}: {
  busy?: boolean;
  timer?: boolean;
}) {
  const pwa = usePwa();
  const [dismissed, setDismissed] = useState(false);
  if (!pwa.updateAvailable || dismissed) return null;
  return (
    <aside
      className="pwa-update-notice"
      aria-label="Stride update"
      role="status"
    >
      <div>
        <strong>A Stride update is ready</strong>
        <p>
          {timer
            ? "Save or discard your focus session before updating."
            : "Save any open edits before reloading. Saved history and pending sync changes stay on this device."}
        </p>
        {pwa.message && <p>{pwa.message}</p>}
      </div>
      <div className="pwa-actions">
        <UpdateButton busy={busy} timer={timer} />
        <button className="secondary" onClick={() => setDismissed(true)}>
          Later
        </button>
      </div>
    </aside>
  );
}
export function PwaSettings({
  busy,
  timer,
}: {
  busy?: boolean;
  timer?: boolean;
}) {
  const pwa = usePwa();
  if (!pwa.enabled) return null;
  return (
    <section className="panel pwa-settings" aria-labelledby="pwa-heading">
      <h2 id="pwa-heading">Stride on this device</h2>
      <p>
        {pwa.offlineReady
          ? "The app is ready to reopen offline. Your restored account session and locally saved history remain on this device."
          : "Preparing the app for offline access. Keep Stride open and connected until this is ready."}
      </p>
      <p className="hint">
        {pwa.standalone
          ? "Opened as an installed app."
          : "Install Stride from your browser’s menu, or use Add to Home Screen on a supported phone."}{" "}
        A first sign-in or an expired account session needs a connection. Keep
        JSON backups before clearing browser data.
      </p>
      {pwa.updateAvailable && (
        <p>
          {timer
            ? "Save or discard your focus session before updating."
            : "An update is ready. Save any open edits before reloading."}
        </p>
      )}
      <div className="pwa-actions">
        {pwa.installAvailable && (
          <button
            className="secondary"
            disabled={pwa.working || busy}
            onClick={() => void installWebPwa()}
          >
            Install Stride
          </button>
        )}
        <button
          className="secondary"
          disabled={pwa.working || busy}
          onClick={() => void checkForPwaUpdate()}
        >
          Check for updates
        </button>
        {pwa.updateAvailable && <UpdateButton busy={busy} timer={timer} />}
      </div>
      {pwa.message && <p role="status">{pwa.message}</p>}
    </section>
  );
}
