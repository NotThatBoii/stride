import "fake-indexeddb/auto";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
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
  await database.delete();
  vi.useRealTimers();
});

describe("optional Supabase configuration", () => {
  it("keeps local anonymous use available with missing, malformed, wrong-project, or secret configuration", () => {
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
    expect(getActiveWorkspace().accountId).toBeNull();
  });
});

describe("auth and local workspace selection", () => {
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

  it("signs in, signs out to anonymous immediately, then switches to a different account", async () => {
    const fake = fakeAuth();
    const state = manager(fake.gateway);
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
    expect(state.getSnapshot().status).toBe("signed_out");
    expect(getActiveWorkspace().accountId).toBeNull();
    fake.emit("SIGNED_IN", session(accountA));
    expect(getActiveWorkspace().accountId).toBeNull();
    finishSignOut({ error: null });
    await pending;
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: "local" });

    fake.auth.signInWithPassword = vi.fn(async () => ({
      data: { user: user(accountB), session: session(accountB) },
      error: null,
    }));
    await state.signIn("b@example.test", "test-password");
    expect(state.getSnapshot().user?.id).toBe(accountB);
    expect(getActiveWorkspace().accountId).toBe(accountB);
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

  it("keeps the anonymous workspace after invalid credentials or a sign-out network error", async () => {
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

  it("opens anonymous data when session restoration fails and ignores a stale sign-in result after unmount", async () => {
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
      error: "Cloud sign-in is unavailable. Your local data is safe.",
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

  it("keeps a failed sign-out anonymous after reload even if a late refresh restores the saved session", async () => {
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
