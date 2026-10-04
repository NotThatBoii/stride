import {
  isAuthRetryableFetchError,
  type AuthChangeEvent,
  type Session,
  type User,
} from "@supabase/supabase-js";
import { selectWorkspace } from "../lib/local-database";

export type AuthStatus = "disabled" | "restoring" | "signed_out" | "signed_in";
export type AuthAction = "sign_in" | "sign_up" | "sign_out";

export interface AuthSnapshot {
  status: AuthStatus;
  user: User | null;
  error: string | null;
  pendingAction: AuthAction | null;
}

// Keeping this small interface makes the session and workspace transition
// testable without creating users or writing records to the hosted project.
export interface AuthGateway {
  auth: {
    getSession(): Promise<{
      data: { session: Session | null };
      error: Error | null;
    }>;
    onAuthStateChange(
      callback: (event: AuthChangeEvent, session: Session | null) => void,
    ): { data: { subscription: { unsubscribe(): void } } };
    signInWithPassword(credentials: {
      email: string;
      password: string;
    }): Promise<{
      data: { user: User | null; session: Session | null };
      error: Error | null;
    }>;
    signUp(credentials: { email: string; password: string }): Promise<{
      data: { user: User | null; session: Session | null };
      error: Error | null;
    }>;
    signOut(options: { scope: "local" }): Promise<{ error: Error | null }>;
  };
}

const restorationTimeoutMs = 8_000;
const unavailableMessage =
  "Unable to restore your account session. Check your connection, then sign in again. Your local data is preserved.";
const configurationMessage =
  "Authentication is unavailable in this build because Supabase is not configured. Your local data is preserved.";

interface MarkerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): MarkerStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function messageFrom(error: unknown): string {
  if (
    isAuthRetryableFetchError(error) ||
    (error instanceof Error &&
      /^(failed to fetch|fetch failed|networkerror when attempting to fetch resource\.?|load failed)$/i.test(
        error.message,
      ))
  )
    return "Unable to connect to your account. Check your connection and try again.";
  return error instanceof Error && error.message
    ? error.message
    : "Authentication failed. Please try again.";
}

