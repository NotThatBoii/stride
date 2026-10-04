import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  compareRevision,
  normalizeOperation,
  normalizePayload,
  normalizeRevision,
} from "./normalization";
import {
  SyncError,
  type ApplyResult,
  type ChangePage,
  type SyncAdapter,
  type SyncChange,
  type SyncGuard,
  type WireOperation,
} from "./types";

const retryHints = new WeakMap<AbortSignal, number>();
export function retryAfterMilliseconds(
  value: string | null,
  now = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const seconds = /^\d+(?:\.\d+)?$/.test(value.trim())
    ? Number(value) * 1000
    : NaN;
  const delay = Number.isFinite(seconds) ? seconds : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
}
// Supabase's official RPC builder omits response headers. Capture only the
// public retry delay, tied to this request's signal; never capture credentials.
export const syncAwareFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  const signal = init?.signal;
  const hint = retryAfterMilliseconds(response.headers.get("Retry-After"));
  if (signal && hint !== undefined) retryHints.set(signal, hint);
  return response;
};

const entity = z.enum(["subject", "session", "settings"]);
const action = z.enum(["upsert", "delete"]);
const recordId = z.string().min(1).max(200);
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const appliedSchema = z
  .object({
    status: z.literal("applied"),
    entity,
    record_id: recordId,
    action,
    revision: z.string(),
    cursor: z.string(),
  })
  .strict();
const conflictSchema = z
  .object({
    status: z.literal("conflict"),
    entity,
    record_id: recordId,
    current_revision: z.string().nullable(),
    deleted: z.boolean(),
    current_snapshot: z.unknown(),
  })
  .strict();
const changeSchema = z
  .object({
    sequence: z.string(),
    entity,
    record_id: recordId,
    action,
    payload: z.unknown(),
    revision: z.string(),
    operation_id: uuid,
  })
  .strict();

function validateVersion(
  entityName: SyncChange["entity"],
  id: string,
  operationAction: SyncChange["action"],
  payload: unknown,
) {
  if ((operationAction === "delete") !== (payload === null))
    throw new Error("Invalid change payload");
  if (payload === null) return null;
  const normalized = normalizePayload(entityName, payload);
  if (entityName === "settings") {
    if (id !== "settings") throw new Error("Invalid settings identity");
  } else if (entityName === "subject") {
    if ((normalized as { id: string }).id !== id)
      throw new Error("Invalid subject identity");
  } else if ((normalized as { session: { id: string } }).session.id !== id)
    throw new Error("Invalid session identity");
  return normalized;
}
export function parseApplyResult(
  value: unknown,
  operation: WireOperation,
): ApplyResult {
  try {
    const result = z
      .discriminatedUnion("status", [appliedSchema, conflictSchema])
      .parse(value);
    if (
      result.entity !== operation.entity ||
      result.record_id !== operation.record_id
    )
      throw new Error("Wrong acknowledgement");
    if (result.status === "applied") {
      if (result.action !== operation.action)
        throw new Error("Wrong acknowledgement action");
      return {
        ...result,
        revision: normalizeRevision(result.revision),
        cursor: normalizeRevision(result.cursor, true),
      };
    }
    const revision =
      result.current_revision === null
        ? null
        : normalizeRevision(result.current_revision);
    if (result.deleted && result.current_snapshot !== null)
      throw new Error("Invalid tombstone conflict");
    if (
      !result.deleted &&
      revision !== null &&
      result.current_snapshot === null
    )
      throw new Error("Missing conflict snapshot");
    return {
      ...result,
      current_revision: revision,
      current_snapshot:
        result.current_snapshot === null
          ? null
          : validateVersion(
              result.entity,
              result.record_id,
              "upsert",
              result.current_snapshot,
            ),
    };
  } catch {
    throw new SyncError(
      "The cloud returned an invalid acknowledgement. Pending changes are preserved.",
      "malformed",
    );
  }
}
export function parseChangePage(
  value: unknown,
  after: string,
  limit: number,
): ChangePage {
  try {
    normalizeRevision(after, true);
    const result = z
      .object({
        changes: z.array(changeSchema).max(limit),
        cursor: z.string(),
        has_more: z.boolean(),
      })
      .strict()
      .parse(value);
    let previous = after;
    const changes = result.changes.map((change) => {
      const sequence = normalizeRevision(change.sequence);
      if (
        compareRevision(sequence, previous) <= 0 ||
        BigInt(sequence) !== BigInt(previous) + 1n
      )
        throw new Error("Unordered or incomplete page");
      previous = sequence;
      return {
        ...change,
        sequence,
        revision: normalizeRevision(change.revision),
        payload: validateVersion(
          change.entity,
          change.record_id,
          change.action,
          change.payload,
        ),
      };
    });
    const cursor = normalizeRevision(result.cursor, true);
    if (cursor !== previous || (result.has_more && changes.length === 0))
      throw new Error("Invalid cursor progress");
    return { changes, cursor, has_more: result.has_more };
  } catch {
    throw new SyncError(
      "The cloud returned an invalid synchronization page. Local data and cursor are preserved.",
      "malformed",
    );
  }
}

