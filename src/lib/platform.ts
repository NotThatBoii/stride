import { isTauri } from "@tauri-apps/api/core";

export const isDesktop = isTauri();
export const appVersion = "0.4.0";

export async function requestNotifications(): Promise<boolean> {
  if (isDesktop) {
    const { isPermissionGranted, requestPermission } = await import(
      "@tauri-apps/plugin-notification"
    );
    return (
      (await isPermissionGranted()) || (await requestPermission()) === "granted"
    );
  }
  return (
    "Notification" in window &&
    (await Notification.requestPermission()) === "granted"
  );
}

export async function notifySessionComplete(): Promise<void> {
  const title = "Focus session complete";
  const body = "Open Stride to save your study session.";
  if (isDesktop) {
    const { sendNotification, isPermissionGranted } = await import(
      "@tauri-apps/plugin-notification"
    );
    if (await isPermissionGranted()) sendNotification({ title, body });
  } else if (
    "Notification" in window &&
    Notification.permission === "granted"
  ) {
    new Notification(title, { body });
  }
}

export async function exportBackup(text: string): Promise<boolean> {
  const filename = `stride-export-${new Date().toISOString().slice(0, 10)}.json`;
  if (isDesktop) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      defaultPath: filename,
      filters: [{ name: "Stride backup", extensions: ["json"] }],
    });
    if (!path) return false;
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(path, text);
  } else {
    const url = URL.createObjectURL(
      new Blob([text], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return true;
}

export async function openDesktopBackup(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Stride backup", extensions: ["json"] }],
  });
  if (!path) return null;
  const { readTextFile, stat } = await import("@tauri-apps/plugin-fs");
  if ((await stat(path)).size > 25 * 1024 * 1024)
    throw new Error("Backups must be smaller than 25 MB.");
  return readTextFile(path);
}
