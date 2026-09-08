/**
 * phase5_5_live_account_test.mjs
 *
 * Live Windows Verification for Phase 5.5:
 * Multi-Profile Dedicated Flow Account Manager & Process Safety.
 *
 * Verifies live on this Windows machine:
 *  - Test A: Dedicated account creation & visible fast-path launch (launchLoginBrowser)
 *    PID confirmed, browser_open state, normal Chrome intact.
 *  - Test B: Multi-account concurrency (2 dedicated accounts running simultaneously on different ports)
 *    Isolated user-data directories, isolated CDP ports.
 *  - Test C: Independent safe termination (stopping Account A leaves Account B and normal Chrome unaffected).
 *  - Test D: Profile persistence (restarting manager reuses exact same user-data dir).
 */

import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as http from 'http';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const cfgMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/ProfileConfig.js')).href);
const sessMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/ProfileSession.js')).href);
const mgrMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/ProfileSessionManager.js')).href);
const finderMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/WindowsChromeFinder.js')).href);
const portMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/ChromePortAllocator.js')).href);

const { ProfileConfigManager, getProfilesRootDir } = cfgMod;
const { ProfileSessionManager } = mgrMod;
const { WindowsChromeFinder } = finderMod;
const { ChromePortAllocator } = portMod;
const { probeCdpPort } = sessMod;

const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(icon, color, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  process.stderr.write(`${color}${icon} [${ts}] ${msg}${c.reset}\n`);
}

const info = (msg) => log('ℹ', c.blue, msg);
const ok = (msg) => log('✓', c.green, msg);
const warn = (msg) => log('⚠', c.yellow, msg);
const fail = (msg) => log('✗', c.red, msg);
const banner = (msg) => {
  process.stderr.write(`\n${c.cyan}${c.bold}═══════════════════════════════════════════════════════════════════\n`);
  process.stderr.write(`  ${msg}\n`);
  process.stderr.write(`═══════════════════════════════════════════════════════════════════${c.reset}\n\n`);
};

