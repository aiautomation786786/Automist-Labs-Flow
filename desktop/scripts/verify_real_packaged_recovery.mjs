import { _electron as electron } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getChromeProcesses() {
  try {
    const out = execSync('powershell "Get-CimInstance Win32_Process -Filter \\"Name = \'chrome.exe\'\\" | Select-Object ProcessId, CommandLine | ConvertTo-Json"', { encoding: 'utf8' });
    const raw = JSON.parse(out);
    const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    const flowProcs = [];
    const personalProcs = [];
    for (const p of list) {
      if (p.CommandLine && p.CommandLine.includes('--remote-debugging-port')) {
        flowProcs.push(p);
      } else {
        personalProcs.push(p);
      }
    }
    return { flowProcs, personalProcs, total: list.length };
  } catch {
    return { flowProcs: [], personalProcs: [], total: 0 };
  }
}

async function main() {
  const exePath = path.resolve(__dirname, '..', 'release', 'win-unpacked', 'InfinityFlow.exe');
  console.log(`\n==================================================`);
  console.log(`TESTING PACKAGED INFINITY FLOW: ${exePath}`);
  console.log(`==================================================\n`);

  if (!fs.existsSync(exePath)) {
    throw new Error(`Packaged executable not found: ${exePath}`);
  }

  const initialChrome = getChromeProcesses();
  console.log(`Initial state before launching Infinity Flow:`);
  console.log(`  Total Chrome processes: ${initialChrome.total}`);
  console.log(`  Personal Chrome processes: ${initialChrome.personalProcs.length}`);
  console.log(`  Flow Chrome processes: ${initialChrome.flowProcs.length}`);

  console.log(`\nLaunching packaged Infinity Flow app...`);
  const app = await electron.launch({
    executablePath: exePath,
    args: ['--no-sandbox'],
    timeout: 45000,
  });

  try {
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(4000);

    const title = await window.title();
    console.log(`\nApp window loaded: "${title}"`);

    // 1. Audit Profiles via API
    const profiles = await window.evaluate(async () => {
      return await window.flowApi.listProfiles();
    });

    console.log(`\n=== 1. Flow Accounts Count: ${profiles.length} ===`);
    for (const p of profiles) {
      console.log(`Account: ${p.displayName}`);
      console.log(`  Profile ID: ${p.profileId}`);
      console.log(`  CDP Port:   ${p.cdpPort}`);
      console.log(`  Email:      ${p.detectedEmail || p.expectedEmail || 'none'}`);
      console.log(`  Mode:       ${p.connectionMode}`);
      console.log(`  Status:     ${p.status}`);
      console.log(`----------------------------------------`);
    }

    if (profiles.length !== 6) {
      throw new Error(`Expected exactly 6 canonical profiles, but found ${profiles.length}!`);
    }

    // Check ports and uniqueness
    const ports = profiles.map(p => p.cdpPort);
    const uniquePorts = new Set(ports);
    if (uniquePorts.size !== 6) {
      throw new Error(`Port conflict detected! Ports are not unique: ${JSON.stringify(ports)}`);
    }

    // Check canonical names
    const names = profiles.map(p => p.displayName);
    const duplicateNames = names.filter((item, index) => names.indexOf(item) !== index);
    if (duplicateNames.length > 0) {
      throw new Error(`Duplicate account display names detected: ${JSON.stringify(duplicateNames)}`);
    }

    console.log(`\n[PASS] Verified exactly 6 unique canonical accounts with unique ports:`);
    console.log(`       Ports: ${ports.sort().join(', ')}`);

    // 2. Navigate to Flow Accounts in UI and take screenshot
    console.log(`\nNavigating to Flow Accounts view in UI...`);
    const accountsNav = window.locator('button:has-text("Accounts"), button:has-text("Flow Accounts"), [data-screen="profiles"]').first();
    if (await accountsNav.isVisible()) {
      await accountsNav.click();
      await window.waitForTimeout(2000);
    }

    // 3. Test Verify Account on 3 distinct accounts
    const testTargets = profiles.slice(0, 3);
    console.log(`\n=== 2. Testing Verify Account on 3 accounts ===`);

    for (const target of testTargets) {
      console.log(`\nTesting Verify Account for: "${target.displayName}" (ID: ${target.profileId}, CDP: ${target.cdpPort})`);
      const verifyResult = await window.evaluate(async (id) => {
        return await window.flowApi.verifyAccount(id);
      }, target.profileId);

      console.log(`  Verify Result:`, JSON.stringify(verifyResult));
      console.log(`  Success:       ${verifyResult.success}`);
      console.log(`  Status:        ${verifyResult.status}`);
      console.log(`  Detected Email: ${verifyResult.detectedEmail}`);

      // Verify no duplicate profile was created by verification
      const afterProfiles = await window.evaluate(async () => {
        return await window.flowApi.listProfiles();
      });
      if (afterProfiles.length !== 6) {
        throw new Error(`Verification caused profile count to change to ${afterProfiles.length}!`);
      }
      console.log(`  Profiles count remained stable: ${afterProfiles.length}`);
    }

    // 4. Inspect Chrome processes while app is running
    const runningChrome = getChromeProcesses();
    console.log(`\n=== 3. Chrome Process Inspection ===`);
    console.log(`  Total Chrome processes: ${runningChrome.total}`);
    console.log(`  Personal Chrome processes: ${runningChrome.personalProcs.length}`);
    console.log(`  Flow Chrome processes: ${runningChrome.flowProcs.length}`);

    // Detail any Flow Chrome processes
    for (const fp of runningChrome.flowProcs) {
      const isRoot = !fp.CommandLine.includes('--type=');
      const type = isRoot ? 'ROOT_BROWSER' : (fp.CommandLine.match(/--type=([^\s]+)/)?.[1] || 'child');
      console.log(`    PID: ${fp.ProcessId}, Port in cmd: ${fp.CommandLine.match(/--remote-debugging-port=(\d+)/)?.[1] || 'unknown'}, Type: ${type}`);
    }

    // Ensure no duplicate Chrome root browser sessions exist for the same port
    const rootFlowProcs = runningChrome.flowProcs.filter(p => !p.CommandLine.includes('--type='));
    const activePorts = rootFlowProcs
      .map(p => p.CommandLine.match(/--remote-debugging-port=(\d+)/)?.[1])
      .filter(Boolean);
    const uniqueActivePorts = new Set(activePorts);
    if (activePorts.length !== uniqueActivePorts.size) {
      throw new Error(`Duplicate Chrome root browser sessions detected for the same port! Active ports: ${JSON.stringify(activePorts)}`);
    }
    console.log(`[PASS] Exactly ${uniqueActivePorts.size} active root Chrome browser session(s) on ports: ${Array.from(uniqueActivePorts).join(', ')}`);
    console.log(`[PASS] No duplicate Chrome sessions for any port!`);

    // 5. Capture screenshot of UI
    const screenshotPath = 'C:/Users/mrand/.gemini/antigravity/brain/695c5008-e5b0-4f26-a33b-a01a0f5e542c/flow_accounts_restored.png';
    await window.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`\n[PASS] Captured UI screenshot: ${screenshotPath}`);

  } finally {
    console.log(`\nClosing Infinity Flow...`);
    await app.close();
    await new Promise(r => setTimeout(r, 2000));
  }

  // 6. Post-close verification
  const finalChrome = getChromeProcesses();
  console.log(`\n=== 4. Post-Close State ===`);
  console.log(`  Total Chrome processes: ${finalChrome.total}`);
  console.log(`  Personal Chrome processes: ${finalChrome.personalProcs.length}`);
  console.log(`  Flow Chrome processes remaining: ${finalChrome.flowProcs.length}`);
  console.log(`\nALL REAL PACKAGED VERIFICATION CHECKS PASSED!\n`);
}

main().catch((err) => {
  console.error('\n[FATAL ERROR] Real packaged verification failed:', err);
  process.exit(1);
});
