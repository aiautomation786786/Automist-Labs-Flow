/**
 * manual-live-flow-test.mjs
 *
 * Phase 5: Real Google Flow End-to-End Integration & Validation Script
 *
 * USAGE:
 *   node scripts/manual-live-flow-test.mjs --inspect-only
 *   node scripts/manual-live-flow-test.mjs --test-model-ratio
 *   node scripts/manual-live-flow-test.mjs --isolation-test
 *   node scripts/manual-live-flow-test.mjs --allow-generation
 *
 * SAFETY GUARANTEES:
 *   - NEVER consumes credits unless --allow-generation is explicitly supplied
 *     AND interactive confirmation is confirmed.
 *   - Uses dedicated application-managed profile (%LOCALAPPDATA%\GoogleFlowApp\profiles\).
 *   - Never accesses or modifies the user's personal Chrome profile.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Import compiled backend modules from dist/
let ProfileSessionManager, WindowsChromeFinder, FlowAutomationSession, ModelSelector, RatioSelector, SafeDownloader, ProjectRepository, JobRepository, AssetManager;

try {
  const mgrMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/ProfileSessionManager.js')).href);
  const finderMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/WindowsChromeFinder.js')).href);
  const autoMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/FlowAutomationSession.js')).href);
  const modelMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/ModelSelector.js')).href);
  const ratioMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/RatioSelector.js')).href);
  const dlMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/SafeDownloader.js')).href);
  const projMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/storage/ProjectRepository.js')).href);
  const jobMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/storage/JobRepository.js')).href);
  const assetMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/storage/AssetManager.js')).href);

  ProfileSessionManager = mgrMod.ProfileSessionManager;
  WindowsChromeFinder = finderMod.WindowsChromeFinder;
  FlowAutomationSession = autoMod.FlowAutomationSession;
  ModelSelector = modelMod.ModelSelector;
  RatioSelector = ratioMod.RatioSelector;
  SafeDownloader = dlMod.SafeDownloader;
  ProjectRepository = projMod.ProjectRepository;
  JobRepository = jobMod.JobRepository;
  AssetManager = assetMod.AssetManager;
} catch (err) {
  console.error('❌ Could not import compiled modules. Run "npm run build" in desktop/ first!');
  console.error(err.message);
  process.exit(1);
}

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
const allowGeneration = args.includes('--allow-generation');
const testModelRatio = args.includes('--test-model-ratio');
const isolationTest = args.includes('--isolation-test');
const inspectOnly = args.includes('--inspect-only') || (!allowGeneration && !testModelRatio && !isolationTest);

async function askConfirmation(promptText) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${c.yellow}${c.bold}${promptText} (yes/no): ${c.reset}`, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}

let manager = null;
const createdProfileIds = [];

async function cleanupProfiles() {
  if (!manager) return;
  for (const pid of createdProfileIds) {
    try {
      info(`Stopping and removing test profile: ${pid}`);
      await manager.stopProfile(pid);
      await manager.deleteProfile(pid);
    } catch {
      // Ignore cleanup error
    }
  }
}

async function runLiveValidation() {
  banner('PHASE 5: REAL GOOGLE FLOW INTEGRATION & VALIDATION');

  // STEP 1: Chrome Discovery
  step('STEP 1: Windows Chrome Discovery');
  const discovery = WindowsChromeFinder.find();
  if (!discovery.recommended || !discovery.recommended.verified) {
    fail('No verified Google Chrome executable found on this Windows system.');
    process.exit(1);
  }
  ok(`Chrome found and verified: ${discovery.recommended.path} (Source: ${discovery.recommended.source})`);

  manager = new ProfileSessionManager({ chromePath: discovery.recommended.path });

  // MODE: Two-Profile Real Isolation Test
  if (isolationTest) {
    banner('MODE: TWO-PROFILE REAL ISOLATION TEST');
    step('Launching Profile A and Profile B concurrently on separate ports...');

    const profA = await manager.createProfile({ displayName: 'Phase 5 Isolation Worker A' });
    createdProfileIds.push(profA.profileId);
    ok(`Profile A created: ${profA.profileId} (Port: ${profA.cdpPort})`);

    const profB = await manager.createProfile({ displayName: 'Phase 5 Isolation Worker B' });
    createdProfileIds.push(profB.profileId);
    ok(`Profile B created: ${profB.profileId} (Port: ${profB.cdpPort})`);

    // Verify port & directory separation
    if (profA.cdpPort === profB.cdpPort) {
      fail('Port collision detected between Profile A and Profile B!');
      await cleanupProfiles();
      process.exit(1);
    }
    if (profA.userDataDir === profB.userDataDir) {
      fail('User data directory collision detected between Profile A and Profile B!');
      await cleanupProfiles();
      process.exit(1);
    }
    ok('Port and directory separation verified: no collision.');

    info('Starting Profile A Chrome instance...');
    await manager.startProfile(profA.profileId, false);
    const sessionA = manager.getSession(profA.profileId);
    ok(`Profile A started (PID: ${sessionA?.pid}, Port: ${profA.cdpPort})`);

    info('Starting Profile B Chrome instance...');
    await manager.startProfile(profB.profileId, false);
    const sessionB = manager.getSession(profB.profileId);
    ok(`Profile B started (PID: ${sessionB?.pid}, Port: ${profB.cdpPort})`);

    if (!sessionA?.pid || !sessionB?.pid || sessionA.pid === sessionB.pid) {
      fail(`Process PID collision or invalid PID: PID A (${sessionA?.pid}), PID B (${sessionB?.pid})`);
      await cleanupProfiles();
      process.exit(1);
    }
    ok(`Process isolation verified: PID A (${sessionA.pid}) != PID B (${sessionB.pid})`);

    // Check Playwright pages
    const pageA = sessionA?.getPage();
    const pageB = sessionB?.getPage();
    if (!pageA || !pageB || pageA === pageB) {
      fail('Page isolation failed: Page objects are not independent!');
      await cleanupProfiles();
      process.exit(1);
    }
    ok('Playwright context and page isolation verified: independent Page objects.');

    // Concurrent navigation to Flow
    info('Concurrently navigating Profile A and Profile B to Google Flow...');
    const autoA = new FlowAutomationSession(sessionA);
    const autoB = new FlowAutomationSession(sessionB);

    await Promise.all([
      autoA.ensureFlowLoaded('en'),
      autoB.ensureFlowLoaded('en'),
    ]);
    ok('Concurrent navigation complete on both isolated profiles.');

    const [authA, authB] = await Promise.all([
      autoA.checkAuthentication(),
      autoB.checkAuthentication(),
    ]);
    info(`Profile A Auth State: ${authA.state} (${authA.url})`);
    info(`Profile B Auth State: ${authB.state} (${authB.url})`);

    await cleanupProfiles();
    banner('TWO-PROFILE ISOLATION TEST: PASSED (LIVE VERIFIED)');
    return;
  }

  // SINGLE-PROFILE WORKFLOW
  step('STEP 2: Creating Dedicated Test Profile');
  const profileConfig = await manager.createProfile({
    displayName: 'Phase 5 Live Validation Profile',
    notes: 'Dedicated test profile for live Flow inspection',
  });
  createdProfileIds.push(profileConfig.profileId);
  ok(`Dedicated test profile created: ${profileConfig.profileId} on port ${profileConfig.cdpPort}`);
  info(`Profile user data: ${profileConfig.userDataDir}`);

  step('STEP 3: Launching Visible Chrome Window');
  info('Starting Chrome with anti-detection flags...');
  await manager.startProfile(profileConfig.profileId, false);
  const session = manager.getSession(profileConfig.profileId);
  if (!session) {
    fail('Failed to retrieve active ProfileSession.');
    await cleanupProfiles();
    process.exit(1);
  }
  ok(`ProfileSession started. Status: ${session.status} (PID: ${session?.pid})`);

  step('STEP 4: Navigating to Google Flow');
  const automation = new FlowAutomationSession(session);
  info('Navigating to https://labs.google/fx/en/tools/flow...');
  await automation.ensureFlowLoaded('en');
  ok('Google Flow page loaded (domcontentloaded event received).');

  step('STEP 5: Authentication Detection');
  const authResult = await automation.checkAuthentication();
  info(`Auth Check Result: State="${authResult.state}", URL="${authResult.url}"`);

  if (authResult.state === 'authenticated') {
    ok(`AUTHENTICATED: Profile is signed into Google Flow! (${authResult.detectedEmail ?? 'email not displayed'})`);
  } else if (authResult.state === 'login_required') {
    warn('LOGIN REQUIRED: Profile is at the Google login wall.');
    warn('To test authenticated features, please sign into your Google account in the opened Chrome window.');
  } else if (authResult.state === 'captcha') {
    warn('CAPTCHA / SECURITY CHALLENGE: Interactive challenge detected.');
  }

  step('STEP 6: Live UI Discovery');
  const ui = await automation.discoverUI();
  info(`Live Flow URL: ${ui.url}`);
  info(`Page Context: ${ui.isProjectPage ? `Project Page (ID: ${ui.projectId})` : 'Landing / Dashboard Page'}`);
  info(`Prompt Input: found=${ui.promptInputFound} (type=${ui.promptInputType})`);
  info(`Model Selector: found=${ui.modelSelectorFound} (current="${ui.currentModelText ?? 'none'}")`);
  info(`Ratio Selector: found=${ui.ratioSelectorFound} (current="${ui.currentRatioText ?? 'none'}")`);
  info(`Generate Button: found=${ui.generateButtonFound} (disabled=${ui.generateButtonDisabled})`);
  info(`Page Metrics: ${ui.buttonCount} buttons, ${ui.inputCount} inputs, ${ui.linkCount} links`);

  // MODE: Model & Ratio Active Selection Test
  if (testModelRatio) {
    banner('MODE: ACTIVE MODEL & ASPECT RATIO SELECTION TEST');
    if (authResult.state !== 'authenticated') {
      warn('Notice: Active model/ratio selection requires being on an authenticated project canvas.');
    }

    step('Testing Nano Banana 2 Active Selection...');
    const modelResult = await automation.selectNanoBanana2();
    info(`Model Before: "${modelResult.modelDetectedBefore ?? 'none'}"`);
    info(`Selection Attempted: ${modelResult.selectionAttempted}`);
    info(`Model After: "${modelResult.modelDetectedAfter ?? 'none'}"`);
    info(`Verification Status: ${modelResult.verified ? c.green + 'VERIFIED' : c.yellow + 'NOT VERIFIED'}${c.reset}`);

    step('Testing 16:9 Aspect Ratio Selection...');
    const ratio169Result = await automation.selectRatio('16:9');
    info(`16:9 Result: Selected=${ratio169Result.selected}, Verified=${ratio169Result.verified}`);

    step('Testing 9:16 Aspect Ratio Selection...');
    const ratio916Result = await automation.selectRatio('9:16');
    info(`9:16 Result: Selected=${ratio916Result.selected}, Verified=${ratio916Result.verified}`);

    info('Safety confirmation: Zero generation clicks triggered.');
  }

  // MODE: Controlled Real Image Generation
  if (allowGeneration) {
    banner('MODE: CONTROLLED REAL IMAGE GENERATION (OPT-IN CONFIRMED)');

    if (authResult.state !== 'authenticated') {
      fail('Cannot run real generation: Profile is not in an authenticated state.');
      await cleanupProfiles();
      process.exit(1);
    }

    const testPrompt = '[AUTOMIST TEST] Minimal geometric circle on solid background';
    const testRatio = '16:9';

    process.stderr.write(`\n${c.yellow}${c.bold}====================================================\n`);
    process.stderr.write(`  TEST GENERATION DETAILS\n`);
    process.stderr.write(`  Model: Nano Banana 2\n`);
    process.stderr.write(`  Ratio: ${testRatio}\n`);
    process.stderr.write(`  Prompt: "${testPrompt}"\n`);
    process.stderr.write(`  Profile: ${profileConfig.profileId} (${authResult.detectedEmail ?? 'Active Session'})\n`);
    process.stderr.write(`====================================================${c.reset}\n`);
    process.stderr.write(`⚠ WARNING: This action will click Generate on Google Flow and may consume 1 credit.\n\n`);

    const confirmed = await askConfirmation('Do you explicitly confirm triggering this single test generation?');
    if (!confirmed) {
      warn('Generation aborted by user. Zero credits consumed.');
      await cleanupProfiles();
      return;
    }

    info('Proceeding with single controlled generation test...');
    // Create test project in persistent store
    const testProject = await ProjectRepository.create({
      name: 'Phase 5 Live Validation Project',
      imageRatio: testRatio,
      processingOrder: 'images_first',
      prompts: [{ text: testPrompt, type: 'image' }],
    });
    ok(`Test Project created: ${testProject.projectId}`);

    const preMedia = await automation.detectGeneratedMedia();
    const beforeUuids = new Set(preMedia.imageUuids);
    info(`Pre-generation media snapshot: ${beforeUuids.size} existing assets in DOM`);

    // Ensure model & ratio
    await automation.selectNanoBanana2();
    await automation.selectRatio(testRatio);

    // Enter prompt
    const page = automation.getPage();
    const promptInput = await page.locator('[contenteditable="true"]:visible, textarea:visible').first();
    await promptInput.fill(testPrompt);
    ok('Test prompt entered into input field.');

    // Click Generate
    const preGenUrl = page.url();
    const genBtn = await page.locator('button:has-text("arrow_forward"), button:has-text("Generate"), button:has-text("Créer")').first();
    await genBtn.click();
    ok('Generate button clicked!');

    // Poll for new asset
    info('Polling for new generated media asset in DOM...');
    let newUuid = null;
    const pollStart = Date.now();
    while (Date.now() - pollStart < 120000) {
      await page.waitForTimeout(3000);
      const curMedia = await automation.detectGeneratedMedia();
      const delta = curMedia.imageUuids.filter((id) => !beforeUuids.has(id));
      if (delta.length === 1) {
        newUuid = delta[0];
        ok(`Newly generated asset detected unambiguously: ${newUuid}`);
        break;
      } else if (delta.length > 1) {
        fail(`Ambiguous media result: ${delta.length} assets appeared simultaneously!`);
        break;
      }
    }

    if (!newUuid) {
      fail('Generation timed out or produced ambiguous result.');
    } else {
      // Safe download verification
      step('Safe Non-Navigating Download Verification');
      const destPath = AssetManager.getImageDestinationPath(testProject.projectId, 0, testProject.slots[0].promptId, 'job_live_01');
      await SafeDownloader.download(page, newUuid, destPath);

      // Verify page URL remained unchanged
      const postDlUrl = page.url();
      if (postDlUrl === preGenUrl) {
        ok(`Page URL preservation verified: ${postDlUrl} remained unchanged.`);
      } else {
        fail(`Page navigation violation! URL changed from ${preGenUrl} to ${postDlUrl}`);
      }

      // Verify file on disk
      const fileCheck = AssetManager.verifyOutputFile(destPath, testProject.projectId);
      if (fileCheck.valid) {
        ok(`Output file verified on disk: ${destPath} (${fileCheck.sizeBytes} bytes)`);
      } else {
        fail(`Output file verification failed: ${fileCheck.error}`);
      }

      // Update slot & persist
      await ProjectRepository.updateSlot(testProject.projectId, 0, {
        status: 'completed',
        result: {
          assetId: newUuid,
          mediaPath: destPath,
          modelUsed: 'Nano Banana 2',
          ratioUsed: testRatio,
          completedAt: new Date().toISOString(),
          fileSizeBytes: fileCheck.sizeBytes,
        },
      });
      ok('Slot #01 updated with completed media result.');

      // Test restoration
      step('Project Restoration Test');
      const restoredProject = await ProjectRepository.get(testProject.projectId);
      if (restoredProject?.slots[0]?.result?.assetId === newUuid) {
        ok('Project restoration verified: reloaded project accurately reflects completed slot.');
      } else {
        fail('Project restoration failed to reflect completed slot.');
      }
    }
  }

  // Clean shutdown
  step('Clean Shutdown & Teardown');
  await cleanupProfiles();
  ok('All test profiles stopped and cleaned up.');

  banner('PHASE 5 VALIDATION RUN COMPLETE');
}

runLiveValidation().catch(async (err) => {
  fail(`Live validation script encountered an error: ${err.message}`);
  console.error(err.stack);
  await cleanupProfiles();
  process.exit(1);
});
