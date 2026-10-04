import "fake-indexeddb/auto";
import {
  AuthApiError,
  AuthRetryableFetchError,
  type AuthChangeEvent,
  type Session,
  type User,
} from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  database,
  getActiveDatabase,
  getActiveWorkspace,
  initialize,
  selectWorkspace,
} from "../lib/local-database";
import type { Subject } from "../models";
import { createOptionalSupabaseClient } from "../lib/supabase";
import { AuthSessionManager, type AuthGateway } from "./auth-session";

const accountA = "11111111-1111-4111-8111-111111111111";
const accountB = "22222222-2222-4222-8222-222222222222";
const credentialKey = "stride-auth-v1-fotgomkjwbahxmmovzmn.supabase.co";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

function user(id: string): User {
  return {
    id,
    email: `${id}@example.test`,
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
  } as User;
}

function session(id: string): Session {
  return { user: user(id) } as Session;
}

function fakeAuth(initial: Session | null = null) {
  let listener: (
    event: AuthChangeEvent,
    value: Session | null,
  ) => void = () => {};
  const auth: AuthGateway["auth"] = {
    getSession: vi.fn(async () => ({
      data: { session: initial },
      error: null,
    })),
    onAuthStateChange: vi.fn((callback) => {
      listener = callback;
      queueMicrotask(() => callback("INITIAL_SESSION", initial));
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signInWithPassword: vi.fn(async () => ({
      data: { user: user(accountA), session: session(accountA) },
      error: null,
    })),
    signUp: vi.fn(async () => ({
      data: { user: user(accountA), session: null },
      error: null,
    })),
    signOut: vi.fn(async () => ({ error: null })),
  };
  return {
    gateway: { auth } satisfies AuthGateway,
    auth,
    emit: (event: AuthChangeEvent, value: Session | null) =>
      listener(event, value),
  };
}

const managers: AuthSessionManager[] = [];
function manager(
  client: AuthGateway | null,
  key: string | null = null,
  storage?: ReturnType<typeof memoryStorage>,
): AuthSessionManager {
  const instance = new AuthSessionManager(
    client,
    selectWorkspace,
    key,
    storage,
  );
  managers.push(instance);
  instance.start();
  return instance;
}

beforeEach(async () => {
  selectWorkspace(null);
  await database.delete();
  await database.open();
});

afterEach(async () => {
  managers.forEach((instance) => instance.stop());
  managers.length = 0;
  selectWorkspace(null);
  vi.useRealTimers();
  await database.delete();
});

describe("required Supabase configuration", () => {
  it("reports unavailable authentication with missing, malformed, wrong-project, or secret configuration", () => {
    expect(createOptionalSupabaseClient()).toBeNull();
    expect(
      createOptionalSupabaseClient("not a URL", "sb_publishable_test"),
    ).toBeNull();
    expect(
      createOptionalSupabaseClient(
        "https://another-project.supabase.co",
        "sb_publishable_test",
      ),
    ).toBeNull();
    expect(
      createOptionalSupabaseClient(
        "https://fotgomkjwbahxmmovzmn.supabase.co",
        "sb_secret_invalid",
      ),
    ).toBeNull();
    const state = manager(null);
    expect(state.getSnapshot().status).toBe("disabled");
    expect(state.getSnapshot().error).toBe(
      "Authentication is unavailable in this build because Supabase is not configured. Your local data is preserved.",
    );
    expect(getActiveWorkspace().accountId).toBeNull();
  });

  it("rejects account requests when authentication is not configured", async () => {
    const state = manager(null);
    await expect(
      state.signIn("a@example.test", "test-password"),
    ).rejects.toThrow("Authentication is unavailable in this build");
    await expect(
      state.signUp("a@example.test", "test-password"),
    ).rejects.toThrow("Authentication is unavailable in this build");
    expect(state.getSnapshot()).toMatchObject({
      status: "disabled",
      user: null,
    });
    expect(getActiveWorkspace().accountId).toBeNull();
  });
});

describe("auth and local workspace selection", () => {
  it("hides the previous account during bootstrap and selects the restored workspace before publishing its identity", async () => {
    selectWorkspace(accountB);
    const fake = fakeAuth();
    let finishRestore!: (result: {
      data: { session: Session | null };
      error: Error | null;
    }) => void;
    fake.auth.getSession = vi.fn(
      () =>
        new Promise<{
          data: { session: Session | null };
          error: Error | null;
        }>((resolve) => (finishRestore = resolve)),
    );
    fake.auth.onAuthStateChange = vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    }));
    const state = new AuthSessionManager(fake.gateway);
    managers.push(state);
    const observed: { status: string; accountId: string | null }[] = [];
    state.subscribe(() =>
      observed.push({
        status: state.getSnapshot().status,
        accountId: getActiveWorkspace().accountId,
      }),
    );
    state.start();
    expect(state.getSnapshot()).toMatchObject({
      status: "restoring",
      user: null,
    });
    expect(getActiveWorkspace().accountId).toBeNull();

    finishRestore({ data: { session: session(accountA) }, error: null });
    await Promise.resolve();
    expect(observed).toEqual([
      { status: "restoring", accountId: null },
      { status: "signed_in", accountId: accountA },
    ]);
  });

  it("fails a stalled bootstrap closed and ignores its late session result", async () => {
    vi.useFakeTimers();
    const fake = fakeAuth();
    let finishRestore!: (result: {
      data: { session: Session | null };
      error: Error | null;
    }) => void;
    fake.auth.getSession = vi.fn(
      () =>
        new Promise<{
          data: { session: Session | null };
          error: Error | null;
        }>((resolve) => (finishRestore = resolve)),
    );
    fake.auth.onAuthStateChange = vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    }));
    const state = manager(fake.gateway);
    expect(state.getSnapshot().status).toBe("restoring");
    await vi.advanceTimersByTimeAsync(8_000);
    expect(state.getSnapshot()).toMatchObject({
      status: "signed_out",
      user: null,
      error:
        "Unable to restore your account session. Check your connection, then sign in again. Your local data is preserved.",
    });

    finishRestore({ data: { session: session(accountA) }, error: null });
    await Promise.resolve();
    expect(state.getSnapshot().status).toBe("signed_out");
    expect(getActiveWorkspace().accountId).toBeNull();
  });

  it("restores an account before exposing its state and handles token refresh without switching workspaces", async () => {
    const fake = fakeAuth(session(accountA));
    const state = manager(fake.gateway);
    const observed: string[] = [];
    state.subscribe(() => {
      if (state.getSnapshot().status === "signed_in")
        observed.push(getActiveWorkspace().accountId ?? "anonymous");
    });
    expect(state.getSnapshot().status).toBe("restoring");
    await Promise.resolve();
    expect(state.getSnapshot().user?.id).toBe(accountA);
    expect(observed).toEqual([accountA]);
    const generation = getActiveWorkspace().generation;
    fake.emit("TOKEN_REFRESHED", session(accountA));
    expect(getActiveWorkspace().generation).toBe(generation);
  });

  it("signs up without moving anonymous records when email confirmation is required", async () => {
    const fake = fakeAuth();
    const state = manager(fake.gateway);
    await Promise.resolve();
    const result = await state.signUp(
      " student@example.test ",
      "test-password",
    );
    expect(result).toEqual({ needsEmailConfirmation: true });
    expect(fake.auth.signUp).toHaveBeenCalledWith({
      email: "student@example.test",
      password: "test-password",
    });
    expect(state.getSnapshot().status).toBe("signed_out");
    expect(getActiveWorkspace().accountId).toBeNull();
  });

  it("signs in, clears the account immediately on sign-out, then switches to a different account", async () => {
    vi.useFakeTimers();
    const fake = fakeAuth();
    const storage = memoryStorage();
    const state = manager(fake.gateway, credentialKey, storage);
    await Promise.resolve();
    await state.signIn("a@example.test", "test-password");
    expect(getActiveWorkspace().accountId).toBe(accountA);

    let finishSignOut!: (result: { error: Error | null }) => void;
    fake.auth.signOut = vi.fn(
      () =>
        new Promise<{ error: Error | null }>(
          (resolve) => (finishSignOut = resolve),
        ),
    );
    const pending = state.signOut();
    expect(state.getSnapshot()).toMatchObject({
      status: "signed_out",
      pendingAction: "sign_out",
    });
    expect(getActiveWorkspace().accountId).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(
      state.signIn("b@example.test", "test-password"),
    ).rejects.toThrow("An account request is already in progress.");
    await expect(
      state.signUp("b@example.test", "test-password"),
    ).rejects.toThrow("An account request is already in progress.");
    expect(fake.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(fake.auth.signUp).not.toHaveBeenCalled();
    expect(state.getSnapshot().pendingAction).toBe("sign_out");
    expect(state.canReopenSignIn()).toBe(true);
    fake.emit("SIGNED_IN", session(accountA));
    expect(getActiveWorkspace().accountId).toBeNull();
    finishSignOut({ error: null });
    await pending;
    expect(state.getSnapshot().pendingAction).toBeNull();
    expect(state.canReopenSignIn()).toBe(false);
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: "local" });

    fake.auth.signInWithPassword = vi.fn(async () => ({
      data: { user: user(accountB), session: session(accountB) },
      error: null,
    }));
    await state.signIn("b@example.test", "test-password");
    expect(state.getSnapshot().user?.id).toBe(accountB);
    expect(state.getSnapshot().pendingAction).toBeNull();
    expect(getActiveWorkspace().accountId).toBe(accountB);
  });

  it("does not offer sign-out reload recovery when its durable marker could not be saved", async () => {
    const storage = memoryStorage();
    storage.setItem(credentialKey, "opaque-test-session");
    storage.setItem = () => {
      throw new Error("Storage is unavailable");
    };
    const fake = fakeAuth(session(accountA));
    const state = manager(fake.gateway, credentialKey, storage);
    await Promise.resolve();
    let finishSignOut!: (result: { error: Error | null }) => void;
    fake.auth.signOut = vi.fn(
      () =>
        new Promise<{ error: Error | null }>(
          (resolve) => (finishSignOut = resolve),
        ),
    );
    const pending = state.signOut();
    expect(state.getSnapshot().pendingAction).toBe("sign_out");
    expect(state.canReopenSignIn()).toBe(false);
    expect(getActiveWorkspace().accountId).toBeNull();
    expect(storage.getItem(credentialKey)).toBe("opaque-test-session");
    finishSignOut({ error: null });
    await pending;
    expect(state.getSnapshot().pendingAction).toBeNull();
    expect(storage.getItem(credentialKey)).toBeNull();
  });

  it("preserves anonymous history across sign-in and sign-out", async () => {
    const subject: Subject = {
      id: "anonymous-math",
      name: "Math",
      description: "",
      icon: "book",
      color: "#888888",
      created_at: "2026-01-01T00:00:00Z",
      archived: 0,
    };
    await initialize(database, null);
    await database.subjects.put(subject);
    const fake = fakeAuth();
    const state = manager(fake.gateway);
    await Promise.resolve();
    await state.signIn("a@example.test", "test-password");
    const accountDatabase = getActiveDatabase();
    await initialize(accountDatabase, null);
    expect(await accountDatabase.subjects.get(subject.id)).toBeUndefined();
    await state.signOut();
    expect(await getActiveDatabase().subjects.get(subject.id)).toEqual(subject);
    await accountDatabase.delete();
  });

  it("keeps authentication signed out after invalid credentials or a sign-out network error", async () => {
    const fake = fakeAuth();
    const state = manager(fake.gateway);
    await Promise.resolve();
    fake.auth.signInWithPassword = vi.fn(async () => ({
      data: { user: null, session: null },
      error: new Error("Invalid login credentials"),
    }));
    await expect(state.signIn("bad@example.test", "bad")).rejects.toThrow(
      "Invalid login credentials",
    );
    expect(state.getSnapshot().error).toBe("Invalid login credentials");
    expect(getActiveWorkspace().accountId).toBeNull();
    state.clearError();
    expect(state.getSnapshot().error).toBeNull();

    fake.emit("SIGNED_IN", session(accountA));
    expect(getActiveWorkspace().accountId).toBe(accountA);
    fake.auth.signOut = vi.fn(async () => ({
      error: new Error("Network unavailable"),
    }));
    await expect(state.signOut()).rejects.toThrow("Network unavailable");
    fake.emit("TOKEN_REFRESHED", session(accountA));
    expect(state.getSnapshot()).toMatchObject({
      status: "signed_out",
      user: null,
      error: "Network unavailable",
    });
    expect(getActiveWorkspace().accountId).toBeNull();
  });

  it.each([
    new TypeError("Failed to fetch"),
    new AuthRetryableFetchError("Service temporarily unavailable", 503),
  ])(
    "gives a connection retry message for sign-in and sign-up transport failures: %s",
    async (failure) => {
      const fake = fakeAuth();
      const state = manager(fake.gateway);
      await Promise.resolve();
      fake.auth.signInWithPassword = vi.fn(async () => ({
        data: { user: null, session: null },
        error: failure,
      }));
      fake.auth.signUp = vi.fn(async () => ({
        data: { user: null, session: null },
        error: failure,
      }));
      const message =
        "Unable to connect to your account. Check your connection and try again.";
      await expect(
        state.signIn("a@example.test", "test-password"),
      ).rejects.toThrow(message);
      expect(state.getSnapshot()).toMatchObject({
        status: "signed_out",
        user: null,
        error: message,
      });
      await expect(
        state.signUp("a@example.test", "test-password"),
      ).rejects.toThrow(message);
      expect(state.getSnapshot()).toMatchObject({
        status: "signed_out",
        user: null,
        error: message,
      });
      expect(getActiveWorkspace().accountId).toBeNull();
    },
  );

  it("keeps a failed transport logout signed out while showing a retry message", async () => {
    const fake = fakeAuth(session(accountA));
    const state = manager(fake.gateway);
    await Promise.resolve();
    fake.auth.signOut = vi.fn(async () => ({
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    }));
    const pending = state.signOut();
    expect(state.getSnapshot().status).toBe("signed_out");
    expect(getActiveWorkspace().accountId).toBeNull();
    await expect(pending).rejects.toThrow(
      "Check your connection and try again.",
    );
    fake.emit("TOKEN_REFRESHED", session(accountA));
    expect(state.getSnapshot()).toMatchObject({
      status: "signed_out",
      user: null,
      error:
        "Unable to connect to your account. Check your connection and try again.",
    });
    expect(getActiveWorkspace().accountId).toBeNull();
  });

  it("preserves the official email-confirmation error rather than reporting it as a network failure", async () => {
    const fake = fakeAuth();
    const state = manager(fake.gateway);
    await Promise.resolve();
    fake.auth.signInWithPassword = vi.fn(async () => ({
      data: { user: null, session: null },
      error: new AuthApiError(
        "Email not confirmed",
        400,
        "email_not_confirmed",
      ),
    }));
    await expect(
      state.signIn("a@example.test", "test-password"),
    ).rejects.toThrow("Email not confirmed");
    expect(state.getSnapshot()).toMatchObject({
      status: "signed_out",
      user: null,
      error: "Email not confirmed",
    });
    expect(getActiveWorkspace().accountId).toBeNull();
  });

  it("ignores a stale initial session after a newer sign-in event", async () => {
    const fake = fakeAuth(session(accountA));
    fake.auth.getSession = vi.fn(
      () =>
        new Promise<{
          data: { session: Session | null };
          error: Error | null;
        }>(() => {}),
    );
    fake.auth.onAuthStateChange = vi.fn((callback) => {
      queueMicrotask(() => callback("SIGNED_IN", session(accountB)));
      queueMicrotask(() => callback("INITIAL_SESSION", session(accountA)));
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    const state = manager(fake.gateway);
    await Promise.resolve();
    expect(state.getSnapshot().user?.id).toBe(accountB);
    expect(getActiveWorkspace().accountId).toBe(accountB);
  });

  it("fails session restoration closed and ignores a stale sign-in result after unmount", async () => {
    const fake = fakeAuth();
    fake.auth.onAuthStateChange = vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    }));
    fake.auth.getSession = vi.fn(async () => ({
      data: { session: null },
      error: new Error("Network unavailable"),
    }));
    const state = manager(fake.gateway);
    await Promise.resolve();
    expect(state.getSnapshot()).toMatchObject({
      status: "signed_out",
      user: null,
      error:
        "Unable to restore your account session. Check your connection, then sign in again. Your local data is preserved.",
    });
    expect(getActiveWorkspace().accountId).toBeNull();

    let finishSignIn!: (result: {
      data: { user: User | null; session: Session | null };
      error: Error | null;
    }) => void;
    fake.auth.signInWithPassword = vi.fn(
      () =>
        new Promise<{
          data: { user: User | null; session: Session | null };
          error: Error | null;
        }>((resolve) => (finishSignIn = resolve)),
    );
    const pending = state.signIn("a@example.test", "test-password");
    state.stop();
    expect(getActiveWorkspace().accountId).toBeNull();
    finishSignIn({
      data: { user: user(accountA), session: session(accountA) },
      error: null,
    });
    await pending;
    expect(getActiveWorkspace().accountId).toBeNull();
  });

  it("keeps a failed sign-out signed out after reload even if a late refresh restores the saved session", async () => {
    const storage = memoryStorage();
    storage.setItem(credentialKey, "opaque-test-session");
    const fake = fakeAuth(session(accountA));
    const first = manager(fake.gateway, credentialKey, storage);
    await Promise.resolve();
    expect(first.getSnapshot().status).toBe("signed_in");
    fake.auth.signOut = vi.fn(async () => {
      // The SDK must still be able to read its session for server logout.
      expect(storage.getItem(credentialKey)).toBe("opaque-test-session");
      return { error: new Error("Offline during sign-out") };
    });

    const pending = first.signOut();
    expect(getActiveWorkspace().accountId).toBeNull();
    expect(storage.values.has(credentialKey)).toBe(true);
    expect(storage.getItem(`${credentialKey}:signed-out`)).toBe("1");
    await expect(pending).rejects.toThrow("Offline during sign-out");
    expect(storage.values.has(credentialKey)).toBe(false);

    // Model an SDK refresh that writes its old in-memory session afterward.
    storage.setItem(credentialKey, "late-sdk-write");
    first.stop();
    const sessionReads = vi.mocked(fake.auth.getSession).mock.calls.length;
    const reloaded = manager(fake.gateway, credentialKey, storage);
    await Promise.resolve();
    expect(reloaded.getSnapshot().status).toBe("signed_out");
    expect(getActiveWorkspace().accountId).toBeNull();
    expect(fake.auth.getSession).toHaveBeenCalledTimes(sessionReads);
    fake.emit("TOKEN_REFRESHED", session(accountA));
    expect(getActiveWorkspace().accountId).toBeNull();

    await reloaded.signIn("a@example.test", "test-password");
    expect(storage.getItem(`${credentialKey}:signed-out`)).toBeNull();
    expect(getActiveWorkspace().accountId).toBe(accountA);
    reloaded.stop();
    const restored = manager(fake.gateway, credentialKey, storage);
    await Promise.resolve();
    expect(restored.getSnapshot().user?.id).toBe(accountA);
  });

  it("blocks a stale token refresh after an external signed-out event", async () => {
    const storage = memoryStorage();
    const fake = fakeAuth(session(accountA));
    const state = manager(fake.gateway, credentialKey, storage);
    await Promise.resolve();
    expect(getActiveWorkspace().accountId).toBe(accountA);
    fake.emit("SIGNED_OUT", null);
    fake.emit("TOKEN_REFRESHED", session(accountA));
    expect(state.getSnapshot().status).toBe("signed_out");
    expect(getActiveWorkspace().accountId).toBeNull();
    expect(storage.getItem(`${credentialKey}:signed-out`)).toBe("1");
  });
});
