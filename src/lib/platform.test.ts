import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  save: vi.fn(),
  open: vi.fn(),
  writeTextFile: vi.fn(),
  readTextFile: vi.fn(),
  stat: vi.fn(),
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/plugin-dialog", () => native);
vi.mock("@tauri-apps/plugin-fs", () => native);
vi.mock("@tauri-apps/plugin-notification", () => native);

import {
  exportBackup,
  openDesktopBackup,
  requestNotifications,
  notifySessionComplete,
} from "./platform";

describe("native platform boundary", () => {
  beforeEach(() => vi.resetAllMocks());

  it("cancels export without writing any file", async () => {
    native.save.mockResolvedValue(null);
    expect(await exportBackup("{}")).toBe(false);
    expect(native.writeTextFile).not.toHaveBeenCalled();
  });

  it("writes only to the path selected in the save dialog", async () => {
    native.save.mockResolvedValue("C:\\Backups\\stride.json");
    expect(await exportBackup('{"version":1}')).toBe(true);
    expect(native.writeTextFile).toHaveBeenCalledExactlyOnceWith(
      "C:\\Backups\\stride.json",
      '{"version":1}',
    );
  });

  it("surfaces filesystem failures instead of reporting a successful export", async () => {
    native.save.mockResolvedValue("C:\\Backups\\stride.json");
    native.writeTextFile.mockRejectedValue(new Error("Disk full"));
    await expect(exportBackup("{}")).rejects.toThrow("Disk full");
  });

  it("cancels import without accessing the filesystem", async () => {
    native.open.mockResolvedValue(null);
    expect(await openDesktopBackup()).toBeNull();
    expect(native.stat).not.toHaveBeenCalled();
    expect(native.readTextFile).not.toHaveBeenCalled();
  });

  it("rejects oversized backups before reading them into memory", async () => {
    native.open.mockResolvedValue("C:\\Backups\\large.json");
    native.stat.mockResolvedValue({ size: 25 * 1024 * 1024 + 1 });
    await expect(openDesktopBackup()).rejects.toThrow("25 MB");
    expect(native.readTextFile).not.toHaveBeenCalled();
  });

  it("returns the chosen backup for schema validation", async () => {
    native.open.mockResolvedValue("C:\\Backups\\stride.json");
    native.stat.mockResolvedValue({ size: 2 });
    native.readTextFile.mockResolvedValue("{}");
    expect(await openDesktopBackup()).toBe("{}");
    expect(native.readTextFile).toHaveBeenCalledExactlyOnceWith(
      "C:\\Backups\\stride.json",
    );
  });

  it("does not prompt again when notifications are already allowed", async () => {
    native.isPermissionGranted.mockResolvedValue(true);
    expect(await requestNotifications()).toBe(true);
    expect(native.requestPermission).not.toHaveBeenCalled();
  });

  it("respects denied notification permission", async () => {
    native.isPermissionGranted.mockResolvedValue(false);
    native.requestPermission.mockResolvedValue("denied");
    expect(await requestNotifications()).toBe(false);
    await notifySessionComplete();
    expect(native.sendNotification).not.toHaveBeenCalled();
  });
});
