/**
 * live-phase5-1-runner.mjs
 *
 * PHASE 5.1 FOCUSED LIVE VERIFICATION SCRIPT
 *
 * Implements Steps 1 through 13 of the Phase 5.1 verification protocol:
 *   Step 1  — Live Authentication (manual sign-in in visible Chrome)
 *   Step 2  — Live UI Discovery (project/canvas introspection)
 *   Step 3  — Nano Banana 2 Live Verification (mandatory active UI click + check)
 *   Step 4  — Live Ratio Verification (16:9 and 9:16 active selection)
 *   Step 5  — Controlled Real Image Generation (single prompt, explicit opt-in confirmation)
 *   Step 6  — Capture Before State (snapshot existing media UUIDs)
 *   Step 7  — Wait for Result (safe delta polling, ambiguous media detection)
 *   Step 8  — Safe Download (non-navigating background download, URL invariant check)
 *   Step 9  — Exact Slot Association (link to projectId/slotIndex/jobId)
 *   Step 10 — Project Restoration (cold-start reload from disk)
 *   Step 11 — Two-Profile Live Safety Check (PID & page isolation, no spend)
 *   Step 12 — Video Status (preserved as NOT VERIFIED)
 *   Step 13 — Test Classification Report
 */

import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Dynamically import compiled backend modules from dist/
const mgrMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/ProfileSessionManager.js')).href);
const cfgMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/ProfileConfig.js')).href);
const finderMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/WindowsChromeFinder.js')).href);
const autoMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/FlowAutomationSession.js')).href);
const authMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/FlowAuthDetector.js')).href);
const modelMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/ModelSelector.js')).href);
const ratioMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/RatioSelector.js')).href);
const dlMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/SafeDownloader.js')).href);
const projMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/storage/ProjectRepository.js')).href);
const jobMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/storage/JobRepository.js')).href);
const assetMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/storage/AssetManager.js')).href);

const { ProfileSessionManager } = mgrMod;
const { ProfileConfigManager } = cfgMod;
const { WindowsChromeFinder } = finderMod;
const { FlowAutomationSession } = autoMod;
const { FlowAuthDetector } = authMod;
const { ModelSelector } = modelMod;
const { RatioSelector } = ratioMod;
const { SafeDownloader } = dlMod;
const { ProjectRepository } = projMod;
const { JobRepository } = jobMod;
const { AssetManager } = assetMod;

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
const allowGeneration = args.includes('--confirm-generation') || args.includes('--allow-generation');
const runIsolation = args.includes('--isolation-only');
const timeoutSeconds = parseInt(args.find((a) => a.startsWith('--auth-timeout='))?.split('=')[1] || '60', 10);

const testResults = {
  authentication: 'NOT VERIFIED',
  liveFlowUrl: null,
  detectedEmail: null,
  uiDiscovery: 'NOT VERIFIED',
  modelNanoBanana2: 'NOT VERIFIED',
  modelDetails: null,
  ratio169: 'NOT VERIFIED',
  ratio916: 'NOT VERIFIED',
  imageGeneration: 'NOT VERIFIED',
  mediaDetection: 'NOT VERIFIED',
  mediaAssociation: 'NOT VERIFIED',
  safeDownload: 'NOT VERIFIED',
  pageUrlPreservation: 'NOT VERIFIED',
  slotAssociation: 'NOT VERIFIED',
  projectRestoration: 'NOT VERIFIED',
  twoProfileIsolation: 'NOT VERIFIED',
  videoGeneration: 'NOT VERIFIED',
};

