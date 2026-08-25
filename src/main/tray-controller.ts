export interface TrayMenuItem {
  readonly label?: string;
  readonly click?: () => void;
  readonly type?: 'separator';
}

export interface TrayMenu {
  readonly items: readonly TrayMenuItem[];
}

export interface TrayLike {
  setToolTip(value: string): void;
  setContextMenu(menu: TrayMenu): void;
}

export interface TrayMenuBuilder {
  buildFromTemplate(items: readonly TrayMenuItem[]): TrayMenu;
}

export interface TrayCallbacks {
  readonly openWindow: () => void;
  readonly start: () => void;
  readonly stop: () => void;
  readonly restart: () => void;
  readonly showLogs: () => void;
  readonly openSettings: () => void;
  readonly quit: () => void;
}

export interface ClosableWindow {
  hide(): void;
}

export function handleWindowClose(
  event: { preventDefault: () => void },
  window: ClosableWindow,
  closeToTray: boolean,
): 'hidden' | 'closed' {
  if (!closeToTray) return 'closed';
  event.preventDefault();
  window.hide();
  return 'hidden';
}

/** Tray wiring only. Harness policy lives in the application controller. */
export class TrayController {
  private readonly tray: TrayLike;
  private readonly menuBuilder: TrayMenuBuilder;
  private readonly callbacks: TrayCallbacks;

  constructor(
    tray: TrayLike,
    menuBuilder: TrayMenuBuilder,
    callbacks: TrayCallbacks,
    appName: string,
  ) {
    this.tray = tray;
    this.menuBuilder = menuBuilder;
    this.callbacks = callbacks;
    this.tray.setToolTip(appName);
    this.rebuild();
  }

  rebuild(): void {
    this.tray.setContextMenu(
      this.menuBuilder.buildFromTemplate([
        { label: 'Open', click: () => this.callbacks.openWindow() },
        { label: 'Start', click: () => this.callbacks.start() },
        { label: 'Stop', click: () => this.callbacks.stop() },
        { label: 'Restart', click: () => this.callbacks.restart() },
        { type: 'separator' },
        { label: 'Logs', click: () => this.callbacks.showLogs() },
        { label: 'Settings', click: () => this.callbacks.openSettings() },
        { type: 'separator' },
        { label: 'Quit', click: () => this.callbacks.quit() },
      ]),
    );
  }
}
