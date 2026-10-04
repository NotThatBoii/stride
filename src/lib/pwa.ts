import { isDesktop } from "./platform";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
interface PwaSnapshot {
  enabled: boolean;
  offlineReady: boolean;
  updateAvailable: boolean;
  installAvailable: boolean;
  standalone: boolean;
  working: boolean;
  message: string;
}
export function webPwaAvailable(environment: {
  production: boolean;
  desktop: boolean;
  secure: boolean;
  protocol: string;
  serviceWorker: boolean;
}): boolean {
  return (
    environment.production &&
    !environment.desktop &&
    environment.secure &&
    /^https?:$/.test(environment.protocol) &&
    environment.serviceWorker
  );
}
let snapshot: PwaSnapshot = {
  enabled: false,
  offlineReady: false,
  updateAvailable: false,
  installAvailable: false,
  standalone: false,
  working: false,
  message: "",
};
const listeners = new Set<() => void>();
let registration: ServiceWorkerRegistration | null = null;
let registering: Promise<void> | null = null;
let installPrompt: InstallPrompt | null = null;
let started = false;
let reloadRequested = false;
let activationTimeout: ReturnType<typeof setTimeout> | null = null;
let lastCheck = 0;
const checkInterval = 60 * 60 * 1000;
function publish(next: Partial<PwaSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}
export const getPwaSnapshot = () => snapshot;
export function subscribePwa(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
async function registerWorker(): Promise<void> {
  if (registering) return registering;
  registering = navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((next) => {
      registration = next;
      const waiting = () => publish({ updateAvailable: Boolean(next.waiting) });
      waiting();
      next.addEventListener("updatefound", () => {
        const worker = next.installing;
        worker?.addEventListener("statechange", waiting);
      });
      void navigator.serviceWorker.ready.then(() =>
        publish({ offlineReady: true }),
      );
      lastCheck = Date.now();
    })
    .catch(() =>
      publish({
        message:
          "Offline access is not ready. Stay connected and check for updates again.",
      }),
    )
    .finally(() => {
      registering = null;
    });
  return registering;
}
export function startWebPwa(): void {
  if (started || typeof window === "undefined") return;
  const production = (import.meta as ImportMeta & { env: { PROD: boolean } })
    .env.PROD;
  if (
    !webPwaAvailable({
      production,
      desktop: isDesktop,
      secure: window.isSecureContext,
      protocol: window.location.protocol,
      serviceWorker: "serviceWorker" in navigator,
    })
  )
    return;
  started = true;
  publish({
    enabled: true,
    standalone: window.matchMedia("(display-mode: standalone)").matches,
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    if (typeof (event as InstallPrompt).prompt !== "function") return;
    event.preventDefault();
    installPrompt = event as InstallPrompt;
    publish({ installAvailable: true });
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    publish({ installAvailable: false, message: "Stride was installed." });
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (activationTimeout) clearTimeout(activationTimeout);
    activationTimeout = null;
    publish({ offlineReady: true });
    if (reloadRequested) window.location.reload();
  });
  void registerWorker();
  const check = () => {
    if (
      document.visibilityState === "visible" &&
      navigator.onLine &&
      (!registration || Date.now() - lastCheck >= checkInterval)
    )
      void checkForPwaUpdate(false);
  };
  document.addEventListener("visibilitychange", check);
  window.addEventListener("online", check);
  setInterval(check, checkInterval);
}
export async function checkForPwaUpdate(userRequested = true): Promise<void> {
  if (!snapshot.enabled || snapshot.working) return;
  if (!navigator.onLine) {
    if (userRequested)
      publish({ message: "Reconnect to check for a Stride update." });
    return;
  }
  lastCheck = Date.now();
  publish({ working: true, message: "" });
  try {
    if (!registration) await registerWorker();
    if (!registration) return;
    await registration.update();
    publish({
      updateAvailable: Boolean(registration.waiting),
      message: userRequested ? "Update check complete." : "",
    });
  } catch {
    if (userRequested)
      publish({
        message: "Could not check for updates. Try again when online.",
      });
  } finally {
    publish({ working: false });
  }
}
export async function installWebPwa(): Promise<void> {
  const prompt = installPrompt;
  if (!prompt || snapshot.working) return;
  installPrompt = null;
  publish({ working: true, installAvailable: false, message: "" });
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    publish({
      message:
        choice.outcome === "accepted"
          ? "Stride installation requested."
          : "You can install Stride later from your browser’s menu.",
    });
  } catch {
    publish({ message: "Use your browser’s menu to install Stride." });
  } finally {
    publish({ working: false });
  }
}
export async function activatePwaUpdate(): Promise<void> {
  const worker = registration?.waiting;
  if (!worker || snapshot.working) return;
  publish({ working: true, message: "" });
  reloadRequested = true;
  activationTimeout = setTimeout(() => {
    activationTimeout = null;
    if (!reloadRequested) return;
    reloadRequested = false;
    publish({
      working: false,
      message:
        "The update is still waiting. Your saved data is preserved. Try again.",
    });
  }, 15_000);
  try {
    await new Promise<void>((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => {
        channel.port1.close();
        reject(new Error("timeout"));
      }, 10_000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timeout);
        channel.port1.close();
        if (event.data?.ok) resolve();
        else reject(new Error("other_windows"));
      };
      worker.postMessage({ type: "ACTIVATE_STRIDE_UPDATE" }, [channel.port2]);
    });
  } catch (error) {
    if (activationTimeout) clearTimeout(activationTimeout);
    activationTimeout = null;
    reloadRequested = false;
    publish({
      working: false,
      message:
        error instanceof Error && error.message === "other_windows"
          ? "Close other Stride windows before updating, then try again."
          : "The update could not start. Your saved data is preserved. Try again.",
    });
  }
}
