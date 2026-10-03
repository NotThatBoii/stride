import { Fragment, useSyncExternalStore, type ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { getActiveWorkspace, subscribeWorkspace } from "../lib/local-database";
import AuthenticationScreen from "../components/AuthenticationScreen";

// Keep the data provider outside the signed-out flow: legacy anonymous data
// remains stored, but is never initialized or shown by the entry screen.
export default function AuthGate({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const workspace = useSyncExternalStore(
    subscribeWorkspace,
    getActiveWorkspace,
    getActiveWorkspace,
  );

  if (status !== "signed_in" || !user) return <AuthenticationScreen />;

  // Observe workspace selection as well as authentication. A stale selection
  // must not mount the data provider under another account's identity.
  if (
    workspace.kind !== "account" ||
    workspace.accountId !== user.id.toLowerCase()
  )
    return (
      <div className="boot" role="alert">
        <div className="brand-mark">s</div>
        <h1>Unable to open your account workspace</h1>
        <p>
          Reload Stride to check your account again. Your local data is
          preserved.
        </p>
        <button onClick={() => location.reload()}>Try again</button>
      </div>
    );

  return <Fragment key={user.id}>{children}</Fragment>;
}
