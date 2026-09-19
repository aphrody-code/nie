import { Component, type ErrorInfo, type ReactNode } from "react";

export interface ErrorBoundaryProps {
  children: ReactNode;
  zone?: string;
  resetKeys?: unknown[];
  fallback?: (erreur: Error, reessayer: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  erreur: Error | null;
  cles: string;
}

function signature(keys: unknown[] | undefined): string {
  try {
    return JSON.stringify(keys ?? []);
  } catch {
    return String(keys);
  }
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { erreur: null, cles: signature(props.resetKeys) };
  }

  static getDerivedStateFromError(erreur: Error): Partial<ErrorBoundaryState> {
    return { erreur };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    const cles = signature(props.resetKeys);
    if (cles !== state.cles) return { erreur: null, cles };
    return null;
  }

  override componentDidCatch(erreur: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary:${this.props.zone ?? "Game"}]`, erreur, info.componentStack);
  }

  reessayer = () => {
    this.setState({ erreur: null });
  };

  override render() {
    const { erreur } = this.state;
    if (!erreur) return this.props.children;
    if (this.props.fallback) return this.props.fallback(erreur, this.reessayer);
    return (
      <div
        style={{
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
          padding: "2rem",
          backgroundColor: "#0d1117",
          color: "#f0f6fc",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
        }}
        role="alert"
      >
        <div>
          <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem", color: "#f85149" }}>
            Une erreur est survenue dans le jeu
          </h2>
          <p style={{ fontSize: "0.875rem", color: "#8b949e", marginBottom: "1.5rem" }}>
            {erreur.message || "Erreur inconnue"}
          </p>
          <button
            type="button"
            onClick={this.reessayer}
            style={{
              padding: "0.5rem 1.25rem",
              backgroundColor: "#238636",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }
}
