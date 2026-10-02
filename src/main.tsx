import React from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "./state";
import { AuthProvider } from "./auth/AuthProvider";
import App from "./App";
import "./styles.css";
import "./workspace.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <Provider>
        <App />
      </Provider>
    </AuthProvider>
  </React.StrictMode>,
);
