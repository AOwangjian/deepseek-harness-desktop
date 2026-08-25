import { randomBytes } from 'node:crypto';

import { execa } from 'execa';

export type UpdateTarget = 'desktop' | 'dsh';

export interface UpdateOffer {
  readonly target: UpdateTarget;
  readonly currentVersion: string;
  readonly availableVersion: string;
  readonly source: 'GitHub Releases' | 'npmjs.org';
}

export type DesktopUpdateChecker = () => Promise<{
  readonly currentVersion: string;
  readonly availableVersion: string | null;
}>;

export type HarnessVersionChecker = () => Promise<string | null>;

export class UpdateConfirmationError extends Error {
  readonly code = 'UPDATE_CONFIRMATION_INVALID';

  constructor(message = 'Update confirmation is invalid or already used.') {
    super(message);
    this.name = 'UpdateConfirmationError';
  }
}

export async function defaultHarnessVersionChecker(): Promise<string | null> {
  const result = await execa(
    'npm',
    ['view', '@deepseek-ai/dsh', 'version', '--json'],
    {
      shell: false,
      windowsHide: true,
      reject: false,
    },
  );
  if (result.exitCode !== 0 || typeof result.stdout !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

interface TokenRecord {
  readonly fingerprint: string;
}

function fingerprint(offer: UpdateOffer): string {
  return JSON.stringify([
    offer.target,
    offer.currentVersion,
    offer.availableVersion,
    offer.source,
  ]);
}

export interface UpdateServiceOptions {
  readonly currentDesktopVersion: string;
  readonly currentHarnessVersion: string;
  readonly checkDesktop?: DesktopUpdateChecker;
  readonly checkHarness?: HarnessVersionChecker;
  readonly installDesktop?: (version: string) => Promise<void>;
  readonly installHarness?: (version: string) => Promise<void>;
}

export class UpdateService {
  private readonly currentDesktopVersion: string;
  private readonly currentHarnessVersion: string;
  private readonly checkDesktopUpdate: DesktopUpdateChecker;
  private readonly checkHarnessUpdate: HarnessVersionChecker;
  private readonly installDesktopUpdate: (version: string) => Promise<void>;
  private readonly installHarnessUpdate: (version: string) => Promise<void>;
  private readonly tokens = new Map<string, TokenRecord>();

  constructor(options: UpdateServiceOptions) {
    this.currentDesktopVersion = options.currentDesktopVersion;
    this.currentHarnessVersion = options.currentHarnessVersion;
    this.checkDesktopUpdate =
      options.checkDesktop ??
      (async () => ({
        currentVersion: this.currentDesktopVersion,
        availableVersion: null,
      }));
    this.checkHarnessUpdate =
      options.checkHarness ?? defaultHarnessVersionChecker;
    this.installDesktopUpdate = options.installDesktop ?? (async () => undefined);
    this.installHarnessUpdate = options.installHarness ?? (async () => undefined);
  }

  async checkDesktop(): Promise<UpdateOffer | null> {
    const result = await this.checkDesktopUpdate();
    if (
      result.availableVersion === null ||
      result.availableVersion === result.currentVersion
    ) {
      return null;
    }
    return Object.freeze({
      target: 'desktop',
      currentVersion: result.currentVersion,
      availableVersion: result.availableVersion,
      source: 'GitHub Releases',
    });
  }

  async checkHarness(): Promise<UpdateOffer | null> {
    const availableVersion = await this.checkHarnessUpdate();
    if (
      availableVersion === null ||
      availableVersion === this.currentHarnessVersion
    ) {
      return null;
    }
    return Object.freeze({
      target: 'dsh',
      currentVersion: this.currentHarnessVersion,
      availableVersion,
      source: 'npmjs.org',
    });
  }

  issueConfirmation(offer: UpdateOffer): string {
    const token = randomBytes(32).toString('base64url');
    this.tokens.set(token, { fingerprint: fingerprint(offer) });
    return token;
  }

  async install(offer: UpdateOffer, token: string): Promise<void> {
    const record = this.tokens.get(token);
    this.tokens.delete(token);
    if (record === undefined || record.fingerprint !== fingerprint(offer)) {
      throw new UpdateConfirmationError();
    }
    if (offer.target === 'desktop') {
      await this.installDesktopUpdate(offer.availableVersion);
      return;
    }
    await this.installHarnessUpdate(offer.availableVersion);
  }
}
