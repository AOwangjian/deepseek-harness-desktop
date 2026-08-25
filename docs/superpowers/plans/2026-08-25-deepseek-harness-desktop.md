# DeepSeek Harness Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a secure Windows desktop wrapper that lets users install or detect DeepSeek Harness, manages its local Web service, and displays the unmodified Harness UI without requiring a terminal or external browser.

**Architecture:** Electron owns the application lifecycle, privileged system integration, and a supervised `dsh web` child process. React renders only desktop-specific setup, status, diagnostics, and settings; the Harness UI is loaded unchanged in a dedicated `WebContentsView`. Pure TypeScript domain services sit behind narrow interfaces so Windows implementations can later be replaced by macOS or Linux adapters.

**Tech Stack:** Electron, React, TypeScript, Vite, electron-builder, Vitest, Testing Library, Playwright, Zod, execa, get-port, semver, electron-updater, GitHub Actions.

---

## File map

- `package.json`: scripts, runtime dependencies, build metadata, and Windows targets.
- `electron.vite.config.ts`: main, preload, and renderer build entry points.
- `src/main/index.ts`: Electron bootstrap and dependency composition only.
- `src/main/app-controller.ts`: application state machine and orchestration.
- `src/main/harness/dependency-detector.ts`: Node/npm/dsh discovery and version checks.
- `src/main/harness/dependency-installer.ts`: explicit, allow-listed installation operations.
- `src/main/harness/harness-process.ts`: start, observe, and stop one owned Harness process.
- `src/main/harness/harness-supervisor.ts`: retries, health checks, and recovery policy.
- `src/main/harness/process-record-store.ts`: atomic ownership metadata for orphan recovery.
- `src/main/platform/platform-adapter.ts`: cross-platform system integration contract.
- `src/main/platform/windows-adapter.ts`: Windows autostart and process-tree implementation.
- `src/main/security/navigation-policy.ts`: local Harness URL and external-link policy.
- `src/main/diagnostics/redactor.ts`: secret removal from logs and reports.
- `src/main/diagnostics/diagnostic-service.ts`: bounded log capture and report export.
- `src/main/updates/update-service.ts`: separate desktop and Harness update checks.
- `src/main/ipc/register-ipc.ts`: validated IPC handlers.
- `src/preload/index.ts`: minimal typed bridge exposed to the renderer.
- `src/shared/contracts.ts`: shared DTOs and Zod schemas.
- `src/renderer/App.tsx`: desktop shell state routing.
- `src/renderer/components/DependencyWizard.tsx`: automatic/manual/later setup choices.
- `src/renderer/components/DesktopStatusBar.tsx`: thin desktop-only controls.
- `src/renderer/components/DiagnosticsView.tsx`: startup failures and sanitized logs.
- `src/renderer/components/DesktopSettings.tsx`: tray, startup, and update preferences.
- `src/renderer/styles.css`: desktop shell styling without styling Harness content.
- `tests/unit/**`: pure service and component tests.
- `tests/integration/**`: process, IPC, and recovery tests.
- `tests/e2e/**`: packaged-window smoke tests with a fake Harness server.
- `.github/workflows/ci.yml`: Windows validation and artifact build.
- `.github/workflows/release.yml`: tag-triggered GitHub Release publishing.

### Task 1: Scaffold the typed Electron application

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `electron.vite.config.ts`
- Create: `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`
- Create: `tests/unit/smoke.test.ts`
- Create: `.gitattributes`
- Create: `.gitignore`

- [ ] **Step 1: Add the initial failing smoke test**

```ts
// tests/unit/smoke.test.ts
import { describe, expect, it } from 'vitest'
import { APP_NAME } from '../../src/shared/contracts'

describe('application metadata', () => {
  it('uses the public product name', () => {
    expect(APP_NAME).toBe('DeepSeek Harness Desktop')
  })
})
```

- [ ] **Step 2: Add package and compiler configuration, then verify the test fails**

