import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LegalReceiptController,
  createReceiptGateway,
  currentLegalPair,
  parseLegalReceipt,
  receiptConsentMessage,
  receiptUnavailableMessage,
  type ReceiptGateway,
} from "./legal-receipt";
const pair = currentLegalPair();
const receipt = {
  terms_version: pair.termsVersion,
  privacy_version: pair.privacyVersion,
  accepted_at: "2026-10-07T02:15:00.123456+00:00",
};
const acceptance = { accepted: true, ...pair };
const controllers: LegalReceiptController[] = [];
function controller(
  gateway: ReceiptGateway,
  account = "account-a",
  confirmed = true,
  timeout = 10000,
) {
  const value = new LegalReceiptController(
    gateway,
    account,
    pair,
    confirmed,
    timeout,
  );
  controllers.push(value);
  value.start();
  return value;
}
afterEach(() => {
  controllers.splice(0).forEach((value) => value.stop());
  vi.useRealTimers();
});

describe("optional server receipt", () => {
  it("accepts only the exact ownerless current-version receipt with a valid server timestamp", () => {
    expect(parseLegalReceipt(null, pair)).toBeNull();
    expect(parseLegalReceipt(receipt, pair)).toEqual(receipt);
    for (const value of [
      undefined,
      [],
      { ...receipt, owner_id: "foreign" },
      { ...receipt, terms_version: "old" },
      { ...receipt, privacy_version: "old" },
      { ...receipt, accepted_at: "2026-02-31T00:00:00Z" },
    ])
      expect(() => parseLegalReceipt(value, pair)).toThrow("Invalid receipt");
  });
  it("opening is read-only and only strict explicit current-version consent can record once", async () => {
    const request = vi.fn(async ({ action }) =>
      action === "read" ? null : receipt,
    );
    const value = controller({ request });
    await vi.waitFor(() => expect(value.getSnapshot().phase).toBe("none"));
    expect(request).toHaveBeenCalledTimes(1);
    for (const invalid of [
      undefined,
      true,
      { ...acceptance, accepted: "true" },
      { ...acceptance, accepted: false },
      { ...acceptance, termsVersion: "old" },
      { ...acceptance, privacyVersion: "old" },
    ])
      await value.record(invalid);
    expect(value.getSnapshot().error).toBe(receiptConsentMessage);
    expect(request).toHaveBeenCalledTimes(1);
    await Promise.all([value.record(acceptance), value.record(acceptance)]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(value.getSnapshot()).toMatchObject({ phase: "recorded", receipt });
  });
  it("unconfirmed accounts neither read nor record while their controller stays nonblocking", async () => {
    const request = vi.fn(async () => receipt);
    const value = controller({ request }, "account-a", false);
    await value.record(acceptance);
    await value.load();
    expect(request).not.toHaveBeenCalled();
    expect(value.getSnapshot()).toMatchObject({
      phase: "unconfirmed",
      receipt: null,
    });
  });
  it("a failed or malformed record exposes fixed guidance and requires a status read before another write", async () => {
    let response: unknown = null;
    const request = vi.fn(async ({ action }) => {
      if (action === "read") return response;
      throw new Error(
        "private-password Bearer private-token refresh_token=private-refresh",
      );
    });
    const value = controller({ request });
    await vi.waitFor(() => expect(value.getSnapshot().phase).toBe("none"));
    await value.record(acceptance);
    expect(value.getSnapshot().error).toContain(
      "Check its status before trying again",
    );
    expect(JSON.stringify(value.getSnapshot())).not.toContain("private-");
    await value.record(acceptance);
    expect(
      request.mock.calls.filter(([input]) => input.action === "record"),
    ).toHaveLength(1);
    response = receipt;
    await value.load();
    expect(value.getSnapshot().receipt).toEqual(receipt);
  });
  it("ignores an old account's late read and record results after cancellation", async () => {
    let resolveRead!: (value: unknown) => void;
    let resolveWrite!: (value: unknown) => void;
    const old = controller({
      request: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveRead = resolve;
          }),
      ),
    });
    const readSignal = (old as any).requestAbort.signal as AbortSignal;
    old.stop();
    resolveRead(receipt);
    await Promise.resolve();
    expect(readSignal.aborted).toBe(true);
    expect(old.getSnapshot().receipt).toBeNull();
    const writing = controller({
      request: async ({ action }) =>
        action === "read"
          ? null
          : new Promise((resolve) => {
              resolveWrite = resolve;
            }),
    });
    await vi.waitFor(() => expect(writing.getSnapshot().phase).toBe("none"));
    const pending = writing.record(acceptance);
    writing.stop();
    const next = controller({ request: async () => null }, "account-b");
    resolveWrite(receipt);
    await pending;
    await vi.waitFor(() => expect(next.getSnapshot().phase).toBe("none"));
    expect(writing.getSnapshot().receipt).toBeNull();
    expect(next.getSnapshot().receipt).toBeNull();
  });
  it("bounds a held request and permits a status retry while ignoring its late reply", async () => {
    vi.useFakeTimers();
    let release!: (value: unknown) => void;
    let signal!: AbortSignal;
    const value = controller(
      {
        request: async (input) => {
          signal = input.signal;
          return new Promise((resolve) => {
            release = resolve;
          });
        },
      },
      "account-a",
      true,
      100,
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(signal.aborted).toBe(true);
    expect(value.getSnapshot().phase).toBe("error");
    release(receipt);
    await Promise.resolve();
    expect(value.getSnapshot().receipt).toBeNull();
  });
  it("uses only version args and a pinned official SDK session, and sanitizes missing/version-mismatched services", async () => {
    const headers: Record<string, string> = {};
    let rpcError: { code: string; message: string } | null = null;
    const session = {
      user: { id: "account-a", email_confirmed_at: "2026-10-07T00:00:00Z" },
      access_token: "negative-fixture-sdk-session",
    };
    const rpc = vi.fn(() => ({
      setHeader(name: string, value: string) {
        headers[name] = value;
        return this;
      },
      abortSignal: async () => ({ data: receipt, error: rpcError }),
    }));
    const client = {
      auth: {
        getSession: vi.fn(async () => ({ data: { session }, error: null })),
      },
      rpc,
    } as unknown as SupabaseClient;
    const gateway = createReceiptGateway(client);
    await gateway.request({
      accountId: "account-a",
      pair,
      action: "record",
      signal: new AbortController().signal,
    });
    expect(rpc).toHaveBeenCalledWith("record_legal_acceptance", {
      p_terms_version: pair.termsVersion,
      p_privacy_version: pair.privacyVersion,
    });
    expect(headers.Authorization).toBe("Bearer negative-fixture-sdk-session");
    await expect(
      gateway.request({
        accountId: "account-b",
        pair,
        action: "record",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("session");
    expect(rpc).toHaveBeenCalledTimes(1);
    rpcError = { code: "PGRST202", message: "private-service-diagnostic" };
    const unavailable = controller(gateway);
    await vi.waitFor(() =>
      expect(unavailable.getSnapshot().phase).toBe("error"),
    );
    expect(unavailable.getSnapshot().error).toBe(receiptUnavailableMessage);
    rpcError = { code: "22023", message: "private-version-diagnostic" };
    await unavailable.load();
    expect(unavailable.getSnapshot().error).toContain("document versions");
    expect(JSON.stringify(unavailable.getSnapshot())).not.toContain("private-");
  });
});
