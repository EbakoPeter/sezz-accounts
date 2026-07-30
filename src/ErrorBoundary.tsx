import { Component, type ReactNode } from "react";
import { BuildInfo } from "@/components/BuildInfo";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Without this, an uncaught error during rendering unmounts the entire
 * React tree and leaves a blank white page with no clue why — exactly the
 * failure mode this component exists to prevent. This only catches errors
 * thrown *during rendering* (React's contract for error boundaries); errors
 * outside React's reach (module load failures, event handlers, async code)
 * are separately caught by the window-level handlers in main.tsx, which
 * render the same fallback UI by directly manipulating the DOM.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Erreur interceptée par ErrorBoundary :", error);
  }

  render() {
    if (this.state.error) {
      return <ErrorScreen error={this.state.error} context="affichage" />;
    }
    return this.props.children;
  }
}

export function ErrorScreen({ error, context }: { error: unknown; context: string }) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  return (
    <div
      style={{
        fontFamily: "monospace",
        padding: 20,
        color: "#b23a34",
        background: "#faf7f1",
        minHeight: "100vh",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      <h2 style={{ color: "#0d1b2a", fontFamily: "Georgia, serif" }}>
        Erreur au chargement ({context})
      </h2>
      <p>
        <strong>{message}</strong>
      </p>
      {stack && (
        <>
          <p style={{ color: "#726b5e", marginBottom: 4 }}>Détails techniques :</p>
          <p style={{ fontSize: "0.75rem", color: "#726b5e" }}>{stack}</p>
        </>
      )}
      <p style={{ marginTop: 20, color: "#0d1b2a" }}>
        Cette page décrit l&apos;erreur au lieu de rester blanche, précisément pour pouvoir la
        diagnostiquer. Copiez ce message.
      </p>
      <BuildInfo />
    </div>
  );
}