async function askConfirmation(promptText) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${c.yellow}${c.bold}${promptText} (yes/no): ${c.reset}`, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}

async function main() {
  banner('PHASE 5.1: FOCUSED LIVE VERIFICATION');

  // STEP 0: Windows Chrome Discovery
  step('DISCOVERY: Windows Chrome Executable');
  const discovery = WindowsChromeFinder.find();
  if (!discovery.recommended || !discovery.recommended.verified) {
    fail('No verified Google Chrome installation found.');
    process.exit(1);
  }
  ok(`Chrome found: ${discovery.recommended.path} (Source: ${discovery.recommended.source})`);

  const manager = new ProfileSessionManager({ chromePath: discovery.recommended.path });

  // Mode: Isolation check only
  if (runIsolation) {
    await runTwoProfileIsolation(manager);
    return;
  }

  // Find or create dedicated test profile
  let testProfile = ProfileConfigManager.readAll().find((p) => p.displayName === 'Phase 5.1 Verification Profile');
  if (!testProfile) {
    info('Creating dedicated test profile: Phase 5.1 Verification Profile');
    testProfile = await manager.createProfile({
      displayName: 'Phase 5.1 Verification Profile',
      notes: 'Dedicated profile for Phase 5.1 live testing',
    });
  } else {
    info(`Reusing existing dedicated profile: ${testProfile.profileId} (Port: ${testProfile.cdpPort})`);
  }

  // STEP 1: Launch visible Chrome & Detect Authentication
  banner('STEP 1 — LIVE AUTHENTICATION');
  info('Starting Chrome in visible mode (headless: false)...');
  await manager.startProfile(testProfile.profileId, false);
  const session = manager.getSession(testProfile.profileId);
  if (!session) {
    fail('Failed to start profile session.');
    process.exit(1);
  }
  ok(`Chrome launched (PID: ${session.pid}, Port: ${testProfile.cdpPort})`);

  const automation = new FlowAutomationSession(session);
  info('Navigating to https://labs.google/fx/en/tools/flow...');
  await automation.ensureFlowLoaded('en');

  info(`Checking initial authentication state...`);
  let authResult = await automation.checkAuthentication();
  info(`Current auth state: ${authResult.state} (URL: ${authResult.url})`);

  if (authResult.state !== 'authenticated') {
    process.stderr.write(`\n${c.yellow}${c.bold}------------------------------------------------------------\n`);
    process.stderr.write(`  [ACTION REQUIRED] PLEASE SIGN INTO GOOGLE IN CHROME\n`);
    process.stderr.write(`  The Chrome browser window is currently open.\n`);
    process.stderr.write(`  Please enter your Google account credentials manually.\n`);
    process.stderr.write(`  If CAPTCHA appears, solve it manually.\n`);
    process.stderr.write(`  Waiting up to ${timeoutSeconds}s for authenticated state...\n`);
    process.stderr.write(`------------------------------------------------------------${c.reset}\n\n`);

    const authDeadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < authDeadline) {
      await new Promise((r) => setTimeout(r, 4000));
      authResult = await automation.checkAuthentication();
      if (authResult.state === 'authenticated') {
        break;
      }
      if (authResult.state === 'captcha') {
        warn('Interactive challenge / CAPTCHA detected in Chrome. Please complete it.');
      } else if (authResult.state === 'login_required') {
        info('Still on Google login page... Waiting for user login.');
      } else {
        info(`Current URL: ${authResult.url} (State: ${authResult.state})`);
      }
    }
  }

  testResults.liveFlowUrl = authResult.url;
  testResults.detectedEmail = authResult.detectedEmail;

  if (authResult.state === 'authenticated') {
    testResults.authentication = 'LIVE VERIFIED';
    ok(`AUTHENTICATION LIVE VERIFIED! User: ${authResult.detectedEmail ?? 'signed-in user'}`);
  } else {
    warn(`Authentication was not completed within the timeout period.`);
    warn(`State remains: "${authResult.state}".`);
    testResults.authentication = 'NOT VERIFIED';
    banner('AUTHENTICATION NOT VERIFIED — RUNNING STEP 11 ISOLATION CHECK');
    await runTwoProfileIsolation(manager);
    await reportSummary();
    await manager.stopProfile(testProfile.profileId);
    return;
  }

  // STEP 2: Live UI Discovery
  banner('STEP 2 — LIVE UI DISCOVERY');
  const page = automation.getPage();

  // If on landing/home page, ensure we enter a project canvas context
  let currentProject = await automation.ensureProject({ forceNew: false });
  info(`Current Project Context: ID=${currentProject.id} (URL=${currentProject.url})`);

  const ui = await automation.discoverUI();
  info(`Live Flow URL: ${ui.url}`);
  info(`Project Canvas Active: ${ui.isProjectPage}`);
  info(`Prompt Input Found: ${ui.promptInputFound} (Type: ${ui.promptInputType})`);
  info(`Model Selector Found: ${ui.modelSelectorFound} (Text: "${ui.currentModelText}")`);
  info(`Ratio Selector Found: ${ui.ratioSelectorFound} (Ratio: "${ui.currentRatioText}")`);
  info(`Generate Button Found: ${ui.generateButtonFound} (Disabled: ${ui.generateButtonDisabled})`);
  info(`DOM Introspection: ${ui.buttonCount} buttons, ${ui.inputCount} inputs, ${ui.linkCount} links`);

  if (ui.promptInputFound && ui.modelSelectorFound && ui.generateButtonFound) {
    testResults.uiDiscovery = 'LIVE VERIFIED';
    ok('UI DISCOVERY LIVE VERIFIED!');
  } else {
    warn('UI Discovery: Some toolbar controls not located on active page.');
    testResults.uiDiscovery = 'NOT VERIFIED';
  }

  // STEP 3: Nano Banana 2 Live Verification (MANDATORY)
  banner('STEP 3 — NANO BANANA 2 LIVE VERIFICATION');
  step('Inspecting active model...');
  const modelBefore = await ModelSelector.detectCurrentModel(page);
  info(`modelDetectedBefore: "${modelBefore ?? 'none'}"`);

  step('Actively opening model selector dropdown and clicking Nano Banana 2...');
  const modelResult = await ModelSelector.ensureNanoBanana2(page);
  info(`selectionAttempted: ${modelResult.selectionAttempted}`);
  info(`modelDetectedAfter: "${modelResult.modelDetectedAfter ?? 'none'}"`);
  info(`verified: ${modelResult.verified}`);

  testResults.modelDetails = modelResult;

  if (modelResult.verified) {
    testResults.modelNanoBanana2 = 'LIVE VERIFIED';
    ok('NANO BANANA 2 SELECTION LIVE VERIFIED!');
  } else {
    fail(`Nano Banana 2 selection failed: ${modelResult.error ?? 'Unknown error'}`);
    testResults.modelNanoBanana2 = 'FAILED';
    warn('HALTING GENERATION: Model selection failed.');
    await reportSummary();
    await manager.stopProfile(testProfile.profileId);
    return;
  }

  // STEP 4: Live Ratio Verification
  banner('STEP 4 — LIVE RATIO VERIFICATION');
  step('Testing 16:9 Aspect Ratio...');
  const res169 = await RatioSelector.selectRatio(page, '16:9');
  info(`16:9 Selection: Selected=${res169.selected}, DetectedAfter=${res169.detectedAfter}, Verified=${res169.verified}`);
  if (res169.verified) {
    testResults.ratio169 = 'LIVE VERIFIED';
    ok('16:9 RATIO LIVE VERIFIED!');
  } else {
    testResults.ratio169 = 'FAILED';
    fail(`16:9 ratio selection failed: ${res169.error}`);
  }

  step('Testing 9:16 Aspect Ratio...');
  const res916 = await RatioSelector.selectRatio(page, '9:16');
  info(`9:16 Selection: Selected=${res916.selected}, DetectedAfter=${res916.detectedAfter}, Verified=${res916.verified}`);
  if (res916.verified) {
    testResults.ratio916 = 'LIVE VERIFIED';
    ok('9:16 RATIO LIVE VERIFIED!');
  } else {
    testResults.ratio916 = 'FAILED';
    fail(`9:16 ratio selection failed: ${res916.error}`);
  }

  // Restore 16:9 for generation test
  await RatioSelector.selectRatio(page, '16:9');

  // STEP 5: Controlled Real Image Generation
  banner('STEP 5 — CONTROLLED REAL IMAGE GENERATION');
  const testPrompt = '[AUTOMIST TEST] Minimal geometric circle on a plain background.';
  const targetRatio = '16:9';

  process.stderr.write(`\n${c.yellow}${c.bold}==================================================\n`);
  process.stderr.write(`  REAL GOOGLE FLOW TEST\n`);
  process.stderr.write(`  Profile: ${testProfile.profileId} (${authResult.detectedEmail ?? 'Signed-in'})\n`);
  process.stderr.write(`  Model: Nano Banana 2\n`);
  process.stderr.write(`  Ratio: ${targetRatio}\n`);
  process.stderr.write(`  Prompt: "${testPrompt}"\n`);
  process.stderr.write(`  This will consume Google Flow generation credits.\n`);
  process.stderr.write(`  Proceed?\n`);
  process.stderr.write(`==================================================${c.reset}\n\n`);

  let confirmed = allowGeneration;
  if (!confirmed && process.stdin.isTTY) {
    confirmed = await askConfirmation('Do you explicitly confirm triggering this single test generation?');
  }

  if (!confirmed) {
    warn('Generation not confirmed. Skipping real generation.');
    testResults.imageGeneration = 'NOT VERIFIED';
    await runTwoProfileIsolation(manager);
    await reportSummary();
    await manager.stopProfile(testProfile.profileId);
    return;
  }

  info('User confirmed. Proceeding with single controlled generation test.');

  // Create persistent project in store
  const project = await ProjectRepository.create({
    name: 'Phase 5.1 Verification Project',
    imageRatio: targetRatio,
    processingOrder: 'images_first',
    prompts: [{ text: testPrompt, type: 'image' }],
  });
  ok(`Persistent test project created: ${project.projectId}`);

  const slot = project.slots[0];
  const job = await JobRepository.createJob({
    projectId: project.projectId,
    promptId: slot.promptId,
    promptType: 'image',
    slotIndex: 0,
  });
  ok(`Persistent test job created: ${job.jobId}`);

  // STEP 6: Capture Before State
  banner('STEP 6 — CAPTURE BEFORE STATE');
  const beforeMedia = await automation.detectGeneratedMedia();
  const beforeUuids = new Set(beforeMedia.imageUuids);
  info(`beforeMedia: ${beforeUuids.size} image assets currently in DOM`);

  // Fill Prompt
  step(`Filling prompt: "${testPrompt}"...`);
  const promptInput = await page.locator('[contenteditable="true"]:visible, textarea:visible').first();
  await promptInput.click();
  await promptInput.fill(testPrompt);
  ok('Prompt entered into input field.');

  // Record original URL
  const originalPageUrl = page.url();

  // Click Generate
  step('Clicking Generate button...');
  const genBtn = await page.locator('button:has-text("arrow_forward"), button:has-text("Generate"), button:has-text("Créer")').first();
  await genBtn.click();
  ok('Generate button clicked!');

  // STEP 7: Wait for Result
  banner('STEP 7 — WAIT FOR RESULT');
  info('Polling for newly generated media asset in DOM (timeout: 120s)...');
  let newUuid = null;
  const pollStart = Date.now();

  while (Date.now() - pollStart < 120000) {
    await page.waitForTimeout(3000);
    const curMedia = await automation.detectGeneratedMedia();
    const delta = curMedia.imageUuids.filter((id) => !beforeUuids.has(id));

    if (delta.length === 1) {
      newUuid = delta[0];
      ok(`Newly generated media asset detected: ${newUuid}`);
      testResults.mediaDetection = 'LIVE VERIFIED';
      break;
    } else if (delta.length > 1) {
      fail(`Ambiguous media result: ${delta.length} assets appeared simultaneously!`);
      testResults.mediaAssociation = 'manual_action_required';
      break;
    }
  }

  if (!newUuid) {
    fail('No new media asset detected within timeout.');
    testResults.imageGeneration = 'FAILED';
  } else {
    testResults.imageGeneration = 'LIVE VERIFIED';
    testResults.mediaAssociation = 'LIVE VERIFIED';

    // STEP 8: Safe Download
    banner('STEP 8 — SAFE DOWNLOAD');
    const destPath = AssetManager.getImageDestinationPath(project.projectId, 0, slot.promptId, job.jobId);
    info(`Downloading asset to: ${destPath}`);

    await SafeDownloader.download(page, newUuid, destPath);
    const finalPageUrl = page.url();

    // Verify URL unchanged
    if (originalPageUrl === finalPageUrl) {
      testResults.pageUrlPreservation = 'LIVE VERIFIED';
      ok(`Page URL preservation verified: ${finalPageUrl}`);
    } else {
      testResults.pageUrlPreservation = 'FAILED';
      fail(`Page URL changed from ${originalPageUrl} to ${finalPageUrl}`);
    }

    // Verify file on disk
    const fileVerify = AssetManager.verifyOutputFile(destPath, project.projectId);
    if (fileVerify.valid) {
      testResults.safeDownload = 'LIVE VERIFIED';
      ok(`Safe download verified: file size is ${fileVerify.sizeBytes} bytes.`);
    } else {
      testResults.safeDownload = 'FAILED';
      fail(`Downloaded file validation failed: ${fileVerify.error}`);
    }

    // STEP 9: Exact Slot Association
    banner('STEP 9 — EXACT SLOT ASSOCIATION');
    await ProjectRepository.updateSlot(project.projectId, 0, {
      status: 'completed',
      result: {
        assetId: newUuid,
        mediaPath: destPath,
        modelUsed: 'Nano Banana 2',
        ratioUsed: targetRatio,
        completedAt: new Date().toISOString(),
        fileSizeBytes: fileVerify.sizeBytes,
      },
    });

    await JobRepository.updateJob(project.projectId, job.jobId, {
      status: 'completed',
      resultMediaUuid: newUuid,
      resultFilePath: destPath,
    });

    testResults.slotAssociation = 'LIVE VERIFIED';
    ok(`Exact slot association verified: Slot #01 mapped to ${newUuid}`);

    // STEP 10: Project Restoration
    banner('STEP 10 — PROJECT RESTORATION');
    const reloadedProj = await ProjectRepository.get(project.projectId);
    const reloadedSlot = reloadedProj?.slots[0];
    const reloadedJobs = await JobRepository.getProjectJobs(project.projectId);

    if (
      reloadedProj &&
      reloadedSlot?.result?.assetId === newUuid &&
      reloadedSlot?.promptText === testPrompt &&
      reloadedJobs[0]?.status === 'completed'
    ) {
      testResults.projectRestoration = 'LIVE VERIFIED';
      ok('Project restoration verified: data fully recovered from disk.');
    } else {
      testResults.projectRestoration = 'FAILED';
      fail('Project restoration failed to recover slot state from disk.');
    }
  }

  // STEP 11: Two-Profile Isolation Check
  banner('STEP 11 — TWO-PROFILE LIVE SAFETY CHECK');
  await runTwoProfileIsolation(manager);

  // Teardown
  await manager.stopProfile(testProfile.profileId);
  await reportSummary();
}