export class AuthSessionManager {
  private snapshot: AuthSnapshot;
  private listeners = new Set<() => void>();
  private subscription: { unsubscribe(): void } | null = null;
  private active = false;
  private lifecycle = 0;
  private initialSettled = false;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private operation: AuthAction | null = null;
  private operationSerial = 0;
  private interruptedBySignOut = false;
  private signedOutBarrier = false;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): AuthSnapshot => this.snapshot;

  constructor(
    private readonly client: AuthGateway | null,
    private readonly switchWorkspace: (
      accountId: string | null,
    ) => void = selectWorkspace,
    private readonly credentialStorageKey: string | null = null,
    private readonly storage: MarkerStorage | null = browserStorage(),
  ) {
    this.snapshot = {
      // Keep account UI hidden until the official client restores a session.
      status: "restoring",
      user: null,
      error: null,
      pendingAction: null,
    };
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    const lifecycle = ++this.lifecycle;
    this.initialSettled = false;
    this.signedOutBarrier = this.hasSignedOutMarker();
    this.publish({
      status: this.client
        ? this.signedOutBarrier
          ? "signed_out"
          : "restoring"
        : "disabled",
      user: null,
      error: this.client ? null : configurationMessage,
    });
    if (!this.client) return;

    if (this.signedOutBarrier) {
      this.settleInitial();
    } else {
      this.initialTimer = setTimeout(() => {
        if (!this.isCurrent(lifecycle) || this.initialSettled) return;
        this.settleInitial();
        this.signedOutBarrier = true;
        this.publish({
          status: "signed_out",
          user: null,
          error: unavailableMessage,
        });
      }, restorationTimeoutMs);
    }

    try {
      this.subscription = this.client.auth.onAuthStateChange(
        (event, session) => {
          if (!this.isCurrent(lifecycle)) return;
          if (event === "INITIAL_SESSION") {
            if (this.initialSettled) return;
            this.settleInitial();
          } else if (!this.initialSettled) {
            this.settleInitial();
          }
          if (event === "SIGNED_OUT") {
            this.markSignedOut();
            // The SDK has already completed its sign-out path when it emits
            // this event. Clear any credential it left behind.
            this.purgeSavedCredential();
            if (this.operation) this.interruptedBySignOut = true;
            this.setUser(null);
          } else if (this.operation) {
            return;
          } else if (session?.user && !this.signedOutBarrier) {
            this.setUser(session.user);
          } else if (event === "INITIAL_SESSION") {
            this.setUser(null);
          }
        },
      ).data.subscription;

      // A previous explicit sign-out remains authoritative across reloads,
      // even when the SDK still holds an old in-memory session.
      if (this.signedOutBarrier) return;

      void this.client.auth
        .getSession()
        .then(({ data, error }) => {
          if (!this.isCurrent(lifecycle) || this.initialSettled) return;
          this.settleInitial();
          if (this.operation) return;
          if (error) {
            this.signedOutBarrier = true;
            this.publish({
              status: "signed_out",
              user: null,
              error: unavailableMessage,
            });
          } else {
            this.setUser(data.session?.user ?? null);
          }
        })
        .catch(() => {
          if (!this.isCurrent(lifecycle) || this.initialSettled) return;
          this.settleInitial();
          this.signedOutBarrier = true;
          this.publish({
            status: "signed_out",
            user: null,
            error: unavailableMessage,
          });
        });
    } catch {
      if (!this.isCurrent(lifecycle)) return;
      this.settleInitial();
      this.signedOutBarrier = true;
      this.publish({
        status: "signed_out",
        user: null,
        error: unavailableMessage,
      });
    }
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    ++this.lifecycle;
    this.settleInitial();
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.operation = null;
    this.interruptedBySignOut = false;
    ++this.operationSerial;
    this.publish({ status: "restoring", user: null, error: null });
  }

  readonly signIn = async (email: string, password: string): Promise<void> => {
    const client = this.requireClient();
    const previous = this.snapshot;
    const operation = this.beginOperation("sign_in");
    const lifecycle = this.lifecycle;
    this.publish({ status: "signed_out", user: null, error: null });
    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (!this.isCurrentOperation(lifecycle, operation)) return;
      if (this.interruptedBySignOut)
        throw new Error("Sign-in was interrupted by sign-out.");
      if (error) throw error;
      if (!data.session?.user)
        throw new Error("Sign-in did not establish a session.");
      if (!this.clearSignedOutMarker())
        throw new Error("Unable to save this account session on this device.");
      this.signedOutBarrier = false;
      this.setUser(data.session.user);
    } catch (error) {
      if (this.isCurrentOperation(lifecycle, operation))
        this.publish({
          ...(this.interruptedBySignOut
            ? { status: "signed_out" as const, user: null }
            : previous),
          error: messageFrom(error),
        });
      throw new Error(messageFrom(error));
    } finally {
      this.finishOperation(lifecycle, operation);
    }
  };

  readonly signUp = async (
    email: string,
    password: string,
  ): Promise<{ needsEmailConfirmation: boolean }> => {
    const client = this.requireClient();
    if (this.snapshot.status === "signed_in")
      throw new Error("Sign out before creating another account.");
    const operation = this.beginOperation("sign_up");
    const lifecycle = this.lifecycle;
    this.publish({ status: "signed_out", user: null, error: null });
    try {
      const { data, error } = await client.auth.signUp({
        email: email.trim(),
        password,
      });
      if (!this.isCurrentOperation(lifecycle, operation))
        throw new Error("Account request was interrupted.");
      if (this.interruptedBySignOut)
        throw new Error("Account creation was interrupted by sign-out.");
      if (error) throw error;
      if (data.session?.user) {
        if (!this.clearSignedOutMarker())
          throw new Error(
            "Unable to save this account session on this device.",
          );
        this.signedOutBarrier = false;
        this.setUser(data.session.user);
        return { needsEmailConfirmation: false };
      }
      this.setUser(null);
      return { needsEmailConfirmation: true };
    } catch (error) {
      if (this.isCurrentOperation(lifecycle, operation))
        this.publish({
          status: "signed_out",
          user: null,
          error: messageFrom(error),
        });
      throw new Error(messageFrom(error));
    } finally {
      this.finishOperation(lifecycle, operation);
    }
  };

  readonly signOut = async (): Promise<void> => {
    const client = this.requireClient();
    const operation = this.beginOperation("sign_out");
    const lifecycle = this.lifecycle;
    // This must happen before the first await, including when offline.
    this.markSignedOut();
    this.setUser(null);
    try {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (!this.isCurrentOperation(lifecycle, operation)) return;
      if (error) throw error;
    } catch (error) {
      // A failed revoke must never bring cached account data back into view.
      if (this.isCurrentOperation(lifecycle, operation))
        this.publish({
          status: "signed_out",
          user: null,
          error: messageFrom(error),
        });
      throw new Error(messageFrom(error));
    } finally {
      // Keep the credential available while auth-js attempts server logout.
      // Purge afterward, including when auth-js returns early on a refresh
      // error. A newer explicit sign-in clears the marker, so an old request
      // cannot purge the newer session after this manager has stopped.
      if (
        this.isCurrentOperation(lifecycle, operation) ||
        this.hasSignedOutMarker()
      )
        this.purgeSavedCredential();
      this.finishOperation(lifecycle, operation);
    }
  };

  readonly clearError = (): void => {
    if (this.snapshot.error) this.publish({ ...this.snapshot, error: null });
  };

  readonly canReopenSignIn = (): boolean =>
    this.active && this.operation === "sign_out" && this.hasSignedOutMarker();

  private requireClient(): AuthGateway {
    if (this.client) return this.client;
    const error = new Error(configurationMessage);
    this.publish({ status: "disabled", user: null, error: error.message });
    throw error;
  }

  private beginOperation(action: AuthAction): number {
    if (!this.active) throw new Error("Authentication is still opening.");
    if (this.operation)
      throw new Error("An account request is already in progress.");
    this.operation = action;
    this.interruptedBySignOut = false;
    if (!this.initialSettled) this.settleInitial();
    return ++this.operationSerial;
  }

  private finishOperation(lifecycle: number, operation: number): void {
    if (!this.isCurrentOperation(lifecycle, operation)) return;
    this.operation = null;
    this.publish(this.snapshot);
  }

  private isCurrent(lifecycle: number): boolean {
    return this.active && this.lifecycle === lifecycle;
  }

  private isCurrentOperation(lifecycle: number, operation: number): boolean {
    return this.isCurrent(lifecycle) && this.operationSerial === operation;
  }

  private settleInitial(): void {
    this.initialSettled = true;
    if (this.initialTimer) clearTimeout(this.initialTimer);
    this.initialTimer = null;
  }

  private get markerKey(): string | null {
    return this.credentialStorageKey
      ? `${this.credentialStorageKey}:signed-out`
      : null;
  }

  private hasSignedOutMarker(): boolean {
    const key = this.markerKey;
    if (!key || !this.storage) return false;
    try {
      return this.storage.getItem(key) === "1";
    } catch {
      return false;
    }
  }

  private markSignedOut(): void {
    this.signedOutBarrier = true;
    const key = this.markerKey;
    if (!key || !this.storage || !this.credentialStorageKey) return;
    try {
      this.storage.setItem(key, "1");
    } catch {
      // The in-memory barrier still protects this page.
    }
  }

  private purgeSavedCredential(): void {
    if (!this.storage || !this.credentialStorageKey) return;
    try {
      // Never read or log the credential. A late SDK refresh may rewrite it,
      // so the durable marker remains the final authority on next startup.
      this.storage.removeItem(this.credentialStorageKey);
    } catch {
      // The in-memory barrier still protects this page.
    }
  }

  private clearSignedOutMarker(): boolean {
    const key = this.markerKey;
    if (!key || !this.storage) return true;
    try {
      this.storage.removeItem(key);
      return !this.hasSignedOutMarker();
    } catch {
      return false;
    }
  }

  private setUser(user: User | null): void {
    this.publish({
      status: user ? "signed_in" : "signed_out",
      user,
      error: null,
    });
  }

  private publish(next: Omit<AuthSnapshot, "pendingAction">): void {
    try {
      this.switchWorkspace(
        next.status === "signed_in" ? (next.user?.id ?? null) : null,
      );
      this.snapshot = { ...next, pendingAction: this.operation };
    } catch {
      this.switchWorkspace(null);
      this.snapshot = {
        status: "signed_out",
        user: null,
        error: "Unable to open this account's local workspace.",
        pendingAction: this.operation,
      };
    }
    this.listeners.forEach((listener) => listener());
  }
}
