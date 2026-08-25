import type { DesktopSnapshot } from '../../shared/contracts';

export function DesktopStatusBar(props: { snapshot: DesktopSnapshot }) {
  const { snapshot } = props;
  const label =
    snapshot.runtime.status === 'running'
      ? `Harness running on port ${snapshot.runtime.port}`
      : `Harness ${snapshot.runtime.status}`;

  return (
    <header className="desktop-status-bar">
      <span aria-live="polite">{label}</span>
      <div className="desktop-actions">
        <button
          type="button"
          onClick={() => {
            void window.desktop.setPanel('logs');
          }}
        >
          Logs
        </button>
        <button
          type="button"
          onClick={() => {
            void window.desktop.restart();
          }}
        >
          Restart
        </button>
        <button
          type="button"
          onClick={() => {
            void window.desktop.setPanel('settings');
          }}
        >
          Settings
        </button>
      </div>
    </header>
  );
}