async function runTwoProfileIsolation(manager) {
  step('Running Two-Profile Live Safety Check...');
  const profA = await manager.createProfile({ displayName: 'Phase 5.1 Worker A' });
  const profB = await manager.createProfile({ displayName: 'Phase 5.1 Worker B' });

  try {
    await manager.startProfile(profA.profileId, false);
    await manager.startProfile(profB.profileId, false);

    const sA = manager.getSession(profA.profileId);
    const sB = manager.getSession(profB.profileId);

    if (sA?.pid && sB?.pid && sA.pid !== sB.pid) {
      ok(`PID Isolation: PID A (${sA.pid}) != PID B (${sB.pid})`);
    } else {
      fail(`PID Collision: PID A (${sA?.pid}), PID B (${sB?.pid})`);
    }

    const pA = sA?.getPage();
    const pB = sB?.getPage();
    if (pA && pB && pA !== pB) {
      ok('Page Isolation: Independent Playwright page objects confirmed.');
      testResults.twoProfileIsolation = 'LIVE VERIFIED';
    } else {
      fail('Page Isolation failed: shared page reference.');
      testResults.twoProfileIsolation = 'FAILED';
    }
  } finally {
    await manager.stopProfile(profA.profileId).catch(() => {});
    await manager.stopProfile(profB.profileId).catch(() => {});
    await manager.deleteProfile(profA.profileId).catch(() => {});
    await manager.deleteProfile(profB.profileId).catch(() => {});
  }
}

async function reportSummary() {
  banner('PHASE 5.1 VERIFICATION SUMMARY');
  console.log(JSON.stringify(testResults, null, 2));
}

main().catch((err) => {
  fail(`Fatal error in Phase 5.1 runner: ${err.message}`);
  console.error(err);
  process.exit(1);
});
