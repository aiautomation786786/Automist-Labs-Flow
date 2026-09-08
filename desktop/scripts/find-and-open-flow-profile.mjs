/**
 * find-and-open-flow-profile.mjs
 *
 * Phase 5.2: Discovers an existing local Google Chrome profile matching a target
 * Google account identity, and optionally opens that profile visibly on Windows.
 *
 * USAGE:
 *   node scripts/find-and-open-flow-profile.mjs --account "AI Automation 786 786@gmail.com" --discover-only
 *   node scripts/find-and-open-flow-profile.mjs --account "AI Automation 786 786@gmail.com" --open
 *
 * SAFETY GUARANTEES:
 *   - Never hardcodes or assumes "Profile 3" or any numeric directory.
 *   - Never accesses, modifies, or prints cookies, passwords, or tokens.
 *   - Never modifies existing user profile files on disk.
 *   - Detects if the target profile is currently in use before launching.
 *   - Never consumes Google Flow generation credits.
 */

import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawn } from 'child_process';
import * as http from 'http';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Import compiled backend modules from dist/
const finderMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/WindowsChromeFinder.js')).href);
const discMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/LocalChromeProfileDiscoverer.js')).href);
const portMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/ChromePortAllocator.js')).href);
const authMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/FlowAuthDetector.js')).href);

const { WindowsChromeFinder } = finderMod;
const { LocalChromeProfileDiscoverer } = discMod;
const { ChromePortAllocator } = portMod;
const { FlowAuthDetector } = authMod;

const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
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
const banner = (msg) => {
  process.stderr.write(`\n${c.cyan}${c.bold}═══════════════════════════════════════════════════════════════════\n`);
  process.stderr.write(`  ${msg}\n`);
  process.stderr.write(`═══════════════════════════════════════════════════════════════════${c.reset}\n\n`);
};

// Parse command line arguments
const args = process.argv.slice(2);
let targetAccountArg = 'AI Automation 786 786@gmail.com';

const accountIdx = args.findIndex((a) => a === '--account' || a === '-a');
if (accountIdx !== -1 && args[accountIdx + 1]) {
  targetAccountArg = args[accountIdx + 1];
}

const openMode = args.includes('--open');
const discoverOnly = args.includes('--discover-only') || !openMode;

