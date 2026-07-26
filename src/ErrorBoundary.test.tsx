import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function Bomb(): never {
  throw new Error("Erreur de test délibérée");
}

describe("ErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children normally when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>Contenu normal</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Contenu normal")).toBeInTheDocument();
  });

  it("shows a visible error screen instead of a blank page when a child throws", () => {
    // React logs the error to console during the throw — expected noise for
    // this specific test, not a real problem, so it's silenced here only.
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/erreur au chargement/i)).toBeInTheDocument();
    expect(screen.getByText("Erreur de test délibérée")).toBeInTheDocument();
  });
});
