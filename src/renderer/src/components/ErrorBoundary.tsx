import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Catches render-time crashes and shows them instead of a blank screen. */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Render crashed:', error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (error) {
      return (
        <div style={{
          padding: '32px',
          fontFamily: 'monospace',
          background: '#14212e',
          color: '#f8fafb',
          height: '100%',
          boxSizing: 'border-box',
        }}>
          <h2 style={{ color: '#d4202f', marginTop: 0 }}>Render Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#e9edf1', fontSize: 13 }}>
            {error.message}
            {'\n\n'}
            {error.stack}
          </pre>
          <p style={{ color: '#44546a', fontSize: 13 }}>
            Open DevTools (Ctrl+Shift+I) for more details, or close and reopen the app.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
