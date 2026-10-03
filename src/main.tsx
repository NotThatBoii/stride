import React from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "./state";
import { AuthProvider } from "./auth/AuthProvider";
import AuthGate from "./auth/AuthGate";
import { SyncProvider } from "./sync/SyncProvider";
import App from "./App";
import "./styles.css";
import "./workspace.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <AuthGate>
        <Provider>
          <SyncProvider>
            <App />
          </SyncProvider>
        </Provider>
      </AuthGate>
    </AuthProvider>
  </React.StrictMode>,
);
