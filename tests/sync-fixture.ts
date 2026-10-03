import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import type { Data, Session, Slice, Subject } from "../src/models";
import {
  authOrigin,
  mockAuth,
  requestAccount,
  signIn,
  users,
} from "./auth-mock";

type RpcBody = Record<string, unknown>;
export interface RpcCall {
  account: string;
  name: string;
  body: RpcBody;
  result?: unknown;
}

// A transport fixture, not a second implementation of the sync protocol.
// Every successful RPC executes the unchanged deployed Phase 3 migration.
// Auth remains a test-only SDK response; this is not real PostgREST or Auth.
export class SqlSyncServer {
  readonly calls: RpcCall[] = [];
  dropNextAcknowledgment = false;
  unavailable = false;
  pageSize: number | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private pushGate: {
    entered: () => void;
    wait: Promise<void>;
  } | null = null;
  private pullGate: {
    page: Page;
    entered: () => void;
    wait: Promise<void>;
  } | null = null;

  private constructor(readonly db: PGlite) {}

  static async create() {
    const db = await PGlite.create();
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      insert into auth.users(id) values
        ('${users["first@example.test"]}'), ('${users["second@example.test"]}');
    `);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20260929000000_stride_sync.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    return new SqlSyncServer(db);
  }

  holdNextAcknowledgment() {
    let release!: () => void;
    let entered!: () => void;
    const wait = new Promise<void>((resolve) => (release = resolve));
    const committed = new Promise<void>((resolve) => (entered = resolve));
    this.pushGate = { entered, wait };
    return { release, committed };
  }

  holdNextPull(page: Page) {
    let release!: () => void;
    let entered!: () => void;
    const wait = new Promise<void>((resolve) => (release = resolve));
    const captured = new Promise<void>((resolve) => (entered = resolve));
    this.pullGate = { page, entered, wait };
    return { release, captured };
  }

  private execute(account: string, name: string, body: RpcBody) {
    const run = this.tail.then(() =>
      this.db.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [
          account,
        ]);
        const result =
          name === "apply_sync_operation"
            ? await tx.query<{ result: unknown }>(
                `select public.apply_sync_operation(
                  $1::uuid, $2::text, $3::text, $4::text, $5::jsonb, $6::text
                ) as result`,
                [
                  body.p_operation_id,
                  body.p_entity,
                  body.p_record_id,
                  body.p_action,
                  body.p_payload === null
                    ? null
                    : JSON.stringify(body.p_payload),
                  body.p_expected_revision,
                ],
              )
            : await tx.query<{ result: unknown }>(
                "select public.get_sync_changes($1::text, $2::integer) as result",
                [body.p_after, this.pageSize ?? body.p_limit],
              );
        return result.rows[0].result;
      }),
    );
    this.tail = run.catch(() => undefined);
    return run;
  }

  async attach(page: Page) {
    await page.route(`${authOrigin}/rest/v1/**`, async (route: Route) => {
      const request = route.request();
      const headers = {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "*",
      };
      const respond = (status: number, body: unknown) =>
        route.fulfill({
          status,
          headers,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      if (request.method() === "OPTIONS") return respond(200, {});
      const account = requestAccount(request);
      if (!account) return respond(401, { message: "Unauthorized" });
      const name = new URL(request.url()).pathname.split("/").at(-1)!;
      if (
        request.method() !== "POST" ||
        !["apply_sync_operation", "get_sync_changes"].includes(name)
      )
        return respond(404, { message: "Unexpected study route" });
      const body = request.postDataJSON() as RpcBody;
      const call: RpcCall = { account, name, body };
      this.calls.push(call);
      if (this.unavailable)
        return respond(503, { code: "TEST_UNAVAILABLE", message: "Offline" });
      try {
        call.result = await this.execute(account, name, body);
        if (name === "get_sync_changes" && this.pullGate?.page === page) {
          const gate = this.pullGate;
          this.pullGate = null;
          gate.entered();
          await gate.wait;
        }
        if (name === "apply_sync_operation") {
          const gate = this.pushGate;
          if (gate) {
            this.pushGate = null;
            gate.entered();
            await gate.wait;
          }
          if (this.dropNextAcknowledgment) {
            this.dropNextAcknowledgment = false;
            return route.abort("connectionreset");
          }
        }
        await respond(200, call.result);
      } catch (error) {
        // SQL validation errors contain no credentials. Avoid including
        // request headers or tokens in any test output.
        await respond(400, {
          code: (error as { code?: string }).code ?? "TEST_SQL_ERROR",
          message: error instanceof Error ? error.message : "SQL error",
        });
      }
    });
  }

  async rows(
    table: "subjects" | "sessions" | "allocations",
    account = users["first@example.test"],
  ) {
    await this.tail;
    return (
      await this.db.query(
        `select * from public.stride_${table} where owner_id = $1 order by ${table === "allocations" ? "session_id, day" : "id"}`,
        [account],
      )
    ).rows;
  }

  async close() {
    await this.tail;
    await this.db.close();
  }
}

export async function device(
  browser: Browser,
  server: SqlSyncServer,
  options: {
    email?: keyof typeof users;
    timezone?: string;
    profile?: BrowserContext;
  } = {},
) {
  const context =
    options.profile ??
    (await browser.newContext({
      baseURL: "http://127.0.0.1:1423",
      timezoneId: options.timezone ?? "Asia/Manila",
      reducedMotion: "reduce",
      viewport: { width: 1440, height: 1000 },
    }));
  const page = await context.newPage();
  await mockAuth(page);
  await server.attach(page);
  await page.goto("/");
  await signIn(page, options.email);
  await page.evaluate(async () => {
    const storage = await import("/src/lib/storage.ts");
    await storage
      .getActiveDatabase()
      .preferences.update(1, { onboarded: true });
  });
  await expect(
    page.getByRole("heading", { name: "Keep your stride." }),
  ).toBeVisible();
  await syncNow(page);
  return { context, page };
}

export async function syncNow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { activeSyncWorker } = await import("/src/lib/sync/worker.ts");
        return activeSyncWorker !== null;
      }),
    )
    .toBe(true);
  return page.evaluate(async () => {
    const { activeSyncWorker } = await import("/src/lib/sync/worker.ts");
    if (!activeSyncWorker)
      throw new Error("Authenticated sync worker is unavailable");
    return activeSyncWorker.syncNow();
  });
}

export async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const storage = await import("/src/lib/storage.ts");
    const db = storage.getActiveDatabase();
    return {
      data: await storage.readData(),
      operations: await db.pendingOperations.toArray(),
      revisions: await db.recordRevisions.toArray(),
      cursors: await db.syncCursors.toArray(),
      conflicts: await db.conflicts.toArray(),
      recovery: await db.recoveryCopies.toArray(),
      metadata: await db.syncMetadata.toArray(),
    };
  });
}

export async function settle(page: Page) {
  await syncNow(page);
  await expect
    .poll(async () => (await snapshot(page)).operations.length, {
      timeout: 30_000,
    })
    .toBe(0);
}

export function subject(
  id = "shared-subject",
  name = "Cross-device mathematics",
): Subject {
  return {
    id,
    name,
    description: "Recorded on Device A",
    icon: "book",
    color: "#8b91e8",
    created_at: "2026-09-21T10:00:00.000Z",
    archived: 0,
  };
}

export function session(
  id = "shared-session",
  subjectId = "shared-subject",
): Session {
  return {
    id,
    subject_id: subjectId,
    started_at: "2026-09-21T15:50:00.000Z",
    ended_at: "2026-09-21T16:30:00.000Z",
    duration_seconds: 2400,
    session_title: "Across recorded midnight",
    notes: "Preserve the original calendar days",
    mode: "stopwatch",
    completed: 1,
  };
}

export function slices(id = "shared-session"): Slice[] {
  return [
    { session_id: id, day: "2026-09-21", seconds: 1200 },
    { session_id: id, day: "2026-09-22", seconds: 1200 },
  ];
}

export async function saveSubject(page: Page, value = subject()) {
  await page.evaluate(async (record) => {
    const storage = await import("/src/lib/storage.ts");
    await storage.saveSubject(record);
  }, value);
}

export async function saveSession(
  page: Page,
  value = session(),
  allocations = slices(value.id),
) {
  await page.evaluate(
    async ({ record, days }) => {
      const storage = await import("/src/lib/storage.ts");
      await storage.saveSession(record, days);
    },
    { record: value, days: allocations },
  );
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator(".auth-screen")).toBeVisible();
}