async function probePort(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function main() {
  banner('PHASE 5.2: LOCAL CHROME PROFILE DISCOVERY & LAUNCH');

  info(`Target Account Identity Hint: "${targetAccountArg}"`);
  info(`Execution Mode: ${openMode ? 'OPEN VISIBLE PROFILE' : 'DISCOVER-ONLY'}`);

  // 1. Discover Chrome Executable
  step('STEP 1: Windows Chrome Discovery');
  const chromeDiscovery = WindowsChromeFinder.find();
  if (!chromeDiscovery.recommended || !chromeDiscovery.recommended.verified) {
    fail('No verified Google Chrome executable found on this Windows system.');
    process.exit(1);
  }
  const chromePath = chromeDiscovery.recommended.path;
  ok(`Chrome executable: ${chromePath} (Source: ${chromeDiscovery.recommended.source})`);

  // 2. Discover Chrome User Data Directory
  step('STEP 2: Chrome User Data Directory Discovery');
  const userDataDir = LocalChromeProfileDiscoverer.discoverChromeUserDataDir();
  if (!userDataDir) {
    fail('Could not locate Google Chrome User Data directory.');
    process.exit(1);
  }
  ok(`Chrome User Data directory: ${userDataDir}`);

  // 3. Scan Local Profiles
  step('STEP 3: Profile Enumeration & Local Metadata Scanning');
  const profiles = LocalChromeProfileDiscoverer.scanProfiles(userDataDir);
  info(`Discovered ${profiles.length} local Chrome profile(s) in User Data:`);
  for (const p of profiles) {
    process.stderr.write(`   - [${p.profileDirectory}] Display: "${p.profileDisplayName}" | Account: ${p.accountEmail ?? 'none'} (${p.accountDisplayName ?? 'none'})\n`);
  }

  // 4. Match Target Account
  step('STEP 4: Target Google Account Matching');
  const matchResult = LocalChromeProfileDiscoverer.findMatchingProfile(profiles, {
    email: targetAccountArg,
    displayName: targetAccountArg,
  });

  if (matchResult.status === 'not_found') {
    fail('Target Google account profile was not found locally.');
    process.stderr.write(`\n${c.red}${c.bold}RESULT: No local profile matched "${targetAccountArg}".${c.reset}\n\n`);
    process.exit(1);
  }

  if (matchResult.status === 'multiple_matches') {
    fail(`Ambiguous match: ${matchResult.candidates.length} profiles matched target.`);
    for (const cand of matchResult.candidates) {
      process.stderr.write(`   - ${cand.profileDirectory}: ${cand.profileDisplayName} (${cand.accountEmail})\n`);
    }
    process.stderr.write(`\n${c.yellow}Disambiguation required. Halting execution without choosing arbitrarily.${c.reset}\n\n`);
    process.exit(1);
  }

  const matched = matchResult.match;
  ok(`Target profile matched unambiguously via ${matchResult.matchingMethod}!`);
  process.stderr.write(`\n${c.green}${c.bold}====================================================\n`);
  process.stderr.write(`  MATCHED LOCAL CHROME PROFILE\n`);
  process.stderr.write(`  Directory:    ${matched.profileDirectory}\n`);
  process.stderr.write(`  Display Name: ${matched.profileDisplayName}\n`);
  process.stderr.write(`  Account:      ${matched.accountEmail ?? 'N/A'}\n`);
  process.stderr.write(`  User Name:    ${matched.accountDisplayName ?? 'N/A'}\n`);
  process.stderr.write(`  Full Path:    ${matched.fullPath}\n`);
  process.stderr.write(`====================================================${c.reset}\n\n`);

  // 5. Check if profile is currently in use
  step('STEP 5: Checking Active Profile Lock & Running Processes');
  const inUseCheck = await LocalChromeProfileDiscoverer.isProfileInUse(userDataDir, matched.profileDirectory);
  if (inUseCheck.inUse) {
    warn(`Profile is currently in use by active Chrome process(es): PIDs [${inUseCheck.pids.join(', ')}]`);
    if (inUseCheck.details) {
      warn(inUseCheck.details);
    }
  } else {
    ok('Profile is not currently in use by another Chrome process.');
  }

  // If in discover-only mode, report and exit cleanly
  if (discoverOnly) {
    banner('DISCOVERY REPORT COMPLETE (--discover-only)');
    console.log(
      JSON.stringify(
        {
          chromeExecutable: chromePath,
          userDataDir,
          matchedProfileDirectory: matched.profileDirectory,
          profileDisplayName: matched.profileDisplayName,
          accountEmail: matched.accountEmail,
          accountDisplayName: matched.accountDisplayName,
          matchingMethod: matchResult.matchingMethod,
          inUse: inUseCheck.inUse,
          runningPids: inUseCheck.pids,
          cdpPortAvailable: inUseCheck.cdpPort ?? null,
        },
        null,
        2
      )
    );
    return;
  }

  // 6. Open Existing Profile Visibly
  banner('STEP 6: VISIBLE CHROME PROFILE LAUNCH');

  let activeCdpPort = inUseCheck.cdpPort;
  let chromeProcess = null;

  if (inUseCheck.inUse && !activeCdpPort) {
    warn('NOTICE: Chrome is already running using this profile without remote debugging enabled.');
    warn('To avoid interfering with existing Chrome sessions, the production application uses dedicated Flow profiles.');
    process.stderr.write(`\n${c.yellow}CRITICAL SAFETY RULE: Never forcibly terminate or hijack active user Chrome sessions.${c.reset}\n`);
    process.stderr.write(`Please use dedicated application-managed Flow profiles (%LOCALAPPDATA%\\AutomistLabs\\FlowProfiles) which run safely alongside normal Chrome.\n\n`);
    process.exit(1);
  }

  if (!activeCdpPort) {
    const portAllocator = new ChromePortAllocator();
    activeCdpPort = await portAllocator.allocate(matched.profileDirectory);
    ok(`Allocated unique CDP port: ${activeCdpPort}`);

    step(`Launching visible Chrome window for profile "${matched.profileDirectory}"...`);
    const effectiveUserDataDir = userDataDir;
    info(`User Data Directory: ${effectiveUserDataDir}`);
    const launchArgs = [
      `--user-data-dir=${effectiveUserDataDir}`,
      `--profile-directory=${matched.profileDirectory}`,
      `--remote-debugging-port=${activeCdpPort}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-crash-restore-bubble',
      '--disable-session-crashed-bubble',
      'https://labs.google/fx/en/tools/flow',
    ];

    chromeProcess = spawn(chromePath, launchArgs, {
      detached: true,
      stdio: 'ignore',
    });

    ok(`Chrome process spawned (PID: ${chromeProcess.pid})`);

    // Poll for CDP port to open
    info(`Waiting for CDP endpoint on port ${activeCdpPort}...`);
    let cdpReady = false;
    const startWait = Date.now();
    while (Date.now() - startWait < 15000) {
      await new Promise((r) => setTimeout(r, 500));
      if (await probePort(activeCdpPort)) {
        cdpReady = true;
        break;
      }
    }

    if (!cdpReady) {
      fail(`CDP port ${activeCdpPort} failed to open within timeout.`);
      process.exit(1);
    }
    ok(`CDP endpoint responsive on port ${activeCdpPort}`);
  } else {
    ok(`Attaching to existing active CDP endpoint on port ${activeCdpPort}`);
  }

  // 7. Attach Playwright via CDP
  step('STEP 7: Attaching Playwright via CDP');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${activeCdpPort}`);
  ok('Playwright attached successfully to Chrome browser session.');

  const contexts = browser.contexts();
  const context = contexts[0] || (await browser.newContext());
  const pages = context.pages();
  const page = pages[0] || (await context.newPage());
  ok(`Active page acquired (URL: ${page.url()})`);

  // 8. Navigate to Google Flow
  step('STEP 8: Verifying Google Flow Navigation');
  if (!page.url().includes('labs.google/fx')) {
    info('Navigating page to https://labs.google/fx/en/tools/flow...');
    await page.goto('https://labs.google/fx/en/tools/flow', { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  // Allow DOM rendering to settle
  await page.waitForTimeout(3000);
  ok(`Google Flow page active: ${page.url()}`);

  // 9. Detect Authentication State
  step('STEP 9: Detecting Authentication State on Existing Profile');
  const authStatus = await FlowAuthDetector.check(page);
  info(`Authentication State: "${authStatus.state}"`);
  if (authStatus.detectedEmail) {
    ok(`Signed-in Account Detected: ${authStatus.detectedEmail}`);
  }

  // 10. Verify Visible Window
  step('STEP 10: Windows-Native Visible Window Verification');
  const targetPid = chromeProcess?.pid || inUseCheck.pids[0];
  if (targetPid) {
    const winCheck = await LocalChromeProfileDiscoverer.verifyVisibleWindow(targetPid);
    if (winCheck.visible) {
      ok(`VISIBLE WINDOW CONFIRMED: ${winCheck.details}`);
    } else {
      warn(`Visible window check: ${winCheck.details}`);
    }
  }

  banner('PROFILE SUCCESSFULLY OPENED & ATTACHED');
  process.stderr.write(`\n${c.green}${c.bold}DIAGNOSTIC SUMMARY:${c.reset}\n`);
  console.log(
    JSON.stringify(
      {
        chromeExecutable: chromePath,
        userDataDir,
        matchedProfileDirectory: matched.profileDirectory,
        profileDisplayName: matched.profileDisplayName,
        matchedAccountIdentity: matched.accountEmail,
        cdpPort: activeCdpPort,
        chromePid: chromeProcess?.pid || inUseCheck.pids[0],
        flowUrl: page.url(),
        authenticationState: authStatus.state,
        detectedEmail: authStatus.detectedEmail,
      },
      null,
      2
    )
  );

  const exitAfterArg = args.find((a) => a.startsWith('--exit-after='));
  const exitAfterSeconds = exitAfterArg ? parseInt(exitAfterArg.split('=')[1], 10) : (args.includes('--auto-exit') ? 5 : 0);

  if (exitAfterSeconds > 0) {
    info(`Runner configured to exit in ${exitAfterSeconds}s...`);
    await new Promise((r) => setTimeout(r, exitAfterSeconds * 1000));
    ok('Runner test completed cleanly.');
    process.exit(0);
  }

  process.stderr.write(`\n${c.yellow}Press Ctrl+C to exit runner.${c.reset}\n\n`);

  // Keep runner alive so browser stays open and accessible
  await new Promise((resolve) => {
    process.on('SIGINT', () => {
      info('Exiting runner...');
      process.exit(0);
    });
  });
}

main().catch((err) => {
  fail(`Fatal error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
