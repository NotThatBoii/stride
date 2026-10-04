import { useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { PwaUpdateNotice } from "./Pwa";

export default function AuthenticationScreen() {
  const { status, error, signIn, signUp, clearError } = useAuth();
  const [mode, setMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState("");
  const [notice, setNotice] = useState("");

  function changeMode(next: typeof mode) {
    setMode(next);
    setPassword("");
    setLocalError("");
    setNotice("");
    clearError();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || status === "disabled") return;
    setPending(true);
    setLocalError("");
    setNotice("");
    clearError();
    try {
      if (mode === "sign_in") {
        await signIn(email.trim(), password);
      } else {
        const result = await signUp(email.trim(), password);
        if (result.needsEmailConfirmation) {
          setMode("sign_in");
          setNotice("Check your email to confirm your account, then sign in.");
        }
      }
    } catch (cause) {
      setLocalError(
        cause instanceof Error
          ? cause.message
          : "Unable to connect. Check your connection and try again.",
      );
    } finally {
      setPassword("");
      setPending(false);
    }
  }

  return (
    <div className="auth-screen">
      <header className="auth-brand">
        <span className="brand-mark">s</span>
        <strong>Stride</strong>
      </header>
      <PwaUpdateNotice busy={pending} />
      <main className="auth-card" aria-labelledby="auth-heading">
        <span className="eyebrow">BUILD YOUR STUDY HABIT</span>
        <h1 id="auth-heading">Welcome to Stride.</h1>
        <p className="auth-intro">A little progress, every day.</p>
        {status === "disabled" ? (
          <div className="auth-configuration">
            <h2>Account access is unavailable</h2>
            <p role="alert">
              {error ||
                "Sign-in is not configured in this build. Contact the app owner or install a configured build to continue. Your saved local data is preserved."}
            </p>
            <p>
              Install a configured build or contact the app owner to continue.
            </p>
            <button className="secondary" onClick={() => location.reload()}>
              Try again
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
                className={`account-tab ${mode === "sign_in" ? "active" : ""}`}
                aria-pressed={mode === "sign_in"}
                disabled={pending}
                onClick={() => changeMode("sign_in")}
              >
                Sign in
              </button>
              <button
                type="button"
                className={`account-tab ${mode === "sign_up" ? "active" : ""}`}
                aria-pressed={mode === "sign_up"}
                disabled={pending}
                onClick={() => changeMode("sign_up")}
              >
                Create account
              </button>
            </div>
            <form
              className="account-form"
              aria-busy={pending}
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
                  aria-describedby={
                    mode === "sign_up" ? "auth-password-hint" : undefined
                  }
                  value={password}
                  disabled={pending}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              {mode === "sign_up" && (
                <small id="auth-password-hint" className="hint">
                  Use at least 6 characters.
                </small>
              )}
              {(localError || error) && (
                <p className="error account-message" role="alert">
                  {localError || error}
                </p>
              )}
              {notice && (
                <p className="account-message auth-notice" role="status">
                  {notice}
                </p>
              )}
              <button disabled={pending} className="large auth-submit">
                {pending ? (
                  <>
                    <LoaderCircle size={17} className="auth-spinner" />
                    {mode === "sign_in" ? "Signing in…" : "Creating account…"}
                  </>
                ) : (
                  <>
                    {mode === "sign_in" ? "Sign in" : "Create account"}
                    <ArrowRight size={17} />
                  </>
                )}
              </button>
            </form>
            <p className="auth-storage-note">
              Sign in to your personal study workspace. Study records stay on
              this device and synchronized across your signed-in devices.
            </p>
          </>
        )}
      </main>
      <footer>Build consistency, one session at a time.</footer>
    </div>
  );
}
