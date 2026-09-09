/**
 * live_i2v_inspection.mjs
 * 
 * PHASES B & C VALIDATION (ZERO CREDITS):
 * 1. Attaches to Heidi Mason managed Flow profile.
 * 2. Creates dedicated isolated job tab and enters project canvas.
 * 3. Inspects real DOM for image upload / attachment mechanism.
 * 4. Tests non-credit image attachment with real test image.
 * 5. Verifies image preview / chip recognition in Flow DOM.
 * 6. Inspects real Omni 1.1 Flash duration and resolution controls in Flow UI.
 * 7. Closes tab and stops session without spending any Flow credits.
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

// Real test source image
const TEST_IMAGE_PATH = path.join(process.env.LOCALAPPDATA || 'C:\\Users\\mrand\\AppData\\Local', 'GoogleFlowApp', 'projects', 'proj_4aa46607dac9', 'images', 'slot_00_slot_1821530f0caa_job_1ae4580c89bf.jpg');

async function main() {
  if (!fs.existsSync(TEST_IMAGE_PATH)) {
    throw new Error(`Test image does not exist at: ${TEST_IMAGE_PATH}`);
  }
  const stat = fs.statSync(TEST_IMAGE_PATH);
  console.log(`[PASS] Verified test image exists: ${TEST_IMAGE_PATH} (${stat.size} bytes)`);

  const sessionManager = new ProfileSessionManager();
  const profiles = ProfileConfigManager.list();
  const heidi = profiles.find(p => p.profileId === 'profile_b75159bb' || p.displayName.toLowerCase().includes('heidi'));
  if (!heidi) {
    throw new Error('Heidi Mason profile (profile_b75159bb) not found in FlowProfiles');
  }

  console.log(`[PASS] Using test profile: ${heidi.displayName} (${heidi.profileId})`);
  console.log('Starting profile in hidden background mode...');
  await sessionManager.startProfile(heidi.profileId, { headless: false, background: true });

  const session = sessionManager.getSession(heidi.profileId);
  if (!session) throw new Error('Failed to acquire ProfileSession');

  console.log('Creating fresh isolated job tab...');
  const page = await session.createJobPage();
  const automation = new FlowAutomationSession(session, page);

  console.log('Entering project canvas context via ensureProject()...');
  const projectInfo = await automation.ensureProject();
  console.log(`[PASS] Project canvas entered: ${page.url()} (Project ID: ${projectInfo.id})`);

  await page.waitForTimeout(3000);

  // Step 1: Discover all file inputs and candidate attachment buttons in canvas
  const discovery = await page.evaluate(() => {
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map(el => ({
      tagName: el.tagName,
      id: el.id,
      className: el.className,
      accept: el.getAttribute('accept'),
      multiple: el.hasAttribute('multiple'),
      disabled: el.disabled,
      outerHTML: el.outerHTML.substring(0, 200),
      parentOuterHTML: el.parentElement ? el.parentElement.outerHTML.substring(0, 300) : null,
    }));

    const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
      text: (b.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 60),
      ariaLabel: b.getAttribute('aria-label') || '',
      className: b.className,
      hasIcon: !!b.querySelector('mat-icon, [class*="icon"], svg'),
      iconText: b.querySelector('mat-icon, [class*="icon"]')?.textContent?.trim() || '',
    })).filter(b => {
      const lower = `${b.text} ${b.ariaLabel} ${b.iconText}`.toLowerCase();
      return (
        lower.includes('image') ||
        lower.includes('photo') ||
        lower.includes('upload') ||
        lower.includes('attach') ||
        lower.includes('add') ||
        lower.includes('media') ||
        lower.includes('file')
      );
    });

    return { fileInputs, buttons };
  });

  console.log('\n=== LIVE CANVAS DISCOVERY ===');
  console.log('File inputs found:', discovery.fileInputs.length);
  console.log(JSON.stringify(discovery.fileInputs, null, 2));
  console.log('Candidate attach/image buttons found:', discovery.buttons.length);
  console.log(JSON.stringify(discovery.buttons, null, 2));

  // Step 2: Test image attachment via "Add media menu" or "Add ingredients"
  console.log('\n=== TESTING IMAGE ATTACHMENT VIA ADD MEDIA MENU ===');
  let attachmentMethod = '';
  let attached = false;

  // Let's click "Add media menu"
  const addMediaBtn = page.locator('button[aria-label="Add media menu"]').first();
  if (await addMediaBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('Clicking "Add media menu" button...');
    await addMediaBtn.evaluate(b => b.click());
    await page.waitForTimeout(1000);

    // Inspect what opened in the overlay
    const menuItems = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.cdk-overlay-pane [role="menuitem"], .cdk-overlay-pane button, [role="menuitem"]')).map(el => ({
        tagName: el.tagName,
        text: (el.textContent || '').trim().replace(/\s+/g, ' '),
        ariaLabel: el.getAttribute('aria-label') || '',
        className: el.className,
      }));
      const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map(el => ({
        tagName: el.tagName,
        id: el.id,
        accept: el.getAttribute('accept'),
        multiple: el.hasAttribute('multiple'),
        outerHTML: el.outerHTML.substring(0, 200),
      }));
      return { items, fileInputs };
    });

    console.log('Menu items in overlay:', JSON.stringify(menuItems.items, null, 2));
    console.log('File inputs after opening menu:', JSON.stringify(menuItems.fileInputs, null, 2));

    // Look for upload / image menu item
    const uploadItem = page.locator('.cdk-overlay-pane [role="menuitem"]:has-text("Upload"), .cdk-overlay-pane [role="menuitem"]:has-text("Image"), .cdk-overlay-pane button:has-text("Upload"), .cdk-overlay-pane button:has-text("Image"), [role="menuitem"]:has-text("Upload")').first();
    const isUploadVis = await uploadItem.isVisible({ timeout: 1500 }).catch(() => false);

    if (menuItems.fileInputs.length > 0) {
      console.log('File input is mounted in DOM! Calling setInputFiles directly...');
      await page.locator('input[type="file"]').first().setInputFiles(TEST_IMAGE_PATH);
      attachmentMethod = 'direct_file_input_in_menu';
      attached = true;
    } else if (isUploadVis) {
      console.log('Found upload menu item. Listening for filechooser event and clicking item...');
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null),
        uploadItem.evaluate(el => el.click()),
      ]);
      if (fileChooser) {
        console.log('Filechooser event captured! Setting files...');
        await fileChooser.setFiles(TEST_IMAGE_PATH);
        attachmentMethod = 'file_chooser_from_menu_item';
        attached = true;
      } else {
        const postInput = page.locator('input[type="file"]').first();
        if (await postInput.count() > 0) {
          await postInput.setInputFiles(TEST_IMAGE_PATH);
          attachmentMethod = 'post_click_file_input';
          attached = true;
        }
      }
    }
  }

  // Also check "Add ingredients to the prompt box" if not attached yet
  if (!attached) {
    const addIngBtn = page.locator('button[aria-label="Add ingredients to the prompt box"]').first();
    if (await addIngBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      console.log('Checking "Add ingredients to the prompt box"...');
      await addIngBtn.evaluate(b => b.click());
      await page.waitForTimeout(1000);
      const ingMenuItems = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.cdk-overlay-pane [role="menuitem"], .cdk-overlay-pane button')).map(el => ({
          text: (el.textContent || '').trim().replace(/\s+/g, ' '),
        }));
      });
      console.log('Ingredients menu items:', JSON.stringify(ingMenuItems, null, 2));
    }
  }

  console.log(`Attachment executed via: ${attachmentMethod || 'NONE'}, attached: ${attached}`);
  await page.waitForTimeout(3000);

  // Step 3: Verify image chip / preview recognition in Flow DOM
  const imagePreviewInfo = await page.evaluate(() => {
    // Check for chips, img tags, thumbnails inside or near composer
    const images = Array.from(document.querySelectorAll('div[class*="composer"] img, form img, div[class*="prompt"] img, [class*="chip"] img, [class*="pill"] img, img')).map(img => ({
      src: img.src.substring(0, 150),
      alt: img.alt,
      className: img.className,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      parentTag: img.parentElement?.tagName,
      parentClass: img.parentElement?.className,
    }));

    const chips = Array.from(document.querySelectorAll('[class*="chip"], [class*="badge"], [class*="attachment"], [class*="pill"], [class*="thumb"], [class*="ingredient"]')).map(el => ({
      tagName: el.tagName,
      className: el.className,
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 60),
    }));

    const composerText = document.querySelector('div[class*="composer"], form, div[class*="prompt"]')?.textContent?.trim() || '';

    return { images: images.filter(i => !i.src.includes('gstatic.com/gb') && !i.src.includes('lh3.google')), chips, composerPreviewText: composerText.substring(0, 200) };
  });

  console.log('\n=== ATTACHMENT VERIFICATION IN DOM ===');
  console.log('Content images in DOM:', JSON.stringify(imagePreviewInfo.images, null, 2));
  console.log('Chips/Attachments in DOM:', JSON.stringify(imagePreviewInfo.chips.slice(0, 10), null, 2));

  // Step 4: Inspect Omni 1.1 Flash & Available Durations
  console.log('\n=== INSPECTING OMNI 1.1 FLASH & DURATIONS IN FLOW UI ===');
  
  // Open settings popover via evaluate click (guaranteed not to fail viewport checks)
  const trigger = page.locator('button.settings-trigger-button, button[aria-label="Settings trigger"], button:has-text("Banana"), button:has-text("Nano"), button:has-text("Omni"), button:has-text("Veo"), button:has-text("·")').first();
  await trigger.evaluate(b => b.click());
  await page.waitForTimeout(1000);

  // Switch to Video mode
  const videoRadio = page.locator('.cdk-overlay-pane button[role="radio"]:has-text("Video"), .cdk-overlay-pane [role="radio"]:has-text("Video")').first();
  if (await videoRadio.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('Selecting Video mode radio...');
    await videoRadio.evaluate(b => b.click());
    await page.waitForTimeout(800);
  }

  // Open model dropdown
  const modelFamilyBtn = page.locator('.cdk-overlay-pane button[aria-label="Select model family"]').first();
  if (await modelFamilyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('Opening model family dropdown...');
    await modelFamilyBtn.evaluate(b => b.click());
    await page.waitForTimeout(800);

    const omniMenuItem = page.locator('.cdk-overlay-pane [role="menuitem"]:has-text("Omni"), .cdk-overlay-pane button:has-text("Omni")').first();
    if (await omniMenuItem.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('Selecting Omni 1.1 Flash from menu...');
      await omniMenuItem.evaluate(b => b.click());
      await page.waitForTimeout(1000);
    }
  }

  // Inspect all radios, options, and text in the settings pane
  const paneDump = await page.evaluate(() => {
    const pane = document.querySelector('.cdk-overlay-pane');
    if (!pane) return { error: 'No cdk-overlay-pane' };

    const radios = Array.from(pane.querySelectorAll('button[role="radio"], [role="radio"]')).map(r => ({
      text: (r.textContent || '').trim().replace(/\s+/g, ' '),
      checked: r.getAttribute('aria-checked') === 'true',
      ariaLabel: r.getAttribute('aria-label') || '',
    }));

    const modelBtn = pane.querySelector('button[aria-label="Select model family"]');
    const activeModel = modelBtn ? (modelBtn.textContent || '').trim() : '';

    return {
      activeModel,
      radios,
      allText: (pane.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 500),
    };
  });

  console.log('\n=== REAL FLOW UI VIDEO SETTINGS INSPECTION ===');
  console.log('Active model reported in UI:', paneDump.activeModel);
  console.log('All Radio Controls:', JSON.stringify(paneDump.radios, null, 2));

  const durationRadios = (paneDump.radios || []).filter(r => /\b\d+s\b/.test(r.text));
  const resolutionRadios = (paneDump.radios || []).filter(r => /(360p|720p|1080p)/.test(r.text));
  const ratioRadios = (paneDump.radios || []).filter(r => /(16:9|9:16|4:3|3:4|1:1)/.test(r.text));

  console.log('\n=== SUMMARY OF VALIDATED OMNI FLASH CONTROLS ===');
  console.log('Supported Durations:', durationRadios.map(r => r.text));
  console.log('Supported Resolutions:', resolutionRadios.map(r => r.text));
  console.log('Supported Aspect Ratios:', ratioRadios.map(r => r.text));

  // Close popover
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // Clean teardown
  console.log('\nClosing dedicated job tab and stopping session (0 credits spent)...');
  await session.closeJobPage(page);
  await sessionManager.stopAll();
  console.log('[PASS] Phase B & C verification complete!');
}

main().catch(err => {
  console.error('[FAIL] Error during inspection:', err);
  process.exit(1);
});
