import { useEffect, useState } from 'react';

import type { DesktopSnapshot } from '../shared/contracts';
import { DependencyWizard } from './components/DependencyWizard';
import { DesktopSettings } from './components/DesktopSettings';
import { DesktopStatusBar } from './components/DesktopStatusBar';
import { DiagnosticsView } from './components/DiagnosticsView';

function StartingView(props: { stopping?: boolean }) {
  const label = props.stopping ? 'Stopping Harness…' : 'Starting Harness…';
  return (
    <section className="desktop-panel" aria-label={label}>
      <h1 aria-live="polite">{label}</h1>
    </section>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);

  useEffect(() => {
    const api = window.desktop;
    if (api === undefined) return undefined;
    void api.getState().then(setSnapshot);
    return api.subscribeState(setSnapshot);
  }, []);

  if (snapshot === null) {
    return (
      <main className="desktop-shell">
        <p aria-live="polite">Loading desktop shell…</p>
      </main>
    );
  }

  const showLogs =
    snapshot.surface === 'diagnostics' || snapshot.panel === 'logs';
  const showSettings = snapshot.panel === 'settings';
  const showWizard = snapshot.surface === 'setup' && snapshot.panel === 'none';
  const showStarting = snapshot.surface === 'starting' && snapshot.panel === 'none';

  return (
    <main className="desktop-shell">
      {snapshot.surface === 'running' ? <DesktopStatusBar snapshot={snapshot} /> : null}
      {showWizard ? <DependencyWizard snapshot={snapshot} /> : null}
      {showStarting ? (
        <StartingView stopping={snapshot.runtime.status === 'stopping'} />
      ) : null}
      {showLogs ? <DiagnosticsView snapshot={snapshot} /> : null}
      {showSettings ? <DesktopSettings snapshot={snapshot} /> : null}
    </main>
  );
}