Create `package.json` with Node `>=22`, package manager `npm`, scripts `dev`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build`, `dist`, and `dist:portable`. Add Electron, React, Electron Vite, Vitest, Testing Library, Playwright, Zod, execa, get-port, semver, electron-builder, and electron-updater at their latest compatible stable versions, recording the resolved versions in `package-lock.json`.

Run: `npm install && npm test -- --run tests/unit/smoke.test.ts`

Expected: FAIL because `src/shared/contracts.ts` does not exist.

- [ ] **Step 3: Add the minimal build entries and shared constant**

```ts
// src/shared/contracts.ts
export const APP_NAME = 'DeepSeek Harness Desktop'
```

```ts
// src/main/index.ts
import { app, BrowserWindow } from 'electron'
import path from 'node:path'

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  })
  void window.loadURL(process.env.ELECTRON_RENDERER_URL ?? `file://${path.join(__dirname, '../renderer/index.html')}`)
})
```

`src/preload/index.ts` must initially expose no API. `App.tsx` renders the product name. Configure Electron Vite with the three listed entry points. Configure TypeScript with `strict`, `noUncheckedIndexedAccess`, and `noImplicitOverride` enabled.

- [ ] **Step 4: Normalize text handling and verify the scaffold**

`.gitattributes` must contain `* text=auto eol=lf`; `.gitignore` must ignore `node_modules/`, `dist/`, `out/`, `coverage/`, `playwright-report/`, `.env*`, and `*.log` while retaining `.env.example`.

Run: `npm run typecheck && npm test -- --run tests/unit/smoke.test.ts && npm run build`

Expected: all commands exit 0 and generated source files remain UTF-8 without BOM.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json electron.vite.config.ts src tests/unit/smoke.test.ts .gitattributes .gitignore
git commit -m "build: scaffold Electron desktop application"
```

### Task 2: Define validated renderer/main contracts

**Files:**
- Modify: `src/shared/contracts.ts`
- Create: `tests/unit/contracts.test.ts`

- [ ] **Step 1: Write failing schema tests**

```ts
import { describe, expect, it } from 'vitest'
import { installRequestSchema, settingsSchema } from '../../src/shared/contracts'

describe('IPC contracts', () => {
  it('rejects arbitrary install packages', () => {
    expect(installRequestSchema.safeParse({ dependency: 'evil-package', mode: 'automatic' }).success).toBe(false)
  })

  it('accepts explicit user settings', () => {
    expect(settingsSchema.parse({ closeToTray: true, autoStart: false, updatePolicy: 'notify' })).toEqual({
      closeToTray: true,
      autoStart: false,
      updatePolicy: 'notify',
    })
  })
})
```

- [ ] **Step 2: Run the test and observe missing schemas**

Run: `npm test -- --run tests/unit/contracts.test.ts`

Expected: FAIL with missing exports.

- [ ] **Step 3: Implement exact DTOs and schemas**

Define `DependencyName = 'node' | 'dsh'`, `InstallMode = 'automatic' | 'manual' | 'later'`, `UpdatePolicy = 'notify' | 'manual'`, `ServiceStatus = 'checking' | 'needs-setup' | 'starting' | 'running' | 'stopping' | 'failed'`, plus `DependencySnapshot`, `HarnessRuntime`, `DesktopSettings`, and `DiagnosticSummary`. Implement strict Zod schemas for install requests and settings; reject unknown fields.

```ts
export const installRequestSchema = z.object({
  dependency: z.enum(['node', 'dsh']),
  mode: z.enum(['automatic', 'manual', 'later']),
}).strict()

export const settingsSchema = z.object({
  closeToTray: z.boolean(),
  autoStart: z.boolean(),
  updatePolicy: z.enum(['notify', 'manual']),
}).strict()
```

- [ ] **Step 4: Verify contracts**

