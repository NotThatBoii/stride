import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { mockAuth, users } from "../auth-mock";
import { sizes, workload } from "../../scripts/performance/workload.mjs";
import { formatTime } from "../../src/lib/analytics";

// Synthetic records enter an isolated test database directly. This is not an
// application import path and is never exposed to users.
for (const count of sizes) {
  test(`${count} sessions: production startup, allocations, history and insights`, async ({
    page,
    browserName,
  }) => {
    const mock = await mockAuth(page);
    await page.addInitScript(() => {
      const metrics = {
        readyAt: 0,
        longTasks: [] as number[],
        databaseTransactions: [] as {
          stores: string[];
          mode: string;
          durationMs: number;
        }[],
        databaseQueries: {} as Record<string, number>,
      };
      (
        window as unknown as { stridePerformance: typeof metrics }
      ).stridePerformance = metrics;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          metrics.longTasks.push(entry.duration);
      }).observe({ entryTypes: ["longtask"] });
      const originalTransaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) {
        const start = performance.now();
        const tx = originalTransaction.apply(this, args);
        tx.addEventListener("complete", () =>
          metrics.databaseTransactions.push({
            stores: [...tx.objectStoreNames],
            mode: tx.mode,
            durationMs: performance.now() - start,
          }),
        );
        return tx;
      };
      for (const prototype of [IDBObjectStore.prototype, IDBIndex.prototype]) {
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
            const key = `${prototype === IDBIndex.prototype ? "index" : "store"}.${name}`;
            metrics.databaseQueries[key] =
              (metrics.databaseQueries[key] ?? 0) + 1;
            return original.apply(this, args);
          };
        }
      }
      const observer = new MutationObserver(() => {
        const heading = [...document.querySelectorAll("h1")].find(
          (item) =>
            item.textContent?.replace(/\s+/g, " ").trim() ===
            "Keep your stride.",
        );
        if (!heading || metrics.readyAt) return;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (!metrics.readyAt) metrics.readyAt = performance.now();
          }),
        );
      });
      observer.observe(document, { childList: true, subtree: true });
    });
    await page.goto("/");
    await page.getByLabel("Email", { exact: true }).fill("first@example.test");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.locator(".account-form button").click();
    await expect(page.locator(".auth-screen")).toHaveCount(0);
    await expect(page.locator(".boot")).toHaveCount(0);
    const data = workload(count);
    const seed = await page.evaluate(
      async ({ value, name }) => {
        const start = performance.now();
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () =>
            reject(
              new Error("Unable to open the isolated performance database."),
            );
        });
        const opened = performance.now();
        const tx = db.transaction(
          ["subjects", "sessions", "slices", "preferences"],
          "readwrite",
        );
        for (const store of ["subjects", "sessions", "slices"])
          tx.objectStore(store).clear();
        for (const row of value.subjects) tx.objectStore("subjects").put(row);
        for (const row of value.sessions) tx.objectStore("sessions").put(row);
        for (const row of value.slices) tx.objectStore("slices").put(row);
        tx.objectStore("preferences").put({ ...value.settings, id: 1 });
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () =>
            reject(
              new Error("Unable to seed the isolated performance database."),
            );
          tx.onabort = () =>
            reject(new Error("Performance seed was interrupted."));
        });
        db.close();
        return {
          existingDatabaseOpenMs: opened - start,
          seedWriteMs: performance.now() - opened,
        };
      },
      { value: data, name: `stride-account-${users["first@example.test"]}` },
    );
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Keep your stride." }),
    ).toBeVisible();
    await expect(page.getByLabel("Heatmap year")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { stridePerformance: { readyAt: number } })
              .stridePerformance.readyAt,
        ),
      )
      .toBeGreaterThan(0);
    const startup = await page.evaluate(() => ({
      ...(
        window as unknown as {
          stridePerformance: { readyAt: number; longTasks: number[] };
        }
      ).stridePerformance,
      navigation: performance.getEntriesByType("navigation").map((entry) => ({
        duration: entry.duration,
        domContentLoaded: (entry as PerformanceNavigationTiming)
          .domContentLoadedEventEnd,
      })),
    }));
    // Validate original recorded dates, including archived-session inclusion in history.
    await page.getByLabel("Heatmap year").selectOption("2023");
    const activeSubjects = new Set(
      data.subjects
        .filter((subject: { archived: number }) => !subject.archived)
        .map((subject: { id: string }) => subject.id),
    );
    const activeIds = new Set(
      data.sessions
        .filter((session: { subject_id: string }) =>
          activeSubjects.has(session.subject_id),
        )
        .map((session: { id: string }) => session.id),
    );
    const midnightDay = "2023-10-02";
    const activeSlices = data.slices.filter(
      (slice: { day: string; session_id: string }) =>
        slice.day === midnightDay && activeIds.has(slice.session_id),
    );
    const recordedSeconds = activeSlices.reduce(
      (sum: number, slice: { seconds: number }) => sum + slice.seconds,
      0,
    );
    await expect(page.locator(`#heatmap-${midnightDay}`)).toHaveAttribute(
      "aria-label",
      `${midnightDay}: ${formatTime(recordedSeconds)} studied`,
    );
    await page.locator(`#heatmap-${midnightDay}`).click();
    await expect(page.getByRole("dialog")).toContainText(
      `${new Set(activeSlices.map((slice: { session_id: string }) => slice.session_id)).size} sessions`,
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    const historyStart = Date.now();
    await page.getByRole("button", { name: "History", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Study history" }),
    ).toBeVisible();
    await expect(page.locator(".page-heading .pill")).toContainText(
      `${count} sessions`,
    );
    await expect(page.locator(".session-row")).toHaveCount(20);
    const historyNavigationMs = Date.now() - historyStart;
    await page.getByLabel("From", { exact: true }).fill("2023-10-01");
    await page.getByLabel("To", { exact: true }).fill("2023-10-01");
    const matching = new Set(
      data.slices
        .filter((slice: { day: string }) => slice.day === "2023-10-01")
        .map((slice: { session_id: string }) => slice.session_id),
    ).size;
    await expect(page.locator(".page-heading .pill")).toContainText(
      `${matching} sessions`,
    );
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(page.locator(".page-heading .pill")).toContainText(
      `${count} sessions`,
    );
    const insightsStart = Date.now();
    await page.getByRole("button", { name: "Insights", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Insights", exact: true }),
    ).toBeVisible();
    const insightsNavigationMs = Date.now() - insightsStart;
    const dashboardStart = Date.now();
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Keep your stride." }),
    ).toBeVisible();
    const dashboardNavigationMs = Date.now() - dashboardStart;
    const beforeIdle = await page.evaluate(
      () =>
        (window as unknown as { stridePerformance: { longTasks: number[] } })
          .stridePerformance.longTasks.length,
    );
    await page.waitForTimeout(3_100);
    const idle = await page.evaluate(
      () =>
        (window as unknown as { stridePerformance: { longTasks: number[] } })
          .stridePerformance.longTasks,
    );
    const warmHistoryStart = Date.now();
    await page.getByRole("button", { name: "History", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Study history" }),
    ).toBeVisible();
    const warmHistoryNavigationMs = Date.now() - warmHistoryStart;
    const warmInsightsStart = Date.now();
    await page.getByRole("button", { name: "Insights", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Insights", exact: true }),
    ).toBeVisible();
    const warmInsightsNavigationMs = Date.now() - warmInsightsStart;
    await page.getByRole("button", { name: "Subjects", exact: true }).click();
    await page.getByRole("button", { name: "Archived", exact: true }).click();
    await page
      .getByRole("button", { name: "Study subject 19", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Study subject 19", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".stat").filter({ hasText: "sessions" }).first(),
    ).toContainText(`${count / 20} sessions`);
    await mkdir("docs/measurements", { recursive: true });
    await writeFile(
      `docs/measurements/phase6-browser-${count}.json`,
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          sessions: count,
          allocations: data.slices.length,
          browser: browserName,
          version: page.context().browser()?.version(),
          mode: "Production minified build on loopback; synthetic account IndexedDB; intercepted Auth and 503 cloud; service workers blocked; no hosted latency or packaged-native claim.",
          seed,
          startup,
          historyNavigationMs,
          insightsNavigationMs,
          dashboardNavigationMs,
          warmHistoryNavigationMs,
          warmInsightsNavigationMs,
          longTasksAfterNavigationAndThreeIdleSeconds: idle,
          idleLongTasksMs: idle.slice(beforeIdle),
          authenticationHttpRequests: mock.calls.filter(
            (call) =>
              call.includes("/auth/v1/") && !call.startsWith("OPTIONS "),
          ).length,
          syncHttpRequests: mock.calls.filter(
            (call) =>
              call.includes("/rest/v1/") && !call.startsWith("OPTIONS "),
          ).length,
        },
        null,
        2,
      ) + "\n",
    );
  });
}
