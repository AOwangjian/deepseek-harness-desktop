import { useEffect, useState } from 'react';

import type { DesktopSnapshot } from '../shared/contracts';
import { DependencyWizard } from './components/DependencyWizard';
import { DesktopStatusBar } from './components/DesktopStatusBar';
import { DiagnosticsView } from './components/DiagnosticsView';

function StartingView() {
  return (
    <section className="desktop-panel" aria-label="Starting Harness">
      <h1 aria-live="polite">Starting Harness…</h1>
    </section>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);

  useEffect(() => {
    const api = window.desktop;
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

  return (
    <main className="desktop-shell">
      {snapshot.surface === 'setup' ? <DependencyWizard snapshot={snapshot} /> : null}
      {snapshot.surface === 'starting' ? <StartingView /> : null}
      {snapshot.surface === 'diagnostics' ? <DiagnosticsView snapshot={snapshot} /> : null}
      {snapshot.surface === 'running' ? <DesktopStatusBar snapshot={snapshot} /> : null}
    </main>
  );
}
