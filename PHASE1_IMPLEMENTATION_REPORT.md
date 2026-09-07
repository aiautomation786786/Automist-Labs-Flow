# Phase 1 Implementation Report
## Windows Chrome + Multi-Profile CDP Session Manager

**Date:** 2026-09-08  
**Status:** ✅ COMPLETE — 44/44 tests passing, TypeScript build clean

---

## Summary

Phase 1 implements the foundational Windows-native browser/profile/session infrastructure for the Google Flow Desktop Application. It is a self-contained TypeScript package located at `desktop/` within the repository.

No existing files in `src/` were modified, renamed, or deleted.

---

## Deliverables

### New Directory Structure

```
desktop/
├── package.json                    # Node.js package (Playwright, Vitest, TypeScript)
├── tsconfig.json                   # TypeScript 5.4, target ES2022, lib [ES2022, DOM]
├── vitest.config.ts                # Vitest config — single-fork, 30s timeout
├── scripts/
│   └── manual-test.mjs             # Two-profile end-to-end integration test
└── src/
    ├── shared/
    │   └── types.ts                # All shared TypeScript types
    ├── main/
    │   ├── utils/
    │   │   └── AppLogger.ts        # Structured JSON file logger (never stdout)
    │   └── engine/
    │       ├── WindowsChromeFinder.ts    # Chrome auto-discovery
    │       ├── ChromePortAllocator.ts   # Dynamic TCP port management
    │       ├── ProfileConfig.ts          # Profile CRUD (disk persistence)
    │       ├── FlowAuthDetector.ts       # Language-agnostic auth detection
    │       ├── ProfileSession.ts         # Single profile lifecycle class
    │       └── ProfileSessionManager.ts # Multi-profile orchestrator
    └── tests/
        ├── ChromeFinder.test.ts     # 10 tests — Chrome discovery
        ├── PortAllocator.test.ts    # 11 tests — port allocation
        ├── ProfileConfig.test.ts    # 13 tests — disk persistence
        └── SessionManager.test.ts  # 10 tests — manager unit tests
```

---

## Components

### `AppLogger.ts`
Structured JSON file logger writing to `%LOCALAPPDATA%\GoogleFlowApp\logs\flow-desktop-YYYY-MM-DD.log`.

- **Never uses `process.stdout`** — reserved for MCP JSON-RPC protocol
- Optionally mirrors to `process.stderr` (always safe)
- Per-profile context tagging via `.forProfile(profileId)` child loggers
- `getAppDataDir()` helper: uses `%LOCALAPPDATA%` on Windows, `~/.google-flow-app` on CI

### `WindowsChromeFinder.ts`
Discovers Chrome on Windows by scanning in priority order:

1. `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe` (registry)
2. `HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe` (registry)
3. `%PROGRAMFILES%\Google\Chrome\Application\chrome.exe`
4. `%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe`
5. `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`
6. Canary and Beta paths as fallbacks

Result is in-process cached. On Windows dev machine, Chrome was found at:
```
C:\Program Files\Google\Chrome\Application\chrome.exe (source: registry)
```

### `ChromePortAllocator.ts`
Dynamic TCP port allocator for CDP connections.

- Probes each candidate port with `net.createServer().listen()` before assigning
- Maintains `Map<profileId, AllocatedPort>` in memory
- Idempotent: calling `allocate(profileId)` twice returns the same port
- `release(profileId)` frees the port for reuse
- Default range: 9222–9350 (128 simultaneous profiles)
- `setAllocation()` method for reassigning a temp-key allocation to a real profileId

### `ProfileConfig.ts` — `ProfileConfigManager`
CRUD manager for `profile.json` files stored at:
```
%LOCALAPPDATA%\GoogleFlowApp\profiles\{profileId}\profile.json
```

Chrome user data at:
```
%LOCALAPPDATA%\GoogleFlowApp\profiles\{profileId}\chrome-user-data\
```

- Generates crypto-random `profile_XXXXXXXX` IDs
- Immutable `profileId` and `createdAt`; `updatedAt` always bumped on writes
- `chromeProfileName` defaults to `"Default"` (fresh isolated profile, not a copy)
- Never touches the user's real Chrome installation

### `FlowAuthDetector.ts`
Language-agnostic Google Flow authentication detector replacing the French-string-dependent `account-check.js`.

**States detected:** `authenticated | login_required | captcha | loading | unknown`

**Detection strategy:**
1. URL check: `accounts.google.com` or `google.com/signin` → `login_required`
2. DOM structural signals (sidebar, prompt input, project links) → `authenticated`
3. CAPTCHA iframe / unusual-traffic text → `captcha`
4. `document.readyState !== 'complete'` → `loading`
5. Otherwise → `unknown`

**Email detection** (optional, informational only):
- `__NEXT_DATA__` JSON parsing
- DOM attribute selectors `[data-email]`, `[data-account-email]`
- Never stores credentials; reads only the displayed email

### `ProfileSession.ts`
Full lifecycle manager for one Chrome profile. State machine:

```
created → starting → chrome_launched → connecting → connected
       → auth_required / ready → busy → stopping → stopped / error
```

