import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { selectWorkspace } from "../lib/local-database";
import { supabase, supabaseAuthStorageKey } from "../lib/supabase";
import {
  AuthSessionManager,
  type AuthAction,
  type AuthStatus,
} from "./auth-session";

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  error: string | null;
  pendingAction: AuthAction | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(
    email: string,
    password: string,
  ): Promise<{ needsEmailConfirmation: boolean }>;
  signOut(): Promise<void>;
  canReopenSignIn(): boolean;
  clearError(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [manager] = useState(
    () =>
      new AuthSessionManager(supabase, selectWorkspace, supabaseAuthStorageKey),
  );
  const snapshot = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot,
  );

  useEffect(() => {
    manager.start();
    return () => manager.stop();
  }, [manager]);

  if (snapshot.status === "restoring")
    return (
      <div className="boot" role="status" aria-live="polite">
        <div className="brand-mark">s</div>
        <h1>Opening Stride</h1>
        <p>Checking your account before opening study data.</p>
      </div>
    );

  return (
    <AuthContext.Provider
      value={{
        ...snapshot,
        signIn: manager.signIn,
        signUp: manager.signUp,
        signOut: manager.signOut,
        canReopenSignIn: manager.canReopenSignIn,
        clearError: manager.clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("Missing authentication provider.");
  return context;
}
