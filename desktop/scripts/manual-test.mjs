/**
 * manual-test.mjs
 *
 * Manual end-to-end integration test for Phase 1.
 * Run with: node scripts/manual-test.mjs
 *
 * What this test does:
 *  1. Auto-discovers Chrome on this Windows system.
 *  2. Creates two isolated profiles with unique IDs and ports.
 *  3. Launches both Chrome instances simultaneously.
 *  4. Waits for both CDP connections to become ready.
 *  5. Connects Playwright to both independently.
 *  6. Navigates each to a different page, confirms they are independent.
 *  7. Checks auth state on Google Flow for each.
 *  8. Shuts both down cleanly.
 *  9. Verifies port release.
 *
 * This test OPENS VISIBLE CHROME WINDOWS. Press Ctrl+C to abort at any time.
 * The profiles are stored temporarily and are deleted after the test.
 *
 * Requirements:
 *  - Google Chrome must be installed on this machine.
 *  - Node.js 18+ required.
 *  - Run "npm install" in the desktop/ directory first.
 *  - Build TypeScript first: npm run build (or run via tsx)
 */

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

// Use __dirname equivalent for ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// We import from the compiled dist/ directory.
// Run `npm run build` before executing this script.
// ---------------------------------------------------------------------------

let ProfileSessionManager, ProfileConfigManager, ChromePortAllocator, WindowsChromeFinder;

