import type { DesktopSnapshot } from '../../shared/contracts';

export function DiagnosticsView(props: { snapshot: DesktopSnapshot }) {
  const { snapshot } = props;
  const running = snapshot.runtime.status === 'running';
  const error =
    snapshot.error ??
    (snapshot.runtime.status === 'failed' ? snapshot.runtime.error : 'Harness failed to start.');

  return (
    <section className="desktop-panel" aria-label="Diagnostics">
      <h1>{running ? 'Logs' : 'Could not start Harness'}</h1>
      {running ? null : <p aria-live="polite">{error}</p>}
      <pre className="desktop-logs">{snapshot.logs.join('\n') || 'No log lines yet.'}</pre>
      <div className="desktop-actions">
        {running ? (
          <button
            type="button"
            onClick={() => {
              void window.desktop.setPanel('none');
            }}
          >
            Back
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              void window.desktop.restart();
            }}
          >
            Retry
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(snapshot.logs.join('\n'));
          }}
        >
          Copy diagnostics
        </button>
      </div>
    </section>
  );
}
