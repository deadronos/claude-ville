import { Component, type ErrorInfo, type ReactNode } from 'react';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[React] render failed:', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="boot-error">
          <div>RENDER FAILED</div>
          <div className="boot-error__detail">{this.state.error.message}</div>
        </div>
      );
    }

    return this.props.children;
  }
}
