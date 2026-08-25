import type { DesktopSnapshot, InstallMode } from '../../shared/contracts';

const NODE_MANUAL_URL = 'https://nodejs.org/en/download';
const DSH_MANUAL_URL = 'https://www.npmjs.com/package/@deepseek-ai/dsh';

export function DependencyWizard(props: { snapshot: DesktopSnapshot }) {
  const { snapshot } = props;
  const missing =
    snapshot.runtime.status === 'needs-setup' ? snapshot.runtime.missing : [];

  const choose = (mode: InstallMode): void => {
    const dependency = missing[0] === 'node' ? 'node' : 'dsh';
    void window.desktop.chooseInstallMode({ dependency, mode });
  };

  if (snapshot.installPlan !== null && snapshot.confirmationToken !== null) {
    const command = [snapshot.installPlan.executable, ...snapshot.installPlan.args].join(
      ' ',
    );
    return (
      <section className="desktop-panel" aria-label="Confirm installation">
        <h1>Confirm installation</h1>
        <p>Source: {snapshot.installPlan.source}</p>
        <p>Version: {snapshot.installPlan.version}</p>
        <p>
          Command: <code>{command}</code>
        </p>
        <div className="desktop-actions">
          <button
            type="button"
            onClick={() => {
              void window.desktop.confirmInstall(snapshot.confirmationToken ?? '');
            }}
          >
            Confirm install
          </button>
          <button type="button" onClick={() => choose('later')}>
            Cancel
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="desktop-panel" aria-label="Dependency setup">
      <h1>Set up DeepSeek Harness</h1>
      <p>
        Missing: {missing.length > 0 ? missing.join(', ') : 'required runtime tools'}
      </p>
      <div className="desktop-actions">
        <button type="button" onClick={() => choose('automatic')}>
          Automatic install
        </button>
        <button type="button" onClick={() => choose('manual')}>
          Manual install
        </button>
        <button type="button" onClick={() => choose('later')}>
          Later
        </button>
      </div>
      {snapshot.runtime.status === 'needs-setup' ? (
        <div>
          <p className="desktop-muted">Official installers</p>
          <p>
            <a href={NODE_MANUAL_URL}>Node.js download</a>
          </p>
          <p>
            <a href={DSH_MANUAL_URL}>@deepseek-ai/dsh on npm</a>
          </p>
          <button
            type="button"
            onClick={() => {
              void window.desktop.getState();
            }}
          >
            Recheck
          </button>
        </div>
      ) : null}
    </section>
  );
}
