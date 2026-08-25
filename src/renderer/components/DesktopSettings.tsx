import type { DesktopSnapshot, DesktopSettings as Settings } from '../../shared/contracts';

export function DesktopSettings(props: { snapshot: DesktopSnapshot }) {
  const { snapshot } = props;

  const save = (patch: Partial<Settings>): void => {
    void window.desktop.saveSettings({
      ...snapshot.settings,
      ...patch,
    });
  };

  return (
    <section className="desktop-panel" aria-label="Desktop settings">
      <h1>Desktop settings</h1>
      <label>
        <input
          type="checkbox"
          checked={snapshot.settings.closeToTray}
          onChange={(event) => save({ closeToTray: event.target.checked })}
        />
        Close to tray
      </label>
      <label>
        <input
          type="checkbox"
          checked={snapshot.settings.autoStart}
          onChange={(event) => save({ autoStart: event.target.checked })}
        />
        Start with Windows
      </label>
      <label>
        Update policy
        <select
          value={snapshot.settings.updatePolicy}
          onChange={(event) =>
            save({ updatePolicy: event.target.value as Settings['updatePolicy'] })
          }
        >
          <option value="notify">Notify</option>
          <option value="manual">Manual</option>
        </select>
      </label>
    </section>
  );
}
