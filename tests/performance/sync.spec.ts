import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { mockAuth, users } from "../auth-mock";
import { SqlSyncServer } from "../sync-fixture";
import {
  jsonBytes,
  operations,
  rpcBody,
  sizes,
  workload,
} from "../../scripts/performance/workload.mjs";

const account = users["first@example.test"];

async function localState(page: Page) {
  return page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(new Error("Unable to open test database."));
    });
    const tx = db.transaction(
      [
        "sessions",
        "slices",
        "pendingOperations",
        "syncCursors",
        "syncMetadata",
      ],
      "readonly",
    );
    (
      window as unknown as {
        ignoredPerformanceTransactions: WeakSet<IDBTransaction>;
      }
    ).ignoredPerformanceTransactions.add(tx);
    const value = <T>(request: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(new Error("Unable to inspect test state."));
      });
    const [sessions, slices, pending, cursor, last] = await Promise.all([
      value(tx.objectStore("sessions").count()),
      value(tx.objectStore("slices").count()),
      value(tx.objectStore("pendingOperations").count()),
      value(tx.objectStore("syncCursors").get("study")),
      value(tx.objectStore("syncMetadata").get("last_successful_sync")),
    ]);
    db.close();
    return {
      sessions,
      slices,
      pending,
      cursor: cursor?.cursor ?? "0",
      last: last?.value ?? null,
    };
  }, `stride-account-${account}`);
}

