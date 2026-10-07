import { z } from "zod";
import { defaults, type Subject } from "../../models";
import type { PendingOperation, SyncEntity } from "../local-database";
import { validateData } from "../validation";
import { isStudyTimestamp } from "../calendar-validation";
import { maximumSessionAllocations } from "../study-limits";
import {
  SyncError,
  type CloudPayload,
  type SharedSettings,
  type WireOperation,
} from "./types";
export type { CloudPayload, SharedSettings } from "./types";

const decimal = /^(0|[1-9][0-9]*)$/;
const maximum = "9223372036854775807";
export function normalizeRevision(value: unknown, allowZero = false): string {
  if (
    typeof value !== "string" ||
    !decimal.test(value) ||
    (!allowZero && value === "0") ||
    value.length > maximum.length ||
    (value.length === maximum.length && value > maximum)
  )
    throw new SyncError(
      "Invalid synchronization revision or cursor.",
      "malformed",
    );
  return value;
}
export function compareRevision(a: string, b: string): number {
  normalizeRevision(a, true);
  normalizeRevision(b, true);
  return a.length === b.length
    ? a === b
      ? 0
      : a < b
        ? -1
        : 1
    : a.length < b.length
      ? -1
      : 1;
}

export function normalizeTimestamp(value: unknown): string {
  if (!isStudyTimestamp(value))
    throw new SyncError(
      "Invalid study timestamp; its local copy is preserved.",
      "permanent",
    );
  // Legacy offset-less timestamps use the same local-time interpretation as
  // the original application. Freeze this instant before any network request.
  return new Date(value).toISOString();
}
export function sharedSettings(value: unknown): SharedSettings {
  const parsed = z
    .object({
      minimum: z.number().int().min(1).max(1440),
      goal: z.number().int().min(1).max(1440),
      presets: z.string(),
      weekStart: z.union([z.literal(0), z.literal(1)]),
    })
    .parse(value);
  const presets = parsed.presets.split(",").map(Number);
  if (
    !presets.length ||
    presets.length > 6 ||
    new Set(presets).size !== presets.length ||
    presets.some((n) => !Number.isInteger(n) || n < 1 || n > 1440)
  )
    throw new SyncError(
      "Invalid shared timer presets; its local copy is preserved.",
      "permanent",
    );
  return { ...parsed, presets: presets.join(",") };
}
const placeholder = (id: string): Subject => ({
  id,
  name: "Sync validation",
  description: "",
  icon: "book",
  color: "#000000",
  created_at: "2020-01-01T00:00:00.000Z",
  archived: 0,
});

export function normalizePayload(
  entity: SyncEntity,
  payload: unknown,
): CloudPayload {
  if (payload === null) return null;
  try {
    if (entity === "settings") return sharedSettings(payload);
    if (entity === "subject") {
      const raw = payload as Subject;
      const normalized = {
        ...raw,
        created_at: normalizeTimestamp(raw.created_at),
      };
      return validateData({
        subjects: [normalized],
        sessions: [],
        slices: [],
        settings: defaults,
        running: null,
      }).subjects[0];
    }
    const raw = payload as {
      session: { subject_id: string; started_at: string; ended_at: string };
      slices: unknown[];
    };
    if (
      !raw?.session ||
      !Array.isArray(raw.slices) ||
      raw.slices.length > maximumSessionAllocations
    )
      throw new Error("Invalid session allocations");
    const session = {
      ...raw.session,
      started_at: normalizeTimestamp(raw.session.started_at),
      ended_at: normalizeTimestamp(raw.session.ended_at),
    };
    const validated = validateData({
      subjects: [placeholder(session.subject_id)],
      sessions: [session],
      slices: raw.slices,
      settings: defaults,
      running: null,
    });
    return {
      session: validated.sessions[0],
      slices: validated.slices.sort((a, b) => a.day.localeCompare(b.day)),
    };
  } catch (error) {
    if (error instanceof SyncError) throw error;
    throw new SyncError(
      "Invalid study data; its local copy is preserved.",
      "permanent",
    );
  }
}
export function equivalentPayload(
  entity: SyncEntity,
  a: unknown,
  b: unknown,
): boolean {
  try {
    return (
      JSON.stringify(normalizePayload(entity, a)) ===
      JSON.stringify(normalizePayload(entity, b))
    );
  } catch {
    return false;
  }
}
export function normalizeOperation(
  operation: PendingOperation | WireOperation,
): WireOperation {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      operation.id,
    ) ||
    !["subject", "session", "settings"].includes(operation.entity) ||
    typeof operation.record_id !== "string" ||
    !operation.record_id.length ||
    operation.record_id.length > 200 ||
    (operation.entity === "settings" && operation.record_id !== "settings") ||
    !["upsert", "delete"].includes(operation.action)
  )
    throw new SyncError(
      "A pending change is invalid; its local copy is preserved.",
      "permanent",
    );
  const payload = normalizePayload(operation.entity, operation.payload);
  if ((operation.action === "delete") !== (payload === null))
    throw new SyncError(
      "A pending change has an invalid payload; its local copy is preserved.",
      "permanent",
    );
  if (payload && operation.entity !== "settings") {
    const id =
      operation.entity === "subject"
        ? (payload as Subject).id
        : (payload as { session: { id: string } }).session.id;
    if (id !== operation.record_id)
      throw new SyncError("A pending change identity is invalid.", "permanent");
  }
  return {
    id: operation.id,
    entity: operation.entity,
    record_id: operation.record_id,
    action: operation.action,
    payload,
    base_revision:
      operation.base_revision === null
        ? null
        : normalizeRevision(operation.base_revision),
  };
}
