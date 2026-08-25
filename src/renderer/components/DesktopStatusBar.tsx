import { useState } from 'react';

import type { DesktopSnapshot } from '../../shared/contracts';
import { DesktopSettings } from './DesktopSettings';

export function DesktopStatusBar(props: { snapshot: DesktopSnapshot }) {
  const { snapshot } = props;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const label =
    snapshot.runtime.status === 'running'
      ? `Harness running on port ${snapshot.runtime.port}`
      : `Harness ${snapshot.runtime.status}`;

  return (
    <>
      <header className="desktop-status-bar">
        <span aria-live="polite">{label}</span>
        <div className="desktop-actions">
          <button
            type="button"
            onClick={() => {
              void window.desktop.getLogs();
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
          <button type="button" onClick={() => setSettingsOpen((open) => !open)}>
            Settings
          </button>
        </div>
      </header>
      {settingsOpen ? <DesktopSettings snapshot={snapshot} /> : null}
    </>
  );
}
