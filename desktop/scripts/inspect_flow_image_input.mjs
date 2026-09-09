/**
 * inspect_flow_image_input.mjs
 * Inspects Google Flow DOM to discover image upload / attachment elements.
 * Read-only — DOES NOT CLICK GENERATE. Zero credits consumed.
 */
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const cfgMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/ProfileConfig.js')).href);
const sessMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/ProfileSession.js')).href);
const mgrMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/ProfileSessionManager.js')).href);

const { ProfileConfigManager } = cfgMod;
const { ProfileSessionManager } = mgrMod;

async function inspect() {
  const sessionManager = new ProfileSessionManager();
  const profiles = ProfileConfigManager.list();
  const heidiProfile = profiles.find(p => p.displayName.toLowerCase().includes('heidi') || p.profileId === 'profile_b75159bb');

  if (!heidiProfile) {
    console.error('Heidi profile not found');
    process.exit(1);
  }

  console.log('Connecting to Heidi profile:', heidiProfile.profileId, 'on port', heidiProfile.cdpPort);
  await sessionManager.startProfile(heidiProfile.profileId, { headless: false, background: true });
  const session = sessionManager.getSession(heidiProfile.profileId);
  const page = await session.createJobPage();

  console.log('Page loaded:', page.url());
  await page.waitForTimeout(4000);

  // Search for file inputs, attach buttons, image icons, etc.
  const domInfo = await page.evaluate(() => {
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map(el => ({
      tagName: el.tagName,
      id: el.id,
      className: el.className,
      accept: el.getAttribute('accept'),
      multiple: el.hasAttribute('multiple'),
      parentTag: el.parentElement?.tagName,
      parentClass: el.parentElement?.className,
    }));

    const buttonsWithIcons = Array.from(document.querySelectorAll('button')).map(b => ({
      text: b.innerText?.trim() || '',
      ariaLabel: b.getAttribute('aria-label') || '',
      title: b.getAttribute('title') || '',
      className: b.className,
      iconName: b.querySelector('mat-icon, [class*="icon"]')?.textContent?.trim() || '',
    })).filter(b => 
      b.ariaLabel.toLowerCase().includes('image') ||
      b.ariaLabel.toLowerCase().includes('upload') ||
      b.ariaLabel.toLowerCase().includes('attach') ||
      b.ariaLabel.toLowerCase().includes('add') ||
      b.ariaLabel.toLowerCase().includes('file') ||
      b.text.toLowerCase().includes('image') ||
      b.text.toLowerCase().includes('upload') ||
      b.text.toLowerCase().includes('attach') ||
      b.iconName.includes('add') ||
      b.iconName.includes('image') ||
      b.iconName.includes('upload') ||
      b.iconName.includes('attach')
    );

    return { fileInputs, buttonsWithIcons };
  });

  console.log('=== DOM INSPECTION RESULTS ===');
  console.log('File inputs:', JSON.stringify(domInfo.fileInputs, null, 2));
  console.log('Candidate image/upload buttons:', JSON.stringify(domInfo.buttonsWithIcons, null, 2));

  await session.closeJobPage(page);
  await sessionManager.stopAll();
}

inspect().catch(err => {
  console.error('Inspection failed:', err);
  process.exit(1);
});
