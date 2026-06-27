import { Component, type ErrorInfo, type ReactNode } from "react";
import { logger } from "@/lib/logger";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Owned error boundary (no `react-error-boundary` dependency). Catches render-time
 * crashes, shows a friendly fallback, and routes the component stack to the logger
 * (never PII). Async / event-handler failures surface via the toast + HTTP layer
 * instead — boundaries only catch render errors.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error("React render error", {
      name: error.name,
      message: error.message,
      componentStack: info.componentStack,
    });
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div
        role="alert"
        className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <p className="text-lg font-semibold text-foreground">Something went wrong.</p>
        <p className="max-w-md text-sm text-muted-foreground">
          The page hit an unexpected error. Reloading usually fixes it; if it keeps
          happening, contact your administrator.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Reload
        </button>
      </div>
    );
  }
}
