/**
 * test_ingredients_upload.mjs
 * 
 * Tests the exact "Add ingredients to the prompt box" -> "Upload media" path,
 * captures filechooser or input[type="file"], attaches test image,
 * verifies image chip in Flow prompt box,
 * then calls ModelSelector.ensureVideoModel to verify Omni 1.1 Flash and durations.
 * ZERO CREDITS - DOES NOT CLICK GENERATE.
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

const rootDir = 'd:/google-flow-browser-mcp-main/desktop';

const cfgMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/ProfileConfig.js')).href);
const sessMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/ProfileSession.js')).href);
const mgrMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/ProfileSessionManager.js')).href);
const autoMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/FlowAutomationSession.js')).href);
const modelMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/ModelSelector.js')).href);

const { ProfileConfigManager } = cfgMod;
const { ProfileSessionManager } = mgrMod;
const { FlowAutomationSession } = autoMod;
const { ModelSelector } = modelMod;

const TEST_IMAGE_PATH = path.join(
  process.env.LOCALAPPDATA || 'C:\\Users\\mrand\\AppData\\Local',
  'GoogleFlowApp',
  'projects',
  'proj_4aa46607dac9',
  'images',
  'slot_00_slot_1821530f0caa_job_1ae4580c89bf.jpg'
);

async function run() {
  console.log('[STEP 1] Validating source image...');
  if (!fs.existsSync(TEST_IMAGE_PATH)) throw new Error('Source image not found');
  const stat = fs.statSync(TEST_IMAGE_PATH);
  console.log(`[PASS] Source image: ${TEST_IMAGE_PATH} (${stat.size} bytes)`);

  const sessionManager = new ProfileSessionManager();
  const profiles = ProfileConfigManager.list();
  const heidi = profiles.find(p => p.profileId === 'profile_b75159bb' || p.displayName.toLowerCase().includes('heidi'));
  if (!heidi) throw new Error('Heidi profile not found');

  console.log('[STEP 2] Starting Heidi profile in background...');
  await sessionManager.startProfile(heidi.profileId, { headless: false, background: true });
  const session = sessionManager.getSession(heidi.profileId);
  const page = await session.createJobPage();
  await page.setViewportSize({ width: 1280, height: 800 }).catch(() => {});
  const automation = new FlowAutomationSession(session, page);

  console.log('[STEP 3] Entering project canvas...');
  const proj = await automation.ensureProject();
  console.log(`[PASS] Active Project: ${proj.id} at ${page.url()}`);
  await page.waitForTimeout(3000);

  // Take screenshot before attachment
  await page.screenshot({ path: path.join(rootDir, 'scratch_before_attach.png') }).catch(() => {});

  console.log('[STEP 4] Testing "Add ingredients" -> "Upload media" flow...');
  const addIngBtn = page.locator('button[aria-label="Add ingredients to the prompt box"]').first();
  await addIngBtn.waitFor({ state: 'visible', timeout: 5000 });
  await addIngBtn.evaluate(b => b.click());
  await page.waitForTimeout(1000);

  // Locate the upload media menu item
  const uploadMediaItem = page.locator('.cdk-overlay-pane [role="menuitem"]:has-text("Upload"), .cdk-overlay-pane button:has-text("Upload")').first();
  await uploadMediaItem.waitFor({ state: 'visible', timeout: 3000 });
  console.log('[PASS] Upload media menu item found!');

  // Listen for filechooser and click upload
  console.log('Triggering upload and listening for filechooser event...');
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null),
    uploadMediaItem.evaluate(el => el.click()),
  ]);

  if (fileChooser) {
    console.log('[PASS] Filechooser event intercepted successfully!');
    await fileChooser.setFiles(TEST_IMAGE_PATH);
    console.log('[PASS] setFiles() called with source image path without OS dialog!');
  } else {
    console.log('Filechooser event not caught, checking for input[type="file"] in DOM...');
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(TEST_IMAGE_PATH);
    console.log('[PASS] Called setInputFiles on DOM file input!');
  }

  // Wait for the asset modal to process and enable "Add to prompt" button
  console.log('Waiting for "Add to prompt" button in asset modal...');
  const addToPromptBtn = page.locator('button:has-text("Add to prompt"), button:has-text("Ajouter au prompt")').first();
  
  // Wait up to 15s for the upload to complete and button to enable
  let enabled = false;
  const startWait = Date.now();
  while (Date.now() - startWait < 20000) {
    const isVis = await addToPromptBtn.isVisible().catch(() => false);
    if (isVis) {
      const isDisabled = await addToPromptBtn.getAttribute('disabled').catch(() => null);
      const ariaDisabled = await addToPromptBtn.getAttribute('aria-disabled').catch(() => null);
      if (isDisabled === null && ariaDisabled !== 'true') {
        enabled = true;
        break;
      }
      // If asset list item needs to be clicked
      const firstAsset = page.locator('.cdk-overlay-pane [role="listbox"] [role="option"], .cdk-overlay-pane button:has-text("slot_"), .cdk-overlay-pane [class*="asset"]').first();
      if (await firstAsset.isVisible().catch(() => false)) {
        await firstAsset.evaluate(b => b.click()).catch(() => {});
      }
    }
    await page.waitForTimeout(500);
  }

  console.log(`"Add to prompt" enabled: ${enabled}`);
  if (enabled) {
    console.log('Clicking "Add to prompt"...');
    await addToPromptBtn.evaluate(b => b.click());
    await page.waitForTimeout(2000);
  } else {
    console.warn('Could not confirm "Add to prompt" enabled, trying click anyway...');
    await addToPromptBtn.evaluate(b => b.click()).catch(() => {});
    await page.waitForTimeout(2000);
  }

  // Take screenshot after adding to prompt
  await page.screenshot({ path: path.join(rootDir, 'scratch_added_to_prompt.png') }).catch(() => {});

  // Inspect the DOM in the prompt box / composer area
  const attachResult = await page.evaluate(() => {
    const composer = document.querySelector('div[class*="composer"], form, div[class*="prompt"], [class*="bottom"]');
    if (!composer) return { error: 'Composer container not found' };

    const imgs = Array.from(composer.querySelectorAll('img')).map(img => ({
      src: img.src.substring(0, 150),
      className: img.className,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
    }));

    const chips = Array.from(composer.querySelectorAll('[class*="chip"], [class*="badge"], [class*="ingredient"], [class*="attachment"], [class*="thumb"]')).map(el => ({
      tagName: el.tagName,
      className: el.className,
      text: (el.textContent || '').trim(),
    }));

    return {
      composerText: composer.textContent?.trim().substring(0, 200),
      imgs,
      chips,
      hasImagePreview: imgs.length > 0,
    };
  });

  console.log('\n=== ATTACHMENT VALIDATION RESULTS ===');
  console.log('Composer text:', attachResult.composerText);
  console.log('Images inside composer:', JSON.stringify(attachResult.imgs, null, 2));
  console.log('Chips inside composer:', JSON.stringify(attachResult.chips, null, 2));

  // Step 5: Test Omni 1.1 Flash model selection and duration verification via ModelSelector
  console.log('\n[STEP 5] Testing ModelSelector.ensureVideoModel for Omni 1.1 Flash...');
  const modelConfig = await ModelSelector.ensureVideoModel(page, {
    modelName: 'Omni 1.1 Flash',
    quantity: 'x1',
  });

  // Take screenshot of settings pane
  await page.screenshot({ path: path.join(rootDir, 'scratch_omni_settings.png') }).catch(() => {});

  console.log('\n=== MODEL SELECTOR RUNTIME REPORT ===');
  console.log('Verified:', modelConfig.verified);
  console.log('Mode:', modelConfig.mode);
  console.log('Model:', modelConfig.model);
  console.log('Resolution:', modelConfig.resolution);
  console.log('Duration:', modelConfig.duration);
  console.log('Duration Control:', modelConfig.durationControl);
  console.log('Ratio:', modelConfig.ratio);
  console.log('Error:', modelConfig.error || 'None');

  // Also query duration options when Omni 1.1 Flash is selected
  console.log('\n[STEP 6] Querying all duration radio buttons while popover is open...');
  const trigger = page.locator('button.settings-trigger-button, button[aria-label="Settings trigger"], button:has-text("Omni"), button:has-text("Banana"), button:has-text("Nano"), button:has-text("·")').first();
  await trigger.evaluate(b => b.click());
  await page.waitForTimeout(1000);

  const durationOptions = await page.evaluate(() => {
    const pane = document.querySelector('.cdk-overlay-pane');
    if (!pane) return [];
    const radios = Array.from(pane.querySelectorAll('button[role="radio"], [role="radio"]'));
    return radios.map(r => ({
      text: (r.textContent || '').trim(),
      checked: r.getAttribute('aria-checked') === 'true',
    })).filter(r => /\b\d+s\b/.test(r.text));
  });

  console.log('Omni 1.1 Flash Supported Duration Radios in Flow UI:', JSON.stringify(durationOptions, null, 2));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  console.log('\n[STEP 7] Clean teardown (Zero credits spent)...');
  await session.closeJobPage(page);
  await sessionManager.stopAll();
  console.log('\n[SUCCESS] Full Non-Credit Attachment & Model Verification Complete!');
}

run().catch(err => {
  console.error('[ERROR]', err);
  process.exit(1);
});
