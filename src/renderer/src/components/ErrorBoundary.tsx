import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Last line of defence: a render crash shows a recoverable message instead of a blank window. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Render crashed:', error, info.componentStack);
    window.api?.diag?.log('RenderCrash', error.message.slice(0, 300));
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="app app--crash" role="alert">
        <div className="empty">
          <h1 className="empty__title">Something went wrong</h1>
          <p className="empty__text">The interface hit an unexpected error. Your saved sessions are safe.</p>
          <pre className="crash__detail">{error.message}</pre>
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
              Reload GigaAgent
            </button>
            <button type="button" className="btn" onClick={() => window.api?.window.close()}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }
}