for (const count of sizes) {
  test(`${count} cloud sessions: full production pull and 100 incremental pushes`, async ({
    page,
  }) => {
    const server = await SqlSyncServer.create();
    const data = workload(count);
    try {
      // Seed by the real unchanged RPC, including receipts/change history; no
      // direct inserts into study/version tables and no hosted test traffic.
      for (const operation of operations(data)) {
        const body = rpcBody(operation);
        const reply = await server.db.transaction(async (tx) => {
          await tx.exec("set local role authenticated");
          await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
            account,
          ]);
          return (
            await tx.query<{ result: { status: string } }>(
              "select public.apply_sync_operation($1::uuid,$2::text,$3::text,$4::text,$5::jsonb,$6::text) as result",
              [
                body.p_operation_id,
                body.p_entity,
                body.p_record_id,
                body.p_action,
                JSON.stringify(body.p_payload),
                body.p_expected_revision,
              ],
            )
          ).rows[0].result;
        });
        expect(reply.status).toBe("applied");
      }
      await page.addInitScript(() => {
        const ignored = new WeakSet<IDBTransaction>();
        const counters: Record<string, number> = {};
        (
          window as unknown as {
            ignoredPerformanceTransactions: typeof ignored;
          }
        ).ignoredPerformanceTransactions = ignored;
        (
          window as unknown as { performanceQueries: typeof counters }
        ).performanceQueries = counters;
        for (const prototype of [
          IDBObjectStore.prototype,
          IDBIndex.prototype,
        ]) {
          for (const name of [
            "get",
            "getAll",
            "getAllKeys",
            "openCursor",
            "openKeyCursor",
            "count",
          ]) {
            const methods = prototype as unknown as Record<
              string,
              (...args: unknown[]) => unknown
            >;
            const original = methods[name];
            methods[name] = function (...args) {
              const object = this as unknown as IDBObjectStore & {
                objectStore?: IDBObjectStore;
              };
              if (
                !ignored.has(
                  object.objectStore?.transaction ?? object.transaction,
                )
              ) {
                const key = `${prototype === IDBIndex.prototype ? "index" : "store"}.${name}`;
                counters[key] = (counters[key] ?? 0) + 1;
              }
              return original.apply(this, args);
            };
          }
        }
      });
      const auth = await mockAuth(page);
      await server.attach(page);
      await page.goto("/");
      await page
        .getByLabel("Email", { exact: true })
        .fill("first@example.test");
      await page.getByLabel("Password", { exact: true }).fill("password123");
      const pullStarted = Date.now();
      await page.locator(".account-form button").click();
      await expect(page.locator(".auth-screen")).toHaveCount(0);
      await expect(page.locator(".boot")).toHaveCount(0);
      await expect
        .poll(async () => (await localState(page)).cursor, { timeout: 120_000 })
        .toBe(String(count + 21));
      await expect
        .poll(async () => (await localState(page)).last, { timeout: 120_000 })
        .not.toBeNull();
      const pullWallMs = Date.now() - pullStarted;
      const pulled = await localState(page);
      expect(pulled.sessions).toBe(count);
      expect(pulled.slices).toBe(data.slices.length);
      const pullCalls = [...server.calls];
      const pullQueries = await page.evaluate(() => ({
        ...(window as unknown as { performanceQueries: Record<string, number> })
          .performanceQueries,
      }));
      // A 100-item batch measures ordinary client upload cost at each workspace
      // size. SQL-only creation of every fixture record is measured separately.
      const extra = workload(100);
      const mapping = new Map(
        extra.sessions.map((session: { id: string }, index: number) => [
          session.id,
          `incremental-session-${String(index + 1).padStart(3, "0")}`,
        ]),
      );
      const sessions = extra.sessions.map((session: { id: string }) => ({
        ...session,
        id: mapping.get(session.id),
      }));
      const slices = extra.slices.map((slice: { session_id: string }) => ({
        ...slice,
        session_id: mapping.get(slice.session_id),
      }));
      const beforePushCalls = server.calls.length;
      const pushStarted = Date.now();
      await page.evaluate(
        async ({ name, sessions, slices }) => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(name);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () =>
              reject(new Error("Unable to open test database."));
          });
          const tx = db.transaction(
            ["sessions", "slices", "pendingOperations", "preferences"],
            "readwrite",
          );
          (
            window as unknown as {
              ignoredPerformanceTransactions: WeakSet<IDBTransaction>;
            }
          ).ignoredPerformanceTransactions.add(tx);
          const grouped = new Map<string, typeof slices>();
          for (const slice of slices) {
            tx.objectStore("slices").put(slice);
            const values = grouped.get(slice.session_id!) ?? [];
            values.push(slice);
            grouped.set(slice.session_id!, values);
          }
          for (const session of sessions) {
            tx.objectStore("sessions").put(session);
            tx.objectStore("pendingOperations").add({
              id: crypto.randomUUID(),
              entity: "session",
              record_id: session.id,
              action: "upsert",
              payload: { session, slices: grouped.get(session.id!) },
              base_revision: null,
              status: "pending",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          }
          const prefs = tx.objectStore("preferences").get(1);
          prefs.onsuccess = () =>
            tx
              .objectStore("preferences")
              .put({ ...prefs.result, onboarded: true });
          await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(new Error("Test seed aborted."));
            tx.onerror = () => reject(new Error("Test seed failed."));
          });
          db.close();
        },
        { name: `stride-account-${account}`, sessions, slices },
      );
      // Native fixture writes intentionally bypass Dexie's application mutation
      // notifications. Use the ordinary foreground trigger so this measures
      // the 750ms scheduler rather than waiting for the 60-second idle poll.
      await page.evaluate(() =>
        document.dispatchEvent(new Event("visibilitychange")),
      );
      await expect
        .poll(async () => (await localState(page)).pending, {
          timeout: 120_000,
        })
        .toBe(0);
      await expect
        .poll(async () => (await localState(page)).cursor, { timeout: 120_000 })
        .toBe(String(count + 121));
      const pushWallMs = Date.now() - pushStarted;
      const pushed = await localState(page);
      expect(pushed.sessions).toBe(count + 100);
      expect(pushed.slices).toBe(data.slices.length + 120);
      const cloudSessions = await server.rows("sessions");
      const cloudSlices = await server.rows("allocations");
      expect(cloudSessions.length).toBe(count + 100);
      expect(cloudSlices.length).toBe(data.slices.length + 120);
      const pushCalls = server.calls.slice(beforePushCalls);
      expect(
        pushCalls.filter((call) => call.name === "apply_sync_operation"),
      ).toHaveLength(100);
      const queries = await page.evaluate(() => ({
        ...(window as unknown as { performanceQueries: Record<string, number> })
          .performanceQueries,
      }));
      // Complete this device's real onboarding. The fixture's native writes
      // don't notify React; the ordinary action reloads the current snapshot.
      if (await page.locator(".onboarding").isVisible()) {
        await page
          .getByRole("button", { name: "Continue", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Let’s begin", exact: true })
          .click();
      }
      await expect(
        page.getByRole("heading", { name: "Keep your stride." }),
      ).toBeVisible();
      // Verify a synced large account's real JSON export and additive same-ID
      // import. Complete the existing mandatory backup flow; no import bypass.
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const exportStarted = Date.now();
      const exportedEvent = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Export JSON", exact: true })
        .click();
      const exportedDownload = await exportedEvent;
      const exportedPath = test.info().outputPath("synced-workspace.json");
      await exportedDownload.saveAs(exportedPath);
      const exportedText = await readFile(exportedPath, "utf8");
      const exported = JSON.parse(exportedText);
      expect(exported.sessions).toHaveLength(count + 100);
      expect(exported.slices).toHaveLength(data.slices.length + 120);
      expect(
        exported.slices.filter(
          (slice: { session_id: string }) =>
            slice.session_id === "perf-session-00001",
        ),
      ).toEqual(
        data.slices.filter(
          (slice: { session_id: string }) =>
            slice.session_id === "perf-session-00001",
        ),
      );
      const exportWallMs = Date.now() - exportStarted;
      const importStarted = Date.now();
      await page.getByLabel("Import backup file").setInputFiles({
        name: "synced-workspace.json",
        mimeType: "application/json",
        buffer: Buffer.from(exportedText),
      });
      const dialog = page.getByRole("dialog", { name: "Review backup import" });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Download backup", exact: true }),
      ).toBeEnabled({ timeout: 120_000 });
      const backupEvent = page.waitForEvent("download");
      await dialog
        .getByRole("button", { name: "Download backup", exact: true })
        .click();
      const backupDownload = await backupEvent;
      await backupDownload.saveAs(test.info().outputPath("before-import.json"));
      await dialog
        .getByRole("button", { name: "Import history", exact: true })
        .click();
      await expect(dialog).toHaveCount(0, { timeout: 120_000 });
      const imported = await localState(page);
      expect(imported.sessions).toBe(count + 100);
      expect(imported.slices).toBe(data.slices.length + 120);
      expect(imported.pending).toBe(0);
      expect(imported.cursor).toBe(pushed.cursor);
      expect(
        server.calls.filter((call) => call.name === "apply_sync_operation"),
      ).toHaveLength(100);
      const importWallMs = Date.now() - importStarted;
      const summarize = (calls: typeof server.calls) => ({
        applyCalls: calls.filter((call) => call.name === "apply_sync_operation")
          .length,
        changePageCalls: calls.filter(
          (call) => call.name === "get_sync_changes",
        ).length,
        changes: calls.reduce(
          (sum, call) =>
            sum +
            ((call.result as { changes?: unknown[] })?.changes?.length ?? 0),
          0,
        ),
        requestJsonBytes: calls.reduce(
          (sum, call) => sum + jsonBytes(call.body),
          0,
        ),
        responseJsonBytes: calls.reduce(
          (sum, call) =>
            sum + (call.result === undefined ? 0 : jsonBytes(call.result)),
          0,
        ),
        unfinishedResponses: calls.filter((call) => call.result === undefined)
          .length,
      });
      await mkdir("docs/measurements", { recursive: true });
      await writeFile(
        `docs/measurements/phase6-sync-${count}.json`,
        JSON.stringify(
          {
            measuredAt: new Date().toISOString(),
            sessions: count,
            browser: page.context().browser()?.version(),
            mode: "Production minified Edge SDK/worker/Dexie against unchanged SQL in PGlite through intercepted RPC transport; mock Auth; one SQL connection; no hosted/PostgREST/native latency claim.",
            initialPull: {
              wallMsFromSignInClick: pullWallMs,
              ...summarize(pullCalls),
              indexedDbReadQueries: pullQueries,
            },
            incrementalPush100: {
              wallMsFromBatchWriteIncludingForegroundDebounce: pushWallMs,
              ...summarize(pushCalls),
              indexedDbReadQueries: Object.fromEntries(
                Object.entries(queries).map(([key, value]) => [
                  key,
                  value - (pullQueries[key] ?? 0),
                ]),
              ),
            },
            authHttpRequests: auth.calls.filter(
              (call) =>
                call.includes("/auth/v1/") && !call.startsWith("OPTIONS "),
            ).length,
            backupRoundTrip: {
              exportedSessions: count + 100,
              exportedAllocations: data.slices.length + 120,
              exportedUtf8Bytes: Buffer.byteLength(exportedText),
              exportWallMs,
              sameBackupImportIncludingRequiredBackupWallMs: importWallMs,
              duplicateApplyOperations: 0,
            },
          },
          null,
          2,
        ) + "\n",
      );
    } finally {
      await page.close();
      await server.close();
    }
  });
}
