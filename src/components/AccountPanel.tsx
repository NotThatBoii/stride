import { useId, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useStride } from "../state";

export function AccountPanel() {
  const { user, error, signOut, clearError } = useAuth();
  const { data } = useStride();
  const headingId = useId();
  const [pending, setPending] = useState(false);

  async function leaveAccount() {
    if (pending) return;
    setPending(true);
    clearError();
    try {
      await signOut();
    } catch {
      // The auth gate hides this workspace immediately. The session manager
      // reports any logout failure on the authentication screen.
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
            Your study data is saved locally and synchronized with your account
            across devices when connected.
          </p>
        </div>
        <span className="account-status">Signed in</span>
      </div>
      {data.running?.runningSince != null && (
        <p className="hint account-message">
          Your active timer will keep counting in this workspace after sign-out.
          Pause it first if you do not want that time recorded.
        </p>
      )}
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
      {error && (
        <p className="error account-message" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
