import { _electron as electron } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const exePath = path.resolve(__dirname, '..', 'release', 'win-unpacked', 'InfinityFlow.exe');
  console.log(`Checking packaged app at: ${exePath}`);
  if (!fs.existsSync(exePath)) {
    throw new Error(`Executable not found: ${exePath}`);
  }

  const app = await electron.launch({
    executablePath: exePath,
    args: ['--no-sandbox'],
    timeout: 30000,
  });

  try {
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(3000);

    const title = await window.title();
    console.log(`App Window Title: "${title}"`);

    const profiles = await window.evaluate(async () => {
      return await window.flowApi.listProfiles();
    });

    console.log(`Discovered ${profiles.length} profiles:`);
    for (const p of profiles) {
      console.log(`- Profile: ${p.profileId} ("${p.displayName}")`);
      console.log(`  Status: ${p.status}, CDP: ${p.cdpPort}, Email: ${p.detectedEmail || p.expectedEmail || 'none'}`);
      console.log(`  Mode: ${p.connectionMode}`);
    }

    const metrics = await window.evaluate(async () => {
      return await window.flowApi.getCapacityMetrics();
    });
    console.log('\nInitial Capacity Metrics:');
    console.log(JSON.stringify(metrics, null, 2));

  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Error running profile check:', err);
  process.exit(1);
});
