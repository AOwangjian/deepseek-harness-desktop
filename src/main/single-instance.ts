import path from 'node:path';

export const DESKTOP_USER_DATA_DIR_NAME = 'deepseek-harness-desktop';

export function resolveDesktopUserDataPath(options: {
  readonly override?: string;
  readonly appData: string;
}): string {
  const override = options.override?.trim();
  if (override !== undefined && override.length > 0) {
    return override;
  }
  return path.join(options.appData, DESKTOP_USER_DATA_DIR_NAME);
}