**Chrome launch:**
- Uses `spawn()` with `shell: false` (no cmd.exe injection risk)
- Anti-detection flags: `--disable-blink-features=AutomationControlled`, `--no-first-run`, etc.
- `--user-data-dir` set to the isolated `chrome-user-data/` path
- `--remote-debugging-port` set to the allocated CDP port
- `stdio: ['ignore', 'pipe', 'pipe']` — Chrome's own stdout/stderr captured to log

**CDP readiness polling:**
- Probes `http://127.0.0.1:{port}/json/version` every 1 second, up to 20 attempts
- Same strategy as original `connect.js` but properly typed and per-session

**Playwright attachment:**
- `chromium.connectOverCDP(endpoint)` — no new process, attaches to existing Chrome
- Uses first existing BrowserContext / Page (or creates new ones if none exist)
- Per-instance: `this.browser`, `this.context`, `this.page` — **never static/shared**

**Crash detection:**
- `chromeProcess.once('exit', ...)` listener
- Only triggered if status is not `stopping` or `stopped`
- Emits `crash` event; sets status to `error`

**Isolation guarantee:**
- Every `ProfileSession` instance owns its own browser/context/page
- `ProfileA.browser !== ProfileB.browser` always
- Module-level singletons do NOT exist

### `ProfileSessionManager.ts`
Top-level orchestrator for all profile sessions.

- `Map<profileId, ProfileSession>` internal collection
- `createProfile()` — allocates port, creates config, emits `profile:created`
- `startProfile()` — reads config, creates `ProfileSession`, calls `session.start()`
- `stopProfile()` — calls `session.stop()`, releases port
- `restartProfile()` — stop + start
- `stopAll()` — parallel shutdown of all active sessions
- `deleteProfile()` — stops if running, removes from map, deletes from disk
- `getAllProfiles()` — merge of active sessions + persisted configs
- `getReadySessions()` — filter by status `ready`
- Event relay: all session events forwarded as manager-level events
- `getDefaultManager()` — singleton for simple single-process use

---

## Test Results

```
Test Files: 4 passed (4)
     Tests: 44 passed (44)
  Duration: ~1.4s
```

| Test File | Tests | Coverage Area |
|-----------|-------|--------------|
| `ChromeFinder.test.ts` | 10 | Registry scan, candidate verification, caching, edge cases |
| `PortAllocator.test.ts` | 11 | Real TCP probes, collision avoidance, idempotency, exhaustion |
| `ProfileConfig.test.ts` | 13 | Disk I/O, CRUD, isolation, field invariants |
| `SessionManager.test.ts` | 10 | Profile lifecycle, events, getAllProfiles, deletion |

---

## Key Design Decisions

### Windows-only paths
- `%LOCALAPPDATA%` for all app data (no `/tmp`, no `process.env.HOME`)
- `%PROGRAMFILES%` and registry for Chrome discovery (no hardcoded paths)
- `spawn(..., { shell: false })` — no cmd.exe shell quoting issues

### No stdout pollution
- `AppLogger` writes only to a log file and `process.stderr`
- `process.stdout` is left clean for MCP JSON-RPC

### No import.meta.dirname
- `AppLogger` uses `process.env.LOCALAPPDATA` — no `import.meta.dirname` needed
- All other modules use `path.join()` with runtime env vars

### No module-level state
- No `let browser`, `let page` at module scope
- All browser state is instance fields on `ProfileSession`
- Singleton `portAllocator` and `appLogger` are acceptable (they hold no browser state)

### Anti-detection Chrome flags
```
--disable-blink-features=AutomationControlled   // navigator.webdriver === false
--no-first-run
--no-default-browser-check
--window-size=1920,1080
--disable-sync
--disable-extensions
--password-store=basic
```

---

## Manual Two-Profile Test

The `scripts/manual-test.mjs` script provides an end-to-end integration test:

```powershell
# From the desktop/ directory:
npm run build
node scripts/manual-test.mjs
```

The script:
1. Auto-discovers Chrome
2. Creates two isolated profiles with unique IDs, ports, and data dirs
3. Launches both Chrome windows simultaneously
4. Waits for CDP connections to become ready
5. Navigates each to a different URL and verifies Playwright page isolation
6. Checks auth state on Google Flow for each profile
7. Shuts both sessions down cleanly
8. Deletes the test profiles from disk

---

## Existing Files — Untouched

All files in `src/` (the original MCP server) remain exactly as before:

| File | Status |
|------|--------|
| `src/index.js` | ✅ Untouched |
| `src/browser/connect.js` | ✅ Untouched |
| `src/browser/launch-profile.js` | ✅ Untouched |
| `src/browser/account-check.js` | ✅ Untouched |
| `src/browser/safe-actions.js` | ✅ Untouched |
| `src/navigation/project-navigator.js` | ✅ Untouched |
| `src/queue/job-queue.js` | ✅ Untouched |
| `src/tools/*.js` | ✅ Untouched |
| `src/utils/*.js` | ✅ Untouched |
| `config/` | ✅ Untouched |

---

## Next Steps (Phase 2+)

Phase 1 is complete. The session manager is ready to be consumed by:

- **Phase 2:** Electron main process wiring — `ProfileSessionManager` as the app's core service
- **Phase 3:** Electron IPC — expose session snapshots and events to the renderer process
- **Phase 4:** React UI — profile cards, status indicators, auth-required prompts
- **Phase 5:** Job scheduler — `getReadySessions()` + automation task queue

No Phase 2 work has been started.
