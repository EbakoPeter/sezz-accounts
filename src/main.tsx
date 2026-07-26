import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "@/auth/AuthContext";
import { App } from "./App";
import { ErrorBoundary, ErrorScreen } from "./ErrorBoundary";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Élément #root introuvable dans index.html.");
}

/**
 * Catches whatever ErrorBoundary structurally cannot: errors thrown outside
 * React's render cycle (a module failing to load, a rejected promise with
 * no .catch, an error inside a plain event handler). Without this, those
 * fail silently in production and the page just... stops, with nothing on
 * screen and nothing but a console message nobody but a developer would
 * ever see.
 */
function showFatalError(error: unknown, context: string) {
  createRoot(rootElement!).render(<ErrorScreen error={error} context={context} />);
}

window.addEventListener("error", (event) => {
  showFatalError(event.error ?? event.message, "erreur JavaScript");
});
window.addEventListener("unhandledrejection", (event) => {
  showFatalError(event.reason, "promesse non gérée");
});

try {
  createRoot(rootElement).render(
    <StrictMode>
      <ErrorBoundary>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
} catch (error) {
  showFatalError(error, "démarrage");
}
