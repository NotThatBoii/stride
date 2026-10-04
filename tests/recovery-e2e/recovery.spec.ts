import { readFile } from "node:fs/promises";
import {
  expect,
  test as base,
  type Browser,
  type Download,
} from "@playwright/test";
import {
  SqlSyncServer,
  device,
  saveSubject,
  saveSession,
  subject,
  session,
  slices,
  snapshot,
  settle,
  syncNow,
} from "../sync-fixture";

const test = base.extend<{ cloud: SqlSyncServer }>({
  cloud: async ({}, use) => {
    const cloud = await SqlSyncServer.create();
    try {
      await use(cloud);
    } finally {
      await cloud.close();
    }
  },
});
test.afterEach(async ({ browser }) => {
  await Promise.all(browser.contexts().map((context) => context.close()));
});
async function account(browser: Browser, cloud: SqlSyncServer) {
  const profile = await browser.newContext({
    baseURL: "http://127.0.0.1:1428",
    timezoneId: "Asia/Manila",
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
  });
  return device(browser, cloud, { profile });
}
async function downloaded(download: Download) {
  const path = await download.path();
  if (!path) throw new Error("Recovery download did not finish.");
  return JSON.parse(await readFile(path, "utf8"));
}

test("quarantine review exports before rebuilding, keeps the rejected body and uploads the current record under a new UUID", async ({
  browser,
  cloud,
}) => {
  const a = await account(browser, cloud);
  await saveSubject(a.page);
  await settle(a.page);
  const badId = await a.page.evaluate(async (record) => {
    const storage = await import("/src/lib/storage.ts");
    const { activeSyncWorker: worker } = await import(
      "/src/lib/sync/worker.ts"
    );
    return worker!.runExclusive(async (db, guard) => {
      await db.subjects.put({
        ...record,
        description: "Latest valid local record",
      });
      await storage.enqueueOperation(db, "subject", record.id, "upsert", {
        ...record,
        name: "",
      });
      guard();
      return (await db.pendingOperations.toArray())[0].id;
    });
  }, subject());
  await syncNow(a.page);
  await a.page.getByRole("button", { name: "Settings", exact: true }).click();
  const recovery = a.page.getByRole("region", {
    name: "Recovery and sync issues",
  });
  await expect(recovery).toContainText("1 change needs recovery");
  await recovery.getByText("Pending changes (1)", { exact: true }).click();
  await recovery.getByRole("button", { name: "Inspect change" }).click();
  const dialog = a.page.getByRole("dialog", { name: "Review saved change" });
  await expect(dialog).toContainText("Latest valid local record");
  await expect(dialog).toContainText("has not been sent");
  const before = await snapshot(a.page);
  await a.page.evaluate(() => {
    (window as any).recoveryOriginalUrl = URL.createObjectURL;
    URL.createObjectURL = () => {
      throw new Error("Test export blocked");
    };
  });
  await dialog
    .getByRole("button", { name: "Export and rebuild change", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Test export blocked");
  const blocked = await snapshot(a.page);
  expect(blocked.operations).toEqual(before.operations);
  expect(blocked.recovery).toEqual(before.recovery);
  await a.page.evaluate(() => {
    URL.createObjectURL = (window as any).recoveryOriginalUrl;
    delete (window as any).recoveryOriginalUrl;
  });
  const downloadPromise = a.page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Export and rebuild change", exact: true })
    .click();
  const recoveryDownload = await downloadPromise;
  expect(recoveryDownload.suggestedFilename()).toMatch(/^stride-recovery-/);
  const backup = await downloaded(recoveryDownload);
  expect(backup.format).toBe("stride-recovery");
  expect(backup.synchronization.pendingOperations[0].id).toBe(badId);
  expect(backup.synchronization.pendingOperations[0].payload.name).toBe("");
  await expect(dialog).toHaveCount(0);
  await settle(a.page);
  const applied = cloud.calls.filter(
    (call) =>
      call.name === "apply_sync_operation" &&
      (call.body.p_payload as { description?: string })?.description ===
        "Latest valid local record",
  );
  expect(applied).toHaveLength(1);
  expect(applied[0].body.p_operation_id).not.toBe(badId);
  expect(
    cloud.calls.some(
      (call) =>
        call.name === "apply_sync_operation" &&
        call.body.p_operation_id === badId,
    ),
  ).toBe(false);
  const after = await snapshot(a.page);
  expect(JSON.stringify(after.recovery)).toContain(badId);
  expect(after.operations).toHaveLength(0);
  const b = await account(browser, cloud);
  expect((await snapshot(b.page)).data.subjects[0].description).toBe(
    "Latest valid local record",
  );
  await a.page.screenshot({
    path: "docs/screenshots/phase6-recovery-center.png",
    fullPage: true,
  });
});

test("a deleted session can be inspected and restored through backup-gated additive import without losing its stored copy or recorded days", async ({
  browser,
  cloud,
}) => {
  const a = await account(browser, cloud);
  await saveSubject(a.page);
  await saveSession(a.page);
  await settle(a.page);
  await a.page.getByRole("button", { name: "History", exact: true }).click();
  await a.page
    .getByRole("button", { name: "Delete session", exact: true })
    .click();
  const deletion = a.page.getByRole("dialog", { name: "Delete this session?" });
  await expect(deletion).toContainText("recovery copy stays on this device");
  await deletion
    .getByRole("button", { name: "Delete session", exact: true })
    .click();
  await settle(a.page);
  expect(await cloud.rows("sessions")).toHaveLength(0);
  const copyId = (await snapshot(a.page)).recovery.find(
    (copy) => copy.reason === "local_delete",
  )!.id;
  await a.page.getByRole("button", { name: "Settings", exact: true }).click();
  const recovery = a.page.getByRole("region", {
    name: "Recovery and sync issues",
  });
  await recovery
    .locator("summary")
    .filter({ hasText: "Preserved copies" })
    .click();
  const copyRow = recovery
    .locator(".recovery-item")
    .filter({ hasText: "Deleted session" });
  await copyRow.getByRole("button", { name: "Inspect copy" }).click();
  const inspection = a.page.getByRole("dialog", {
    name: "Inspect preserved copy",
  });
  await expect(inspection).toContainText(session().session_title);
  await expect(inspection).toContainText(session().notes);
  await expect(inspection).toContainText("2026-09-21, 2026-09-22");
  await a.page.setViewportSize({ width: 360, height: 900 });
  for (const button of await inspection.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  }
  await a.page.screenshot({
    path: "docs/screenshots/phase6-recovery-copy-mobile.png",
    fullPage: true,
  });
  await inspection
    .getByRole("button", { name: "Review history import", exact: true })
    .click();
  const importing = a.page.getByRole("dialog", {
    name: "Review backup import",
  });
  await expect(
    importing.getByRole("button", { name: "Import history", exact: true }),
  ).toBeDisabled();
  const downloadPromise = a.page.waitForEvent("download");
  await importing
    .getByRole("button", { name: "Download backup", exact: true })
    .click();
  const backup = await downloaded(await downloadPromise);
  expect(backup.format).toBe("stride");
  expect(backup.sessions).toEqual([session()]);
  expect(backup.slices).toEqual(slices());
  await importing
    .getByRole("button", { name: "Import history", exact: true })
    .click();
  await expect(importing).toHaveCount(0);
  const conflict = a.page.locator(".sync-conflict");
  await expect(conflict).toHaveCount(1);
  await conflict.locator("summary").click();
  await conflict
    .getByRole("button", { name: "Import this version", exact: true })
    .click();
  await settle(a.page);
  const restored = await snapshot(a.page);
  expect(restored.data.sessions).toEqual([session()]);
  expect(restored.data.slices).toEqual(slices());
  expect(restored.recovery.some((copy) => copy.id === copyId)).toBe(true);
  expect(await cloud.rows("sessions")).toHaveLength(1);
  expect(await cloud.rows("allocations")).toHaveLength(2);
  const b = await account(browser, cloud);
  expect((await snapshot(b.page)).data.sessions).toEqual([session()]);
  expect((await snapshot(b.page)).data.slices).toEqual(slices());
});

test("a corrupted frozen operation stays exportable and offers no unsafe rebuild action", async ({
  browser,
  cloud,
}) => {
  const a = await account(browser, cloud);
  await saveSubject(a.page);
  await settle(a.page);
  await a.page.evaluate(async (record) => {
    const storage = await import("/src/lib/storage.ts");
    const { activeSyncWorker: worker } = await import(
      "/src/lib/sync/worker.ts"
    );
    await worker!.runExclusive(async (db, guard) => {
      const id = crypto.randomUUID();
      const payload: any = { integer: 42n };
      payload.self = payload;
      await db.pendingOperations.add({
        id,
        entity: "subject",
        record_id: record.id,
        action: "upsert",
        payload: record,
        base_revision: "1",
        status: "in_flight",
        wire_request: {
          id,
          entity: "subject",
          record_id: record.id,
          action: "upsert",
          payload,
          base_revision: "1",
        },
        created_at: record.created_at,
        updated_at: record.created_at,
      });
      guard();
    });
  }, subject());
  await syncNow(a.page);
  await a.page.getByRole("button", { name: "Settings", exact: true }).click();
  const recovery = a.page.getByRole("region", {
    name: "Recovery and sync issues",
  });
  await expect(recovery).toContainText("1 change needs recovery");
  await recovery.getByText("Pending changes (1)", { exact: true }).click();
  await recovery.getByRole("button", { name: "Inspect change" }).click();
  const dialog = a.page.getByRole("dialog", { name: "Review saved change" });
  await expect(dialog).toContainText("cannot be read safely");
  await expect(
    dialog.getByRole("button", { name: "Export and rebuild change" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Export and retry original request" }),
  ).toHaveCount(0);
  const downloadPromise = a.page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Export recovery data", exact: true })
    .click();
  const backup = await downloaded(await downloadPromise);
  const payload =
    backup.synchronization.pendingOperations[0].wire_request.payload;
  expect(payload.integer.$strideRecovery.value).toBe("42");
  expect(payload.self.$strideRecovery.type).toBe("reference");
  expect(
    await a.page.evaluate(async () =>
      (await import("/src/lib/storage.ts"))
        .getActiveDatabase()
        .pendingOperations.count(),
    ),
  ).toBe(1);
  expect(await cloud.rows("subjects")).toHaveLength(1);
});
