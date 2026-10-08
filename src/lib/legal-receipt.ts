import type { SupabaseClient } from "@supabase/supabase-js";
import { isStudyTimestamp } from "./calendar-validation";
import { legalDocuments } from "./legal";

export interface LegalPair {
  termsVersion: string;
  privacyVersion: string;
}
export interface LegalReceipt {
  terms_version: string;
  privacy_version: string;
  accepted_at: string;
}
export const currentLegalPair = (): LegalPair => ({
  termsVersion: legalDocuments.terms.version,
  privacyVersion: legalDocuments.privacy.version,
});
export const receiptConsentMessage =
  "Agree to these document versions before recording an acknowledgement.";
export const receiptUnavailableMessage =
  "Receipt recording is not available yet. Your study workspace is still available. Try checking again later.";
export interface ReceiptRequest {
  action: "read" | "record";
  accountId: string;
  pair: LegalPair;
  signal: AbortSignal;
}
export interface ReceiptGateway {
  request(input: ReceiptRequest): Promise<unknown>;
}
class ReceiptError extends Error {
  constructor(
    readonly kind: "unavailable" | "session" | "network" | "version",
  ) {
    super(kind);
  }
}

export function parseLegalReceipt(
  value: unknown,
  pair: LegalPair,
): LegalReceipt | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid receipt");
  const receipt = value as Record<string, unknown>;
  if (
    Object.keys(receipt).length !== 3 ||
    receipt.terms_version !== pair.termsVersion ||
    receipt.privacy_version !== pair.privacyVersion ||
    typeof receipt.accepted_at !== "string" ||
    !isStudyTimestamp(receipt.accepted_at)
  )
    throw new Error("Invalid receipt");
  return {
    terms_version: pair.termsVersion,
    privacy_version: pair.privacyVersion,
    accepted_at: receipt.accepted_at,
  };
}

export function createReceiptGateway(
  client: SupabaseClient | null,
): ReceiptGateway {
  return {
    async request({ action, accountId, pair, signal }) {
      if (!client) throw new ReceiptError("unavailable");
      if (typeof navigator !== "undefined" && navigator.onLine === false)
        throw new ReceiptError("network");
      const { data, error } = await client.auth.getSession();
      if (signal.aborted) throw new ReceiptError("network");
      const session = data.session;
      if (
        error ||
        !session?.access_token ||
        session.user.id !== accountId ||
        !session.user.email_confirmed_at
      )
        throw new ReceiptError("session");
      // Pin this official SDK session to this request. Account switching cannot
      // substitute a newer account's token while the SDK fetch awaits refresh.
      // The token is never copied to receipt state, study data, files or logs.
      const response = await client
        .rpc(
          action === "read"
            ? "get_legal_acceptance"
            : "record_legal_acceptance",
          {
            p_terms_version: pair.termsVersion,
            p_privacy_version: pair.privacyVersion,
          },
        )
        .setHeader("Authorization", `Bearer ${session.access_token}`)
        .abortSignal(signal);
      if (response.error) {
        if (response.error.code === "22023") throw new ReceiptError("version");
        if (["PGRST202", "42883"].includes(response.error.code))
          throw new ReceiptError("unavailable");
        if (["PGRST301", "28000", "42501"].includes(response.error.code))
          throw new ReceiptError("session");
        throw new Error("Receipt request failed");
      }
      return response.data;
    },
  };
}

export interface ReceiptSnapshot {
  phase:
    | "idle"
    | "loading"
    | "none"
    | "recording"
    | "recorded"
    | "error"
    | "unconfirmed";
  receipt: LegalReceipt | null;
  error: string | null;
  focus: "receipt" | "error" | null;
}
function messageFrom(error: unknown, action: ReceiptRequest["action"]): string {
  if (error instanceof ReceiptError) {
    if (error.kind === "unavailable") return receiptUnavailableMessage;
    if (error.kind === "version")
      return "This service does not accept this build’s document versions. Check for a Stride update before trying again. Your study workspace is still available.";
    if (error.kind === "session")
      return "Sign in again after confirming your email to use acknowledgement recording. Your study workspace is still available.";
    if (error.kind === "network" && action === "read")
      return "Connect to the internet to check your acknowledgement. Your study workspace is still available.";
  }
  return action === "record"
    ? "The receipt could not be confirmed. Check its status before trying again. Your study workspace is still available."
    : "Could not check your acknowledgement. Check your connection and try again. Your study workspace is still available.";
}