Run: `npm test -- --run tests/unit/contracts.test.ts && npm run typecheck`

Expected: PASS and no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/contracts.ts tests/unit/contracts.test.ts
git commit -m "feat: define validated desktop contracts"
```

### Task 3: Detect Node.js, npm, and dsh without mutating the machine

**Files:**
- Create: `src/main/harness/dependency-detector.ts`
- Create: `tests/unit/dependency-detector.test.ts`

- [ ] **Step 1: Write failing detector tests**

Inject a `CommandProbe` function so tests never inspect the developer machine. Cover all-present, missing executable, malformed version output, and prerelease `dsh` versions.

```ts
const probe = vi.fn(async (command: string) => {
  const versions: Record<string, string> = { node: 'v24.13.0', npm: '11.6.2', dsh: '0.1.1-rc.2' }
  return versions[command] ?? null
})
const snapshot = await detectDependencies(probe)
expect(snapshot.ready).toBe(true)
expect(snapshot.dsh?.version).toBe('0.1.1-rc.2')
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm test -- --run tests/unit/dependency-detector.test.ts`

Expected: FAIL because the detector does not exist.

- [ ] **Step 3: Implement the detector**

Use `execa(command, ['--version'], { shell: false, reject: false, windowsHide: true })`. Normalize Node's leading `v`, validate versions with `semver.valid`, and return structured missing/error states without throwing. `ready` is true only when all three dependencies have valid versions.

- [ ] **Step 4: Verify detector behavior**

Run: `npm test -- --run tests/unit/dependency-detector.test.ts`

Expected: all detector cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/harness/dependency-detector.ts tests/unit/dependency-detector.test.ts
git commit -m "feat: detect Harness runtime dependencies"
```

### Task 4: Add user-authorized dependency installation

**Files:**
- Create: `src/main/harness/dependency-installer.ts`
- Create: `tests/unit/dependency-installer.test.ts`

- [ ] **Step 1: Write failing allow-list and cancellation tests**

Test that Node automatic installation resolves only to `winget install --id OpenJS.NodeJS.LTS --exact --source winget`; dsh resolves only to `npm install --global @deepseek-ai/dsh@<validated-version>`; manual and later modes execute nothing; invalid versions are rejected.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- --run tests/unit/dependency-installer.test.ts`

Expected: FAIL because `createInstallPlan` and `executeInstallPlan` are missing.

- [ ] **Step 3: Implement plans separately from execution**

```ts
export type InstallPlan = Readonly<{
  executable: 'winget' | 'npm'
  args: readonly string[]
  source: 'Windows Package Manager' | 'npmjs.org'
  version: string
}>
```

`createInstallPlan` must accept only validated contract inputs and a valid semver target. `executeInstallPlan` receives a previously displayed `InstallPlan` plus a one-use confirmation token issued by the app controller. Execute with `shell: false`; stream bounded progress events; never log environment variables.

- [ ] **Step 4: Verify installation policy**

Run: `npm test -- --run tests/unit/dependency-installer.test.ts && npm run typecheck`

Expected: PASS, including zero executor calls for manual/later paths.

- [ ] **Step 5: Commit**

```bash
git add src/main/harness/dependency-installer.ts tests/unit/dependency-installer.test.ts
git commit -m "feat: add confirmed dependency installation"
```

### Task 5: Own one Harness process safely

**Files:**
- Create: `src/main/harness/process-record-store.ts`
- Create: `src/main/harness/harness-process.ts`
- Create: `tests/unit/harness-process.test.ts`
- Create: `tests/integration/fixtures/fake-harness.mjs`
- Create: `tests/integration/harness-process.test.ts`

- [ ] **Step 1: Write failing argument and ownership tests**

Assert the launch arguments equal `['web', '--no-open', '--host', '127.0.0.1', '--port', String(port)]`, `shell` is false, the process record contains PID/start time/instance ID/port/executable, and `stop()` refuses a record whose instance ID is not owned by this app session.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- --run tests/unit/harness-process.test.ts`

