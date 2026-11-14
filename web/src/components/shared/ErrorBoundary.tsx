"use client";

import { Component, type ReactNode } from "react";

type Props = { children: ReactNode; label: string; fallback?: ReactNode };
type State = { failed: boolean };

/** Keeps one broken widget from blanking the page around it. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[${this.props.label}]`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      this.props.fallback ?? (
        <div className="widget-error" role="status">
          <p>
            <strong>The {this.props.label} could not load.</strong> The rest of the page still works. Reload to try again.
          </p>
        </div>
      )
    );
  }
}
