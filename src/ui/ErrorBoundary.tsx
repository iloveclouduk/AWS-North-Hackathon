import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** What broke, in the player's words: "This tab", "The city". */
  what: string;
  children: ReactNode;
  /** Changing it clears the error (e.g. the tab id: switching tabs tries again). */
  resetKey?: unknown;
}

/**
 * One part of the app failing to draw never blanks the rest. The player sees a plain sentence and a Try again button,
 * never the error itself (the console gets it, for us).
 */
export class ErrorBoundary extends Component<Props, { failed: boolean; key?: unknown }> {
  override state = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: { failed: boolean; key?: unknown }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  override componentDidCatch(err: Error, info: ErrorInfo) {
    console.error(`[ui] ${this.props.what} failed to draw`, err, info.componentStack);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="ui-error" role="alert">
        <p>
          <b>{this.props.what} hit a snag.</b> Your progress is safe.
        </p>
        <button className="btn tiny" onClick={() => this.setState({ failed: false })}>
          Try again
        </button>
      </div>
    );
  }
}
