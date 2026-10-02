import { useEffect, useId, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useStride } from "../state";
import {
  database,
  getActiveDatabase,
  getActiveWorkspace,
  initialize,
  readData,
} from "../lib/storage";

type Mode = "sign_in" | "sign_up";

export function AccountPanel() {
  const { status, user, error, signIn, signUp, signOut, clearError } =
    useAuth();
  const { data } = useStride();
  const headingId = useId();
  const [mode, setMode] = useState<Mode>("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState("");
  const [notice, setNotice] = useState("");

  function changeMode(next: Mode) {
    setMode(next);
    setPassword("");
    setLocalError("");
    setNotice("");
    clearError();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setLocalError("");
    setNotice("");
    clearError();
    try {
      if (mode === "sign_in") {
        await signIn(email.trim(), password);
      } else {
        const result = await signUp(email.trim(), password);
        if (result.needsEmailConfirmation)
          setNotice("Check your email to confirm your account, then sign in.");
      }
      setPassword("");
    } catch (cause) {
      setLocalError(
        cause instanceof Error
          ? cause.message
          : "Account request failed. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  async function leaveAccount() {
    if (pending) return;
    setPending(true);
    setLocalError("");
    clearError();
    try {
      await signOut();
      setPassword("");
      setNotice("");
    } catch (cause) {
      setLocalError(
        cause instanceof Error
          ? cause.message
          : "Could not sign out. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="account-panel" aria-labelledby={headingId}>
      <div className="account-panel-heading">
        <div>
          <h2 id={headingId}>Account</h2>
          <p>
            {status === "signed_in"
              ? "Your study data is kept in this account’s local workspace. Cloud study sync is not active yet."
              : "An account is optional. Stride stays available for local study."}
          </p>
        </div>
        <span className="account-status">
          {status === "signed_in"
            ? "Signed in"
            : status === "restoring"
              ? "Checking"
              : "Local mode"}
        </span>
      </div>

      {data.running?.runningSince != null && (
        <p className="hint account-message">
          Your active timer will keep counting in this workspace if you switch
          accounts. Pause it first if you do not want that time recorded.
        </p>
      )}

      {status === "disabled" ? (
        <p className="hint account-message">
          Account access is unavailable in this build. Your local workspace is
          ready to use.
        </p>
      ) : status === "restoring" ? (
        <p className="hint account-message" role="status">
          Checking your account session…
        </p>
      ) : status === "signed_in" ? (
        <div className="account-identity">
          <div>
            <span className="eyebrow">CURRENT ACCOUNT</span>
            <strong>{user?.email ?? "Signed-in account"}</strong>
          </div>
          <button
            type="button"
            className="secondary"
            disabled={pending}
            onClick={() => void leaveAccount()}
          >
            {pending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : (
        <>
          <div
            className="account-tabs"
            role="group"
            aria-label="Account action"
          >
            <button
              type="button"
              className={
                mode === "sign_in" ? "account-tab active" : "account-tab"
              }
              aria-pressed={mode === "sign_in"}
              disabled={pending}
              onClick={() => changeMode("sign_in")}
            >
              Sign in
            </button>
            <button
              type="button"
              className={
                mode === "sign_up" ? "account-tab active" : "account-tab"
              }
              aria-pressed={mode === "sign_up"}
              disabled={pending}
              onClick={() => changeMode("sign_up")}
            >
              Create account
            </button>
          </div>
          <form
            className="account-form"
            onSubmit={(event) => void submit(event)}
          >
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                required
                maxLength={320}
                value={email}
                disabled={pending}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete={
                  mode === "sign_in" ? "current-password" : "new-password"
                }
                required
                minLength={mode === "sign_up" ? 6 : undefined}
                value={password}
                disabled={pending}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button disabled={pending}>
              {pending
                ? mode === "sign_in"
                  ? "Signing in…"
                  : "Creating account…"
                : mode === "sign_in"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </form>
        </>
      )}
      {(localError || error) && (
        <p className="error account-message" role="alert">
          {localError || String(error)}
        </p>
      )}
      {notice && (
        <p className="account-message" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}

interface AnonymousSummary {
  subjects: number;
  sessions: number;
  running: boolean;
}

export function AnonymousHistoryDecision() {
  const { status, user } = useAuth();
  const [summary, setSummary] = useState<AnonymousSummary | null>(null);
  const [checkError, setCheckError] = useState(false);
  const [decisionError, setDecisionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [choice, setChoice] = useState<"none" | "keep" | "prepare" | "done">(
    "none",
  );

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setCheckError(false);
    setDecisionError("");
    setChoice("none");
    if (status === "signed_in" && user?.id) {
      const accountDb = getActiveDatabase();
      if (accountDb.accountId !== user.id.toLowerCase()) {
        setCheckError(true);
        return () => {
          cancelled = true;
        };
      }
      void Promise.all([
        initialize(database).then(() => readData(database)),
        accountDb.syncMetadata.get("anonymous_history_decision"),
      ])
        .then(([data, decision]) => {
          if (cancelled) return;
          if (decision?.value === "keep" || decision?.value === "prepare") {
            setChoice("done");
            return;
          }
          if (
            data.subjects.length ||
            data.sessions.length ||
            data.slices.length ||
            data.running
          )
            setSummary({
              subjects: data.subjects.length,
              sessions: data.sessions.length,
              running: data.running !== null,
            });
        })
        .catch(() => {
          if (!cancelled) setCheckError(true);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [status, user?.id]);

  async function recordChoice(value: "keep" | "prepare") {
    if (!user?.id || saving) return;
    setSaving(true);
    setDecisionError("");
    try {
      const accountDb = getActiveDatabase();
      if (accountDb.accountId !== user.id.toLowerCase())
        throw new Error("The account workspace changed. Try again.");
      await accountDb.syncMetadata.put({
        key: "anonymous_history_decision",
        value,
      });
      if (getActiveWorkspace().accountId === accountDb.accountId)
        setChoice(value);
    } catch {
      setDecisionError(
        "We couldn't save that choice locally. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (status !== "signed_in" || choice === "keep" || choice === "done")
    return null;

  if (checkError)
    return (
      <section className="anonymous-history-decision" role="status">
        <span>
          We couldn’t check the anonymous history on this device. No study data
          was changed.
        </span>
        <button
          type="button"
          className="secondary"
          onClick={() => setCheckError(false)}
        >
          Dismiss
        </button>
      </section>
    );

  if (!summary) return null;

  return (
    <section
      className="anonymous-history-decision"
      aria-labelledby="anonymous-history-heading"
    >
      <div>
        <h2 id="anonymous-history-heading">Anonymous history on this device</h2>
        {choice === "prepare" ? (
          <p>
            Importing anonymous history is planned for Phase 5. Nothing has been
            copied or uploaded. To prepare, sign out and export that workspace
            as a JSON backup; keep it until import is available.
          </p>
        ) : (
          <p>
            This device has {summary.subjects} local subject
            {summary.subjects === 1 ? "" : "s"} and {summary.sessions} saved
            session{summary.sessions === 1 ? "" : "s"}
            {summary.running ? ", plus an active local timer" : ""}. They remain
            in the anonymous workspace and are available when you sign out. Your
            account workspace is separate.
          </p>
        )}
      </div>
      <div className="anonymous-history-actions">
        {choice === "prepare" ? (
          <button
            type="button"
            className="secondary"
            onClick={() => setChoice("done")}
          >
            Got it
          </button>
        ) : (
          <>
            <button
              type="button"
              className="secondary"
              disabled={saving}
              onClick={() => void recordChoice("keep")}
            >
              Keep separate
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void recordChoice("prepare")}
            >
              Prepare import
            </button>
          </>
        )}
      </div>
      {decisionError && (
        <p className="error" role="alert">
          {decisionError}
        </p>
      )}
    </section>
  );
}