function getRunningChromePids() {
  if (process.platform !== 'win32') return [];
  try {
    const stdout = execSync('powershell.exe -NoProfile -Command "(Get-Process -Name chrome -ErrorAction SilentlyContinue).Id"', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return stdout
      .trim()
      .split(/\r?\n/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);
  } catch {
    return [];
  }
}

function isPidAlive(pid) {
  if (process.platform !== 'win32') {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  try {
    const out = execSync(`powershell.exe -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Id"`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseInt(out.trim(), 10) === pid;
  } catch {
    return false;
  }
}

async function checkPort(port) {
  try {
    await probeCdpPort(port);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  banner('PHASE 5.5: MULTI-PROFILE DEDICATED FLOW ACCOUNT MANAGER LIVE TEST');

  const chromePath = WindowsChromeFinder.findOrThrow();
  info(`Windows Chrome Executable: ${chromePath}`);

  const profilesDir = getProfilesRootDir();
  info(`Profiles Root Directory: ${profilesDir}`);

  // Snapshot normal Chrome PIDs before doing anything
  const initialChromePids = getRunningChromePids();
  info(`Normal Chrome processes running initially: ${initialChromePids.length} PIDs found`);

  const portAllocator = new ChromePortAllocator({ portStart: 9350, portEnd: 9450 });
  const manager = new ProfileSessionManager({ portAllocator, chromePath });

  let accountA = null;
  let accountB = null;

  try {
    // -------------------------------------------------------------------------
    // TEST A: Fast-Path Launch (Open Login) for Account A
    // -------------------------------------------------------------------------
    banner('TEST A: Create Flow Account A ("AI Automation") & Fast-Path Login Launch');

    accountA = await manager.createProfile({
      displayName: 'AI Automation (Test Account)',
      expectedEmail: 'aiautomation786786@gmail.com',
      notes: 'Phase 5.5 Live Test Account A',
    });
    ok(`Created Account A: ID=${accountA.profileId}, Assigned Port=${accountA.cdpPort}`);
    info(`Account A user-data directory: ${accountA.userDataDir}`);

    if (!accountA.userDataDir.includes('AutomistLabs') || !accountA.userDataDir.includes('FlowProfiles')) {
      throw new Error(`Invalid user-data dir path: ${accountA.userDataDir}`);
    }
    ok('Account A path strictly complies with %LOCALAPPDATA%\\AutomistLabs\\FlowProfiles convention.');

    info('Triggering launchLoginBrowser (fast path: no CDP wait, no Playwright, PID confirmed)...');
    const launchAResult = await manager.launchLoginBrowser(accountA.profileId);
    ok(`launchLoginBrowser returned: PID=${launchAResult.pid}, port=${launchAResult.cdpPort}`);

    if (!launchAResult.pid || !isPidAlive(launchAResult.pid)) {
      throw new Error(`Process PID ${launchAResult.pid} is not alive on Windows!`);
    }
    ok(`Dedicated Chrome process (PID ${launchAResult.pid}) is confirmed running and alive on Windows!`);

    const sessionA = manager.getSession(accountA.profileId);
    if (!sessionA || sessionA.status !== 'browser_open') {
      throw new Error(`Expected session status 'browser_open', got '${sessionA?.status}'`);
    }
    ok(`Session A transitioned to granular status 'browser_open' (browser open, login ready).`);

    // Verify normal Chrome is completely untouched
    const pidsAfterLaunchA = getRunningChromePids();
    for (const normalPid of initialChromePids) {
      if (!pidsAfterLaunchA.includes(normalPid)) {
        throw new Error(`SAFETY VIOLATION: Normal Chrome PID ${normalPid} was closed!`);
      }
    }
    ok(`SAFETY VERIFIED: All ${initialChromePids.length} original normal Chrome processes are still running!`);

    // -------------------------------------------------------------------------
    // TEST B: Multi-Account Concurrency — Launch Account B
    // -------------------------------------------------------------------------
    banner('TEST B: Multi-Account Concurrency — Launch Flow Account B ("Creator")');

    accountB = await manager.createProfile({
      displayName: 'Creator Account (Test Account)',
      expectedEmail: 'creator@flow.local',
      notes: 'Phase 5.5 Live Test Account B',
    });
    ok(`Created Account B: ID=${accountB.profileId}, Assigned Port=${accountB.cdpPort}`);

    if (accountA.cdpPort === accountB.cdpPort) {
      throw new Error(`Port collision: both accounts got port ${accountA.cdpPort}`);
    }
    if (accountA.userDataDir === accountB.userDataDir) {
      throw new Error(`Directory collision: both accounts share userDataDir!`);
    }
    ok(`Accounts A & B have distinct CDP ports (${accountA.cdpPort} vs ${accountB.cdpPort}) and separate user-data dirs.`);

    info('Launching Account B login browser...');
    const launchBResult = await manager.launchLoginBrowser(accountB.profileId);
    ok(`Account B launched: PID=${launchBResult.pid}, port=${launchBResult.cdpPort}`);

    if (!launchBResult.pid || !isPidAlive(launchBResult.pid)) {
      throw new Error(`Account B process PID ${launchBResult.pid} is not alive!`);
    }
    if (launchAResult.pid === launchBResult.pid) {
      throw new Error(`FATAL: Both accounts share the same Chrome process PID!`);
    }
    ok(`Independent processes confirmed: Account A PID=${launchAResult.pid}, Account B PID=${launchBResult.pid}`);

    // Both PIDs must still be alive simultaneously
    if (!isPidAlive(launchAResult.pid) || !isPidAlive(launchBResult.pid)) {
      throw new Error('One of the dedicated accounts died during concurrent launch!');
    }
    ok('Both dedicated Flow accounts are running concurrently without interfering with each other!');

    // -------------------------------------------------------------------------
    // TEST C: Independent Safe Termination of Account A Only
    // -------------------------------------------------------------------------
    banner('TEST C: Safe Termination of Account A Only');

    info(`Stopping Account A (PID ${launchAResult.pid})...`);
    await manager.stopProfile(accountA.profileId);
    await new Promise((r) => setTimeout(r, 1200));

    const pidADead = !isPidAlive(launchAResult.pid);
    if (!pidADead) {
      throw new Error(`Account A PID ${launchAResult.pid} is still alive after stopProfile!`);
    }
    ok(`Account A PID ${launchAResult.pid} stopped cleanly.`);

    // Verify Account B PID is STILL ALIVE
    if (!isPidAlive(launchBResult.pid)) {
      throw new Error(`FATAL ISOLATION BUG: Stopping Account A killed Account B PID ${launchBResult.pid}!`);
    }
    ok(`ISOLATION VERIFIED: Account B PID ${launchBResult.pid} is STILL ALIVE and unaffected!`);

    // Verify normal Chrome is STILL untouched
    const pidsAfterStopA = getRunningChromePids();
    for (const normalPid of initialChromePids) {
      if (!pidsAfterStopA.includes(normalPid)) {
        throw new Error(`SAFETY VIOLATION: Normal Chrome PID ${normalPid} was terminated during stopProfile!`);
      }
    }
    ok(`SAFETY VERIFIED: Normal Chrome processes remain 100% untouched after stopping Account A.`);

    // -------------------------------------------------------------------------
    // TEST D: Profile Persistence & Reuse
    // -------------------------------------------------------------------------
    banner('TEST D: Profile Persistence & Re-launch Simulation');

    // Stop Account B first
    info(`Stopping Account B (PID ${launchBResult.pid})...`);
    await manager.stopProfile(accountB.profileId);
    await new Promise((r) => setTimeout(r, 1200));

    // Simulate app restart by instantiating a completely new ProfileSessionManager
    info('Simulating app restart: instantiating new ProfileSessionManager...');
    const restartedManager = new ProfileSessionManager({ portAllocator: new ChromePortAllocator({ portStart: 9350, portEnd: 9450 }), chromePath });

    const allProfiles = restartedManager.getAllProfiles();
    const persistedA = allProfiles.find((p) => p.profileId === accountA.profileId);
    if (!persistedA) {
      throw new Error(`Profile ${accountA.profileId} was not found after simulated app restart!`);
    }
    ok(`Profile persisted on disk: ${persistedA.displayName} (${persistedA.profileId})`);

    const readConfigA = ProfileConfigManager.read(accountA.profileId);
    if (readConfigA.userDataDir !== accountA.userDataDir) {
      throw new Error(`User-data directory mismatch on reload! Expected ${accountA.userDataDir}, got ${readConfigA.userDataDir}`);
    }
    ok(`PERSISTENCE VERIFIED: Exact same user-data dir reused: ${readConfigA.userDataDir}`);

    // Clean up test accounts from disk
    banner('CLEANUP: Deleting Temporary Test Accounts');
    await restartedManager.deleteProfile(accountA.profileId);
    await restartedManager.deleteProfile(accountB.profileId);
    ok('Temporary test accounts cleaned up from disk.');

    banner('PHASE 5.5 LIVE VERIFICATION: ALL 4 TESTS PASSED (A, B, C, D)');
    process.stdout.write(JSON.stringify({
      testA_fastPathLaunch: 'LIVE VERIFIED',
      testB_multiAccountConcurrency: 'LIVE VERIFIED',
      testC_independentSafeTermination: 'LIVE VERIFIED',
      testD_profilePersistence: 'LIVE VERIFIED',
      normalChromeSafety: 'LIVE VERIFIED',
    }, null, 2) + '\n');
  } catch (err) {
    fail(`Phase 5.5 live verification failed: ${err.message}`);
    // Cleanup if error
    if (accountA) {
      await manager.stopProfile(accountA.profileId).catch(() => {});
      await manager.deleteProfile(accountA.profileId).catch(() => {});
    }
    if (accountB) {
      await manager.stopProfile(accountB.profileId).catch(() => {});
      await manager.deleteProfile(accountB.profileId).catch(() => {});
    }
    process.exit(1);
  }
}

main();
