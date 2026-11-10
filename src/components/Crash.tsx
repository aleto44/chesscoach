import { Component, type ReactNode } from "react";

/**
 * A render error used to leave a phone on a blank page with no way to tell why (no devtools
 * there). This shows the error instead, with a way out: reload, or reload on the home menu.
 */
export class CrashScreen extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("the app crashed", error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const home = () => {
      try {
        localStorage.setItem("cc-view", "home");
      } catch {
        // Private mode: a plain reload.
      }
      location.reload();
    };
    return (
      <div className="crash">
        <h2>Something broke</h2>
        <p className="muted">The app hit an error while drawing the screen. A screenshot of this helps find it.</p>
        <pre>{`${error.name}: ${error.message}\n${error.stack ?? ""}`.slice(0, 3000)}</pre>
        <div className="crash-actions">
          <button className="primary" onClick={() => location.reload()}>
            Reload
          </button>
          <button onClick={home}>Reload on the home menu</button>
        </div>
      </div>
    );
  }
}