// Component-memory-only state. Every instance belongs to one account and legal
// pair. Stop/timeout invalidates late results and aborts its request; no startup,
// login, sync, import or checkbox action creates a server receipt automatically.
export class LegalReceiptController {
  private snapshot: ReceiptSnapshot;
  private active = false;
  private serial = 0;
  private requestAbort: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  constructor(
    private readonly gateway: ReceiptGateway,
    private readonly accountId: string,
    readonly pair: LegalPair,
    private readonly confirmed: boolean,
    private readonly timeoutMs = 10000,
  ) {
    this.snapshot = {
      phase: confirmed ? "idle" : "unconfirmed",
      receipt: null,
      error: null,
      focus: null,
    };
  }
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = () => this.snapshot;
  start(): void {
    if (this.active) return;
    this.active = true;
    if (this.confirmed) void this.execute("read", false);
  }
  stop(): void {
    this.active = false;
    this.serial++;
    this.cancel();
    this.snapshot = {
      phase: this.confirmed ? "idle" : "unconfirmed",
      receipt: null,
      error: null,
      focus: null,
    };
  }
  readonly load = async (): Promise<void> => {
    await this.execute("read");
  };
  readonly record = async (consent: unknown): Promise<void> => {
    if (!this.active || !this.confirmed || this.snapshot.phase !== "none")
      return;
    const value = consent as {
      accepted?: unknown;
      termsVersion?: unknown;
      privacyVersion?: unknown;
    } | null;
    if (
      !value ||
      typeof value !== "object" ||
      value.accepted !== true ||
      value.termsVersion !== this.pair.termsVersion ||
      value.privacyVersion !== this.pair.privacyVersion
    ) {
      this.publish({
        ...this.snapshot,
        error: receiptConsentMessage,
        focus: "error",
      });
      return;
    }
    await this.execute("record");
  };
  private cancel(): void {
    this.requestAbort?.abort();
    this.requestAbort = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  private publish(value: ReceiptSnapshot): void {
    this.snapshot = value;
    this.listeners.forEach((listener) => listener());
  }
  private async execute(
    action: ReceiptRequest["action"],
    manual = true,
  ): Promise<void> {
    if (
      !this.active ||
      !this.confirmed ||
      ["loading", "recording"].includes(this.snapshot.phase)
    )
      return;
    const serial = ++this.serial;
    const abort = new AbortController();
    this.requestAbort = abort;
    const current = () => this.active && this.serial === serial;
    this.publish({
      phase: action === "read" ? "loading" : "recording",
      receipt: null,
      error: null,
      focus: null,
    });
    this.timer = setTimeout(() => {
      if (!current()) return;
      this.serial++;
      this.cancel();
      this.publish({
        phase: "error",
        receipt: null,
        error: messageFrom(null, action),
        focus: manual ? "error" : null,
      });
    }, this.timeoutMs);
    try {
      const raw = await this.gateway.request({
        action,
        accountId: this.accountId,
        pair: this.pair,
        signal: abort.signal,
      });
      if (!current()) return;
      const receipt = parseLegalReceipt(raw, this.pair);
      if (action === "record" && !receipt) throw new Error("Missing receipt");
      this.publish({
        phase: receipt ? "recorded" : "none",
        receipt,
        error: null,
        focus: action === "record" ? "receipt" : null,
      });
    } catch (error) {
      if (current())
        this.publish({
          phase: "error",
          receipt: null,
          error: messageFrom(error, action),
          focus: manual ? "error" : null,
        });
    } finally {
      if (current()) this.cancel();
    }
  }
}
