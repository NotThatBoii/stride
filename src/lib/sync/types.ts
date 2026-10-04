import type { SyncEntity } from "../local-database";
import type { Session, Slice, Subject } from "../../models";

export interface SharedSettings {
  minimum: number;
  goal: number;
  presets: string;
  weekStart: number;
}

export type CloudPayload =
  | Subject
  | { session: Session; slices: Slice[] }
  | SharedSettings
  | null;
export interface SyncVersion {
  action: "upsert" | "delete";
  payload: CloudPayload;
}

// This is frozen in IndexedDB before dispatch. Credentials never enter it.
export interface WireOperation extends SyncVersion {
  id: string;
  entity: SyncEntity;
  record_id: string;
  base_revision: string | null;
}

export interface AppliedResult {
  status: "applied";
  entity: SyncEntity;
  record_id: string;
  action: "upsert" | "delete";
  revision: string;
  cursor: string;
}
export interface ConflictResult {
  status: "conflict";
  entity: SyncEntity;
  record_id: string;
  current_revision: string | null;
  deleted: boolean;
  current_snapshot: CloudPayload;
}
export type ApplyResult = AppliedResult | ConflictResult;
export interface SyncChange extends SyncVersion {
  sequence: string;
  entity: SyncEntity;
  record_id: string;
  revision: string;
  operation_id: string;
}
export interface ChangePage {
  changes: SyncChange[];
  cursor: string;
  has_more: boolean;
}
export interface SyncAdapter {
  apply(operation: WireOperation, signal?: AbortSignal): Promise<ApplyResult>;
  changes(
    after: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<ChangePage>;
}
export type SyncGuard = () => void;

export class SyncError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "transient"
      | "auth"
      | "permanent"
      | "malformed"
      | "cancelled",
    readonly retryAfterMs?: number,
    readonly definitiveNoCommit = false,
  ) {
    super(message);
    this.name = "SyncError";
  }
}
