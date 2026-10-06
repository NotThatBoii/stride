import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { PwaUpdateNotice } from "./Pwa";
import { LegalDialog, LegalLink, LegalLinks } from "./LegalDocuments";
import {
  consentRequiredMessage,
  currentSignupConsent,
  type LegalDocumentId,
} from "../lib/legal";

function failedAccountCallback() {
  const address = new URL(location.href);
  const hash = new URLSearchParams(address.hash.slice(1));
  const keys = ["error", "error_code", "error_description"];
  if (
    ![address.searchParams, hash].some((parameters) =>
      keys.some((key) => parameters.get(key)),
    )
  )
    return null;
  // Capture guidance before central cleanup, without copying server text or
  // holding a credential-bearing URL in component state.
  return "This account link could not be used. It may have expired or already been opened. If you confirmed your email, sign in below. Otherwise, create your account again to request a fresh confirmation email.";
}

export default function AuthenticationScreen() {
  const {
    status,
    error,
    pendingAction,
    signIn,
    signUp,
    canReopenSignIn,
    clearError,
  } = useAuth();
  const [mode, setMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [failedCallback] = useState(failedAccountCallback);
  const [localError, setLocalError] = useState(failedCallback ?? "");
  const [accepted, setAccepted] = useState(false);
  const [consentError, setConsentError] = useState(false);
  const [legalDocument, setLegalDocument] = useState<{
    id: LegalDocumentId;
    opener: HTMLElement;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [reopenAvailable, setReopenAvailable] = useState(false);
  const busy = pending || pendingAction !== null;
  const signingOut = pendingAction === "sign_out";

  function openLegal(documentId: LegalDocumentId, opener: HTMLElement) {
    setLegalDocument({ id: documentId, opener });
  }

  useEffect(() => {
    setReopenAvailable(false);
    if (!signingOut) return;
    const timer = setTimeout(() => setReopenAvailable(true), 10_000);
    return () => clearTimeout(timer);
  }, [signingOut]);

  function changeMode(next: typeof mode) {
    setMode(next);
    setPassword("");
    setAccepted(false);
    setConsentError(false);
    setLocalError("");
    setNotice("");
    clearError();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || status === "disabled") return;
    if (mode === "sign_up" && accepted !== true) {
      setConsentError(true);
      setLocalError(consentRequiredMessage);
      return;
    }
    setPending(true);
    setLocalError("");
    setNotice("");
    clearError();
    try {
      if (mode === "sign_in") {
        await signIn(email.trim(), password);
      } else {
        const result = await signUp(
          email.trim(),
          password,
          currentSignupConsent(accepted),
        );
        setAccepted(false);
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
      <PwaUpdateNotice busy={busy} />
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
                disabled={busy}
                onClick={() => changeMode("sign_in")}
              >
                Sign in
              </button>
              <button
                type="button"
                className={`account-tab ${mode === "sign_up" ? "active" : ""}`}
                aria-pressed={mode === "sign_up"}
                disabled={busy}
                onClick={() => changeMode("sign_up")}
              >
                Create account
              </button>
            </div>
            <form
              className="account-form"
              aria-busy={busy}
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
                  disabled={busy}
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
                  disabled={busy}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              {mode === "sign_up" && (
                <>
                  <small id="auth-password-hint" className="hint">
                    Use at least 6 characters.
                  </small>
                  <label className="signup-consent" htmlFor="signup-consent">
                    <input
                      id="signup-consent"
                      type="checkbox"
                      required
                      checked={accepted}
                      disabled={busy}
                      aria-invalid={consentError || undefined}
                      aria-describedby={
                        consentError ? "auth-account-error" : undefined
                      }
                      onInvalid={(event) => {
                        event.preventDefault();
                        setConsentError(true);
                        setLocalError(consentRequiredMessage);
                        event.currentTarget.focus();
                      }}
                      onChange={(event) => {
                        setAccepted(event.target.checked);
                        setConsentError(false);
                        if (localError === consentRequiredMessage)
                          setLocalError("");
                      }}
                    />
                    <span>
                      I agree to the{" "}
                      <LegalLink documentId="terms" onOpen={openLegal} /> and
                      acknowledge the{" "}
                      <LegalLink documentId="privacy" onOpen={openLegal} />.
                    </span>
                  </label>
                </>
              )}
              {(localError || error) && (
                <p
                  id="auth-account-error"
                  className="error account-message"
                  role="alert"
                >
                  {localError || error}
                </p>
              )}
              {notice && (
                <p className="account-message auth-notice" role="status">
                  {notice}
                </p>
              )}
              {signingOut && (
                <p className="account-message auth-notice" role="status">
                  Your study data is saved. Please wait before signing in again.
                </p>
              )}
              <button disabled={busy} className="large auth-submit">
                {busy ? (
                  <>
                    <LoaderCircle size={17} className="auth-spinner" />
                    {signingOut
                      ? "Finishing sign-out…"
                      : mode === "sign_in"
                        ? "Signing in…"
                        : "Creating account…"}
                  </>
                ) : (
                  <>
                    {mode === "sign_in" ? "Sign in" : "Create account"}
                    <ArrowRight size={17} />
                  </>
                )}
              </button>
            </form>
            {signingOut && reopenAvailable && canReopenSignIn() && (
              <div className="account-message">
                <p role="status">
                  Sign-out is taking longer than expected. Reopen sign-in to
                  continue. Your saved study data will be kept.
                </p>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    if (canReopenSignIn()) location.reload();
                  }}
                >
                  Reopen sign-in
                </button>
              </div>
            )}
            <p className="auth-storage-note">
              Sign in to your personal study workspace. Study records stay on
              this device and synchronized across your signed-in devices.
            </p>
          </>
        )}
        {(mode !== "sign_up" || status === "disabled") && (
          <LegalLinks onOpen={openLegal} />
        )}
      </main>
      <footer>Build consistency, one session at a time.</footer>
      {legalDocument && (
        <LegalDialog
          documentId={legalDocument.id}
          returnFocusTo={legalDocument.opener}
          onClose={() => setLegalDocument(null)}
        />
      )}
    </div>
  );
}
