import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "./state";
import { AuthProvider } from "./auth/AuthProvider";
import AuthGate from "./auth/AuthGate";
import { SyncProvider } from "./sync/SyncProvider";
import { startWebPwa } from "./lib/pwa";
import "./styles.css";
import "./workspace.css";
import "./mobile.css";
const App = lazy(() => import("./App"));
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <AuthGate>
        <Provider>
          <SyncProvider>
            <Suspense
              fallback={
                <div className="boot" role="status">
                  Opening workspace…
                </div>
              }
            >
              <App />
            </Suspense>
          </SyncProvider>
        </Provider>
      </AuthGate>
    </AuthProvider>
  </React.StrictMode>,
);
startWebPwa();