try {
  const managerMod = await import(path.join(rootDir, 'dist/main/engine/ProfileSessionManager.js'));
  const configMod = await import(path.join(rootDir, 'dist/main/engine/ProfileConfig.js'));
  const allocMod = await import(path.join(rootDir, 'dist/main/engine/ChromePortAllocator.js'));
  const finderMod = await import(path.join(rootDir, 'dist/main/engine/WindowsChromeFinder.js'));

  ProfileSessionManager = managerMod.ProfileSessionManager;
  ProfileConfigManager = configMod.ProfileConfigManager;
  ChromePortAllocator = allocMod.ChromePortAllocator;
  WindowsChromeFinder = finderMod.WindowsChromeFinder;
} catch (err) {
  console.error('❌ Could not import dist/ modules. Did you run "npm run build" first?');
  console.error(err.message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// ANSI color helpers
// ---------------------------------------------------------------------------

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
const step = (msg) => log('▶', c.cyan + c.bold, msg);

// ---------------------------------------------------------------------------
// Test logic
// ---------------------------------------------------------------------------

let manager = null;
const createdProfileIds = [];

async function runTest() {
  step('Phase 1 Manual Integration Test — Two Independent Chrome Profiles');
  process.stderr.write('\n');

  // ------------------------------------------------------------------
  // Step 1: Chrome discovery
  // ------------------------------------------------------------------
  step('STEP 1: Chrome Discovery');

  const discovery = WindowsChromeFinder.find();
  if (!discovery.recommended) {
    fail('Chrome not found on this system. Install Chrome and retry.');
    process.exit(1);
  }
  ok(`Chrome found: ${discovery.recommended.path} (source: ${discovery.recommended.source})`);
  info(`Total candidates scanned: ${discovery.all.length}`);

  // ------------------------------------------------------------------
  // Step 2: Create the manager
  // ------------------------------------------------------------------
  step('STEP 2: Initializing ProfileSessionManager');

  const allocator = new ChromePortAllocator({ portStart: 19300, portEnd: 19399 });
  manager = new ProfileSessionManager({
    portAllocator: allocator,
    chromePath: discovery.recommended.path,
  });

  // Relay all manager events to the console for observability
  manager.on('session:status', (snap) => {
    info(`[${snap.profileId.slice(-8)}] status → ${snap.displayName}: ${snap.status}`);
  });
  manager.on('session:auth_required', (id) => warn(`[${id.slice(-8)}] Auth required`));
  manager.on('session:ready', (id) => ok(`[${id.slice(-8)}] Ready for automation`));
  manager.on('session:error', (id, msg) => fail(`[${id.slice(-8)}] Error: ${msg}`));
  manager.on('session:crash', (id) => fail(`[${id.slice(-8)}] Chrome crashed`));

  ok('Manager initialized');

  // ------------------------------------------------------------------
  // Step 3: Create two profiles
  // ------------------------------------------------------------------
  step('STEP 3: Creating Two Profiles');

  const configA = await manager.createProfile({
    displayName: 'Test Account Alpha',
    notes: 'Phase 1 manual test profile A — delete me',
  });
  createdProfileIds.push(configA.profileId);

  const configB = await manager.createProfile({
    displayName: 'Test Account Beta',
    notes: 'Phase 1 manual test profile B — delete me',
  });
  createdProfileIds.push(configB.profileId);

  ok(`Profile A created: ${configA.profileId} (port ${configA.cdpPort})`);
  ok(`Profile B created: ${configB.profileId} (port ${configB.cdpPort})`);

  if (configA.cdpPort === configB.cdpPort) {
    fail('ISOLATION FAILURE: Both profiles were assigned the same CDP port!');
    process.exit(1);
  }
  ok(`Port isolation confirmed: A=${configA.cdpPort}, B=${configB.cdpPort}`);

  if (configA.userDataDir === configB.userDataDir) {
    fail('ISOLATION FAILURE: Both profiles share the same Chrome user data directory!');
    process.exit(1);
  }
  ok(`Data dir isolation confirmed`);

  // ------------------------------------------------------------------
  // Step 4: Start both Chrome instances
  // ------------------------------------------------------------------
  step('STEP 4: Launching Both Chrome Instances (visible windows)');
  info('Two Chrome windows will open. Do NOT close them manually.');

  const startBoth = Promise.allSettled([
    manager.startProfile(configA.profileId, false /* headless=false */),
    manager.startProfile(configB.profileId, false),
  ]);

  // Give Chrome 30 seconds to fully start and check auth
  info('Waiting up to 30s for both sessions to settle...');
  await startBoth;
  await delay(5000); // Extra time for auth check navigation

  const snapA = manager.getSession(configA.profileId)?.getSnapshot();
  const snapB = manager.getSession(configB.profileId)?.getSnapshot();

  if (!snapA || !snapB) {
    fail('One or both sessions did not start. Check logs.');
    await cleanup();
    process.exit(1);
  }

  ok(`Session A status: ${snapA.status}`);
  ok(`Session B status: ${snapB.status}`);

  if (snapA.status === 'error') {
    fail(`Session A failed: ${snapA.errorMessage}`);
  }
  if (snapB.status === 'error') {
    fail(`Session B failed: ${snapB.errorMessage}`);
  }

  // ------------------------------------------------------------------
  // Step 5: Verify page independence via Playwright
  // ------------------------------------------------------------------
  step('STEP 5: Verifying Playwright Page Independence');

  const sessionA = manager.getSession(configA.profileId);
  const sessionB = manager.getSession(configB.profileId);
  const pageA = sessionA?.getPage();
  const pageB = sessionB?.getPage();

  if (!pageA || !pageB) {
    warn('One or both pages are null — Chrome may not have launched successfully.');
  } else {
    // Navigate each to a unique URL and verify the pages are different objects
    try {
      await pageA.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await pageB.goto('https://google.com', { waitUntil: 'domcontentloaded', timeout: 15000 });

      const urlA = pageA.url();
      const urlB = pageB.url();

      if (urlA === urlB) {
        fail(`ISOLATION FAILURE: Both pages are at the same URL: ${urlA}`);
      } else {
        ok(`Page isolation confirmed — A: ${urlA.substring(0, 60)} | B: ${urlB.substring(0, 60)}`);
      }

      if (pageA === pageB) {
        fail('ISOLATION FAILURE: pageA and pageB are the SAME object reference!');
      } else {
        ok('Playwright Page object isolation confirmed (different references)');
      }
    } catch (err) {
      warn(`Page navigation test failed: ${err.message}`);
    }
  }

  // ------------------------------------------------------------------
  // Step 6: Uptime and status summary
  // ------------------------------------------------------------------
  step('STEP 6: Status Summary');

  for (const [label, snap] of [['A', snapA], ['B', snapB]]) {
    info(`Profile ${label}: ${snap.displayName}`);
    info(`  Status: ${snap.status}`);
    info(`  Email: ${snap.detectedEmail ?? '(not detected)'}`);
    info(`  Flow URL: ${snap.flowUrl ?? '(none)'}`);
    info(`  Uptime: ${snap.uptimeMs}ms`);
    info(`  Error: ${snap.errorMessage ?? 'none'}`);
  }

  // ------------------------------------------------------------------
  // Step 7: Shutdown both profiles
  // ------------------------------------------------------------------
  step('STEP 7: Shutting Down Both Sessions');

  await manager.stopAll();
  ok('Both sessions stopped');

  // Verify port release
  const portA = allocator.getPort(configA.profileId);
  const portB = allocator.getPort(configB.profileId);
  if (portA || portB) {
    warn(`Ports not fully released: A=${portA}, B=${portB}`);
  } else {
    ok('Both CDP ports released');
  }

  // ------------------------------------------------------------------
  // Step 8: Cleanup — delete test profiles
  // ------------------------------------------------------------------
  step('STEP 8: Cleaning Up Test Profiles');
  await cleanup();

  // ------------------------------------------------------------------
  // Final result
  // ------------------------------------------------------------------
  process.stderr.write('\n');
  ok('══════════════════════════════════════════════');
  ok('  Phase 1 Manual Test COMPLETE');
  ok('  Check the session logs in %LOCALAPPDATA%\\GoogleFlowApp\\logs\\');
  ok('══════════════════════════════════════════════');
}

async function cleanup() {
  if (!manager) return;
  for (const id of createdProfileIds) {
    try {
      await manager.deleteProfile(id);
      info(`Deleted test profile: ${id}`);
    } catch (err) {
      warn(`Could not delete profile ${id}: ${err.message}`);
    }
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Graceful Ctrl+C handling
// ---------------------------------------------------------------------------

process.on('SIGINT', async () => {
  warn('\nInterrupted. Cleaning up...');
  try {
    await manager?.stopAll();
    await cleanup();
  } catch { /* ignore */ }
  process.exit(130);
});

process.on('unhandledRejection', async (reason) => {
  fail(`Unhandled rejection: ${reason}`);
  try {
    await manager?.stopAll();
    await cleanup();
  } catch { /* ignore */ }
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

runTest().catch(async (err) => {
  fail(`Test failed: ${err.message}`);
  console.error(err.stack);
  try {
    await manager?.stopAll();
    await cleanup();
  } catch { /* ignore */ }
  process.exit(1);
});