Expected: FAIL because process management modules do not exist.

- [ ] **Step 3: Implement atomic records and process lifecycle**

Persist JSON under `app.getPath('userData')/runtime/owned-process.json` by writing a sibling temporary file and renaming it. Spawn `dsh` directly using execa, capture bounded stdout/stderr lines, and expose `started`, `exited`, and `log` events. Graceful stop waits five seconds before calling the platform adapter's verified process-tree termination.

- [ ] **Step 4: Add a real-process integration fixture**

`fake-harness.mjs` must accept the same host/port arguments, start a minimal HTTP server, print `READY`, handle `SIGTERM`, and support `--crash` for failure tests. The integration test verifies start, health response, graceful stop, record creation, and record deletion.

Run: `npm run test:integration -- tests/integration/harness-process.test.ts`

Expected: PASS with no remaining fixture process.

- [ ] **Step 5: Commit**

```bash
git add src/main/harness tests/unit/harness-process.test.ts tests/integration
git commit -m "feat: manage an owned Harness process"
```

### Task 6: Supervise ports, readiness, crashes, and recovery

**Files:**
- Create: `src/main/harness/harness-supervisor.ts`
- Create: `tests/unit/harness-supervisor.test.ts`

- [ ] **Step 1: Write failing supervisor tests**

Use fake clock and injected `getPort`, process factory, and HTTP probe. Cover dynamic port selection, readiness before UI load, three bounded reconnect attempts, startup timeout, crash transition, manual restart, and no automatic restart after explicit stop.

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run tests/unit/harness-supervisor.test.ts`

Expected: FAIL because `HarnessSupervisor` does not exist.

- [ ] **Step 3: Implement a deterministic supervisor state machine**

Allowed transitions are `checking -> starting -> running`, `starting -> failed`, `running -> failed`, `running -> stopping -> checking`, and `failed -> starting`. Emit immutable snapshots. Select a free loopback port with `get-port`; poll `/` every 250 ms for up to 20 seconds; retry disconnected health checks at 1, 2, and 4 seconds; require manual action after the third failure.

- [ ] **Step 4: Verify all state transitions**

Run: `npm test -- --run tests/unit/harness-supervisor.test.ts`

Expected: PASS without pending fake timers.

- [ ] **Step 5: Commit**

```bash
git add src/main/harness/harness-supervisor.ts tests/unit/harness-supervisor.test.ts
git commit -m "feat: supervise Harness service health"
```

### Task 7: Add secure Electron hosting and IPC

**Files:**
- Create: `src/main/security/navigation-policy.ts`
- Create: `src/main/ipc/register-ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Create: `tests/unit/navigation-policy.test.ts`
- Create: `tests/unit/ipc.test.ts`

- [ ] **Step 1: Write failing navigation and IPC tests**