export function createSyncAdapter(
  client: SupabaseClient,
  accountId: string,
  guard: SyncGuard,
  timeoutMs = 30_000,
): SyncAdapter {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      accountId,
    )
  )
    throw new SyncError(
      "Synchronization requires an authenticated account.",
      "auth",
    );
  async function rpc(
    name: string,
    args: Record<string, unknown>,
    outer?: AbortSignal,
  ): Promise<unknown> {
    guard();
    if (outer?.aborted)
      throw new SyncError("Synchronization stopped.", "cancelled");
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const abort = () => controller.abort();
    outer?.addEventListener("abort", abort, { once: true });
    try {
      const sessionRequest = client.auth.getSession();
      const { data, error } = await new Promise<Awaited<typeof sessionRequest>>(
        (resolve, reject) => {
          const onAbort = () =>
            reject(
              new SyncError(
                timedOut
                  ? "Synchronization timed out while checking your account."
                  : "Synchronization stopped.",
                timedOut ? "transient" : "cancelled",
              ),
            );
          controller.signal.addEventListener("abort", onAbort, { once: true });
          sessionRequest
            .then(resolve, reject)
            .finally(() =>
              controller.signal.removeEventListener("abort", onAbort),
            );
        },
      );
      guard();
      if (
        error ||
        !data.session?.access_token ||
        data.session.user.id.toLowerCase() !== accountId.toLowerCase()
      )
        throw new SyncError(
          "Your account session needs attention. Local changes are preserved.",
          "auth",
        );
      if (controller.signal.aborted)
        throw new SyncError(
          timedOut ? "Synchronization timed out." : "Synchronization stopped.",
          timedOut ? "transient" : "cancelled",
        );
      // Freeze this verified account's bearer on the request. A subsequent
      // SDK account change cannot substitute another account's token.
      const result = await client
        .rpc(name, args)
        .setHeader("Authorization", `Bearer ${data.session.access_token}`)
        .abortSignal(controller.signal)
        .retry(false);
      guard();
      if (outer?.aborted)
        throw new SyncError("Synchronization stopped.", "cancelled");
      const retryAfterMs = retryHints.get(controller.signal);
      retryHints.delete(controller.signal);
      if (result.error) {
        if (timedOut)
          throw new SyncError(
            "Synchronization timed out. The same change will be retried safely.",
            "transient",
          );
        const auth =
          result.status === 401 ||
          result.status === 403 ||
          ["PGRST301", "PGRST303"].includes(result.error.code);
        const transient =
          result.status === 0 ||
          result.status === 408 ||
          result.status === 429 ||
          result.status >= 500;
        // Known validation/constraint errors prove this RPC rolled back.
        // A reused UUID with another body (23505) can mean its original request
        // already committed; it must retain the original receipt uncertainty.
        // Network/proxy failures and malformed success replies are also unknown.
        const definitiveNoCommit =
          !auth &&
          !transient &&
          result.error.code !== "23505" &&
          /^(22|23)[0-9A-Z]{3}$/.test(result.error.code);
        throw new SyncError(
          auth
            ? "Your account session needs attention. Local changes are preserved."
            : transient
              ? "Unable to reach synchronization. Local changes are preserved."
              : "The cloud rejected a change. Its local copy is preserved for review.",
          auth ? "auth" : transient ? "transient" : "permanent",
          retryAfterMs,
          definitiveNoCommit,
        );
      }
      return result.data;
    } catch (error) {
      if (error instanceof SyncError) throw error;
      guard();
      if (outer?.aborted)
        throw new SyncError("Synchronization stopped.", "cancelled");
      throw new SyncError(
        timedOut
          ? "Synchronization timed out. Local changes are preserved."
          : "Unable to reach synchronization. Local changes are preserved.",
        "transient",
      );
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", abort);
      retryHints.delete(controller.signal);
    }
  }
  return {
    async apply(operation, signal) {
      const wire = normalizeOperation(operation);
      return parseApplyResult(
        await rpc(
          "apply_sync_operation",
          {
            p_operation_id: wire.id,
            p_entity: wire.entity,
            p_record_id: wire.record_id,
            p_action: wire.action,
            p_payload: wire.payload,
            p_expected_revision: wire.base_revision,
          },
          signal,
        ),
        wire,
      );
    },
    async changes(after, limit, signal) {
      normalizeRevision(after, true);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500)
        throw new SyncError("Invalid synchronization page size.", "permanent");
      return parseChangePage(
        await rpc(
          "get_sync_changes",
          { p_after: after, p_limit: limit },
          signal,
        ),
        after,
        limit,
      );
    },
  };
}