Accept only the exact active `http://127.0.0.1:<port>` origin for embedded navigation. Reject alternate hosts, credentials, file URLs, JavaScript URLs, and different ports. Verify every IPC mutation parses a Zod schema and that no generic command-execution method is exposed.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- --run tests/unit/navigation-policy.test.ts tests/unit/ipc.test.ts`

Expected: FAIL because the policy and handlers are missing.

- [ ] **Step 3: Implement the secure view boundary**

Create a `WebContentsView` with `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`. Deny `setWindowOpenHandler` by default; open explicit `https:` external links with `shell.openExternal` only after policy validation. Block permission requests. Size the view below the desktop status bar and update bounds on window resize.

Expose only `getState`, `chooseInstallMode`, `confirmInstall`, `start`, `stop`, `restart`, `getLogs`, `saveSettings`, and `subscribeState` through `contextBridge`.

- [ ] **Step 4: Verify security tests and type checking**

Run: `npm test -- --run tests/unit/navigation-policy.test.ts tests/unit/ipc.test.ts && npm run typecheck`

Expected: PASS with no use of `nodeIntegration: true` or `shell: true` in `src/`.

- [ ] **Step 5: Commit**

```bash
git add src/main/security src/main/ipc src/main/index.ts src/preload tests/unit/navigation-policy.test.ts tests/unit/ipc.test.ts
git commit -m "feat: host Harness behind secure Electron boundaries"
```

### Task 8: Build the thin desktop UI and dependency wizard

**Files:**
- Modify: `src/renderer/App.tsx`
- Create: `src/renderer/components/DependencyWizard.tsx`
- Create: `src/renderer/components/DesktopStatusBar.tsx`
- Create: `src/renderer/components/DiagnosticsView.tsx`
- Create: `src/renderer/components/DesktopSettings.tsx`
- Create: `src/renderer/styles.css`
- Create: `tests/unit/renderer/DependencyWizard.test.tsx`
- Create: `tests/unit/renderer/App.test.tsx`

- [ ] **Step 1: Write failing interaction tests**

Verify missing dependencies show automatic/manual/later choices; automatic mode displays source/version/command summary before confirmation; manual mode shows official links and a recheck button; running mode renders only the 36-pixel desktop status bar while the Harness view owns the remaining space; failed mode shows sanitized logs and retry/copy actions.

- [ ] **Step 2: Confirm tests fail**

Run: `npm test -- --run tests/unit/renderer`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement state-driven components**

`App` subscribes to one immutable controller snapshot and selects exactly one desktop surface: setup, starting, diagnostics, or running status bar. It must not reproduce Harness navigation, conversations, plugins, or model settings. All actions call the preload API; components never import Electron or Node modules.

- [ ] **Step 4: Verify component behavior and accessibility**

Run: `npm test -- --run tests/unit/renderer && npm run typecheck`

Expected: PASS; buttons are reachable by role/name and status changes use `aria-live="polite"`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer tests/unit/renderer
git commit -m "feat: add thin desktop shell and setup wizard"
```

### Task 9: Implement Windows tray, autostart, and orphan cleanup

**Files:**
- Create: `src/main/platform/platform-adapter.ts`
- Create: `src/main/platform/windows-adapter.ts`
- Create: `src/main/tray-controller.ts`
- Create: `tests/unit/windows-adapter.test.ts`
- Create: `tests/unit/tray-controller.test.ts`

- [ ] **Step 1: Write failing platform tests**

Test autostart delegates to `app.setLoginItemSettings`, graceful process termination precedes verified tree kill, unowned PID records are refused, closing hides the window only when `closeToTray` is true, and the tray exposes open/start/stop/restart/logs/settings/quit commands.

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run tests/unit/windows-adapter.test.ts tests/unit/tray-controller.test.ts`

Expected: FAIL because adapters do not exist.

- [ ] **Step 3: Implement the platform boundary**

Define `PlatformAdapter` with `setAutoStart`, `getAutoStart`, `terminateOwnedProcessTree`, `showNotification`, and `openPath`. The Windows adapter verifies PID creation time and recorded executable before invoking a process-tree termination helper. `TrayController` receives callbacks and contains no Harness logic.

- [ ] **Step 4: Verify Windows behavior**

Run: `npm test -- --run tests/unit/windows-adapter.test.ts tests/unit/tray-controller.test.ts`

Expected: PASS with mocked Electron APIs and no real process termination.

- [ ] **Step 5: Commit**

```bash
git add src/main/platform src/main/tray-controller.ts tests/unit/windows-adapter.test.ts tests/unit/tray-controller.test.ts
git commit -m "feat: integrate Windows lifecycle controls"
```

### Task 10: Add sanitized diagnostics and separate update checks

**Files:**
- Create: `src/main/diagnostics/redactor.ts`
- Create: `src/main/diagnostics/diagnostic-service.ts`
- Create: `src/main/updates/update-service.ts`
- Create: `tests/unit/redactor.test.ts`
- Create: `tests/unit/update-service.test.ts`

- [ ] **Step 1: Write failing privacy and update tests**

Cover DeepSeek/OpenAI-style API keys, bearer tokens, authorization headers, JSON token fields, and environment assignments. Verify diagnostic reports exclude conversation content and environment dumps. Verify desktop and dsh updates produce separate prompts and never install without a confirmation token.

- [ ] **Step 2: Confirm tests fail**

Run: `npm test -- --run tests/unit/redactor.test.ts tests/unit/update-service.test.ts`

Expected: FAIL because diagnostics and updates are missing.

- [ ] **Step 3: Implement bounded, sanitized reports**

Keep at most 2,000 log lines and 2 MiB in memory, replacing secrets with `[REDACTED]`. Reports contain app version, OS version, dependency versions, service state, timestamps, and sanitized logs only. `UpdateService` wraps electron-updater for desktop releases and `npm view @deepseek-ai/dsh version --json` for Harness; installation methods require one-use confirmations bound to the displayed target version.

- [ ] **Step 4: Verify privacy and update policy**

Run: `npm test -- --run tests/unit/redactor.test.ts tests/unit/update-service.test.ts`

Expected: PASS, and test snapshots contain no fixture secrets.

- [ ] **Step 5: Commit**

```bash
git add src/main/diagnostics src/main/updates tests/unit/redactor.test.ts tests/unit/update-service.test.ts
git commit -m "feat: add private diagnostics and confirmed updates"
```

### Task 11: Compose the application controller

**Files:**
- Create: `src/main/app-controller.ts`
- Modify: `src/main/index.ts`
- Create: `tests/integration/app-controller.test.ts`

- [ ] **Step 1: Write failing end-to-end controller scenarios**

Test these flows with injected adapters: ready dependencies to running UI; missing dependency to restricted mode; accepted install to recheck and run; declined install with no mutation; service crash to retry then diagnostics; app quit to child cleanup; startup orphan record to verified recovery.

- [ ] **Step 2: Verify failure**

Run: `npm run test:integration -- tests/integration/app-controller.test.ts`

Expected: FAIL because `AppController` is missing.

- [ ] **Step 3: Implement dependency composition and single-instance bootstrap**

`AppController` owns the public state snapshot and confirmation tokens. `index.ts` acquires `app.requestSingleInstanceLock()` before creating services, restores the existing window on a second launch, composes Windows adapters, registers IPC, creates tray/window/view, and delegates orderly shutdown to the controller. Keep `index.ts` free of policy decisions.

- [ ] **Step 4: Verify integrated lifecycle**

Run: `npm run test:integration -- tests/integration/app-controller.test.ts && npm run typecheck`

Expected: PASS with all fake child processes stopped.

- [ ] **Step 5: Commit**

```bash
git add src/main/app-controller.ts src/main/index.ts tests/integration/app-controller.test.ts
git commit -m "feat: compose desktop application lifecycle"
```

### Task 12: Package, exercise, and publish the Windows application

**Files:**
- Modify: `package.json`
- Create: `build/icon.ico`
- Create: `tests/e2e/desktop.spec.ts`
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Create: `README.md`
- Create: `SECURITY.md`
- Create: `LICENSE`

- [ ] **Step 1: Add a failing packaged-app smoke test**

Launch Electron with an injected fake Harness executable and isolated user-data directory. Assert the dependency-ready path reaches `running`, the status bar is visible, the Harness fixture appears in the embedded view, closing hides to tray, and explicit quit leaves no fixture process.

- [ ] **Step 2: Run the test and confirm packaging is incomplete**

Run: `npm run build && npm run test:e2e -- tests/e2e/desktop.spec.ts`

Expected: FAIL until builder metadata, test hooks, and assets are present.

- [ ] **Step 3: Configure distributable artifacts and CI**

Set app ID `ai.deepseek.harness.desktop`, product name `DeepSeek Harness Desktop`, and publish provider `github` with repository `deepseek-harness-desktop`. Build NSIS x64 and portable x64 artifacts. CI runs on `windows-latest` for pull requests and main pushes: `npm ci`, typecheck, unit tests, integration tests, build, E2E smoke, then upload unsigned artifacts. Release workflow runs only on `v*` tags and requires GitHub's generated token; leave documented optional secrets `CSC_LINK` and `CSC_KEY_PASSWORD` for future signing.

- [ ] **Step 4: Document installation, trust, privacy, and contribution boundaries**

README must explain automatic/manual/later dependency choices, tray behavior, local-only binding, unsigned SmartScreen warning, development commands, and that Harness UI belongs to the upstream DeepSeek project. SECURITY.md must provide private vulnerability-reporting instructions and list protected data. Use the MIT license and preserve upstream trademarks without implying official endorsement.

- [ ] **Step 5: Run full local verification**

Run: `npm run typecheck && npm test -- --run && npm run test:integration && npm run build && npm run test:e2e && npm run dist && npm run dist:portable`

Expected: every command exits 0; NSIS and portable x64 artifacts exist under `dist/`; no child process remains; `git status --short` lists only intended documentation or generated-lock changes before commit.

- [ ] **Step 6: Commit the distributable application**

```bash
git add package.json package-lock.json build tests/e2e .github README.md SECURITY.md LICENSE
git commit -m "build: package and validate Windows release"
```

### Task 13: Create and protect the public GitHub repository

**Files:**
- Modify only if GitHub reports a mismatch: `README.md`

- [ ] **Step 1: Install and authenticate GitHub CLI with user interaction**

Run: `winget install --id GitHub.cli --exact --source winget`

Expected: GitHub CLI installs successfully. Then run `gh auth login --hostname github.com --web --git-protocol https`; the user completes the browser authorization. Verify with `gh auth status` without printing tokens.

- [ ] **Step 2: Create the public repository without collaborators**

Run: `gh repo create deepseek-harness-desktop --public --source . --remote origin --description "A lightweight desktop wrapper for DeepSeek Harness" --push`

Expected: the repository is public, `origin` points to the new repository, and `main` is pushed. Public users have read/clone/fork access but no direct write access unless explicitly added later.

- [ ] **Step 3: Apply repository safeguards**

Enable private vulnerability reporting. If the GitHub account supports rulesets for this public repository, require pull requests and passing `CI` checks for `main`, block force pushes and deletions, and allow the repository owner to administer the rules. If the account tier/API does not support a ruleset, record that limitation in the handoff rather than claiming protection is active.

- [ ] **Step 4: Verify remote state without mutation**

Run: `gh repo view --json nameWithOwner,visibility,url,defaultBranchRef` and `git remote -v`.

Expected: visibility is `PUBLIC`, default branch is `main`, and fetch/push remotes match the new repository.

- [ ] **Step 5: Record completion**

Run: `git status --short && git log --oneline --decorate -10`

Expected: clean working tree and all implementation commits visible on `origin/main`.

## Final verification checklist

- [ ] A clean Windows machine can choose automatic, manual, or deferred dependency setup.
- [ ] No dependency installation or update occurs without a displayed plan and user confirmation.
- [ ] The desktop window loads the unchanged upstream Harness UI without external browser use.
- [ ] The app binds Harness to loopback, blocks unsafe navigation, and exposes no generic shell IPC.
- [ ] Tray, autostart, single-instance, graceful quit, and verified orphan cleanup work.
- [ ] Logs and exported reports redact secrets and omit conversation bodies.
- [ ] Desktop and Harness updates are separate and confirmation-gated.
- [ ] Unit, integration, E2E, build, NSIS, and portable artifact checks pass on Windows.
- [ ] The public GitHub repository has no added collaborators and its actual protection state is reported accurately.
