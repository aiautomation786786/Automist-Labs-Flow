import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

const rootDir = 'd:/google-flow-browser-mcp-main/desktop';

const cfgMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/ProfileConfig.js')).href);
const mgrMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/ProfileSessionManager.js')).href);
const authMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/GeminiAuthDetector.js')).href);
const discMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/GeminiUIDiscovery.js')).href);
const driverMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/engine/GeminiDriver.js')).href);
const detectorMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/execution/GeminiImageWatermarkDetector.js')).href);
const cleanerMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/execution/GeminiImagePostProcessingService.js')).href);
const projMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/storage/ProjectRepository.js')).href);
const jobMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/storage/JobRepository.js')).href);
const assetMod = await import(pathToFileURL(path.join(rootDir, 'dist/main/storage/AssetManager.js')).href);

const { ProfileConfigManager } = cfgMod;
const { ProfileSessionManager } = mgrMod;
const { GeminiAuthDetector } = authMod;
const { GeminiUIDiscovery } = discMod;
const { GeminiDriver } = driverMod;
const { GeminiImageWatermarkDetector } = detectorMod;
const { GeminiImagePostProcessingService } = cleanerMod;
const { ProjectRepository } = projMod;
const { JobRepository } = jobMod;
const { AssetManager } = assetMod;

async function runLiveValidation() {
  console.log('================================================================');
  console.log('       INFINITY FLOW — GEMINI IMAGE LIVE VALIDATION RUNNER       ');
  console.log('================================================================');

  const sessionManager = new ProfileSessionManager();
  const profiles = ProfileConfigManager.list();
  console.log(`Discovered ${profiles.length} profiles.`);

  const targetProfile = profiles.find(p => p.profileId === 'profile_71b66ea2') || profiles.find(p => p.profileId === 'profile_b75159bb') || profiles[0];
  if (!targetProfile) {
    throw new Error('No profile available for validation!');
  }
  console.log(`Selected Profile: ${targetProfile.displayName} (${targetProfile.profileId})`);

  const slotsToTest = [
    {
      slotIndex: 0,
      ratio: '16:9',
      mode: 'gemini_single_image',
      prompt: 'A ceramic coffee mug on a wooden desk near a sunlit window, morning light, macro photography',
    },
    {
      slotIndex: 1,
      ratio: '16:9',
      mode: 'gemini_bulk_image',
      prompt: 'A golden retriever puppy sitting in green grass with soft sunset lighting, bokeh background',
    },
    {
      slotIndex: 2,
      ratio: '9:16',
      mode: 'gemini_bulk_image',
      prompt: 'A tall modern architectural glass skyscraper reaching towards a clear blue sky, low angle view',
    },
  ];

  console.log(`Creating validation project in ProjectRepository...`);
  const project = await ProjectRepository.create({
    name: 'Gemini Image Live Validation',
    provider: 'gemini',
    imageModel: 'Gemini Without Watermark',
    imageRatio: '16:9',
    generationMode: 'gemini_bulk_image',
    imageDownloadQuality: 'original',
    prompts: slotsToTest.map(s => ({
      type: 'image',
      text: s.prompt,
      provider: 'gemini',
    })),
    selectedProfileIds: [targetProfile.profileId],
  });

  const projectId = project.projectId;
  console.log(`Created validation project: ${projectId} with ${project.slots.length} slots.`);

  console.log(`Starting profile session for ${targetProfile.profileId}...`);
  await sessionManager.startProfile(targetProfile.profileId, { headless: false, background: false });

  const session = sessionManager.getSession(targetProfile.profileId);
  if (!session) {
    throw new Error(`Failed to acquire active session for ${targetProfile.profileId}`);
  }

  const results = [];

  try {
    for (let i = 0; i < slotsToTest.length; i++) {
      const item = slotsToTest[i];
      const slotEntity = project.slots[i];
      const promptId = slotEntity.promptId;

      console.log('\n----------------------------------------------------------------');
      console.log(`[SLOT ${item.slotIndex}] Mode: ${item.mode} | Ratio: ${item.ratio}`);
      console.log(`Prompt: "${item.prompt}"`);
      console.log('----------------------------------------------------------------');

      const promptDirective = item.ratio === '9:16'
        ? `Generate an image in 9:16 aspect ratio: ${item.prompt.trim()}`
        : `Generate an image in 16:9 aspect ratio: ${item.prompt.trim()}`;

      const job = await JobRepository.createJob({
        projectId,
        promptId,
        promptType: 'image',
        provider: 'gemini',
        slotIndex: item.slotIndex,
        metadata: {
          aspectRatio: item.ratio,
          imageModel: 'Gemini Without Watermark',
          generationMode: item.mode,
        },
      });
      const jobId = job.jobId;

      console.log(`Created job ${jobId} for Slot ${item.slotIndex}`);

      // Obey JobStateMachine
      await JobRepository.updateJob(projectId, jobId, { status: 'queued' });
      await JobRepository.updateJob(projectId, jobId, { status: 'assigned' });
      await JobRepository.updateJob(projectId, jobId, { status: 'starting' });
      await JobRepository.updateJob(projectId, jobId, { status: 'configuring' });
      await ProjectRepository.updateSlot(projectId, item.slotIndex, { status: 'running', activeJobId: jobId });

      console.log('Opening dedicated job tab...');
      const tabStart = Date.now();
      const page = await session.createJobPage('https://gemini.google.com/app');
      await page.waitForTimeout(3000);
      const tabInitMs = Date.now() - tabStart;

      // Auth & modals
      const auth = await GeminiAuthDetector.checkAuthentication(page);
      if (auth.state !== 'authenticated') {
        throw new Error(`Profile not authenticated (state=${auth.state})`);
      }
      await GeminiUIDiscovery.dismissKnownModals(page);

      // DOM snapshot before submit
      const beforeUrls = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('img')).map(i => i.currentSrc || i.src || '');
      });

      console.log(`Injecting directive: "${promptDirective}"`);
      await GeminiDriver.injectPrompt(page, promptDirective);

      await JobRepository.updateJob(projectId, jobId, { status: 'generating' });

      const genStartTime = Date.now();
      console.log('Submitting prompt to Gemini via GeminiDriver.submitGeneration...');
      await GeminiDriver.submitGeneration(page);

      console.log('Waiting for image completion in DOM...');
      const completion = await GeminiDriver.waitForImageCompletion(page, {
        timeoutMs: 120000,
        pollIntervalMs: 1200,
        beforeUrls,
        onProgress: (msg, pct) => {
          process.stdout.write(`\rProgress: ${pct}% - ${msg}          `);
        },
      });
      process.stdout.write('\n');
      const genDurationMs = Date.now() - genStartTime;
      console.log(`Generation completed in ${(genDurationMs / 1000).toFixed(1)}s. Image URL: ${completion.imageUrl.substring(0, 60)}...`);

      await JobRepository.updateJob(projectId, jobId, { status: 'downloading' });

      // Destination paths
      const destinationPath = AssetManager.getImageDestinationPath(projectId, item.slotIndex, promptId, jobId);
      const originalPath = destinationPath.replace(/(\.[\w\d]+)$/, '_original$1');
      const thumbnailPath = AssetManager.getThumbnailDestinationPath(projectId, item.slotIndex, promptId, jobId);

      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.mkdirSync(path.dirname(thumbnailPath), { recursive: true });

      // Download original image
      console.log('Extracting/downloading original image...');
      const dlStart = Date.now();
      await GeminiDriver.downloadImage(page, completion.imageUrl, originalPath);
      const dlDurationMs = Date.now() - dlStart;
      const originalStats = fs.statSync(originalPath);
      console.log(`Original image saved: ${originalPath} (${originalStats.size} bytes) in ${dlDurationMs}ms`);

      // Watermark post-processing
      console.log('Running Gemini watermark detection & localized cleaning...');
      const cleanStart = Date.now();
      const cleanRes = await GeminiImagePostProcessingService.cleanImageWatermark(
        originalPath,
        destinationPath,
        { ratio: item.ratio }
      );
      const cleanDurationMs = Date.now() - cleanStart;

      const finalStats = fs.statSync(cleanRes.cleanImagePath);
      console.log(`Post-processing complete in ${cleanDurationMs}ms:`);
      console.log(`  - Watermark cleaned: ${cleanRes.watermarkCleaned} (method: ${cleanRes.detectionMethod || 'none'}, confidence: ${cleanRes.confidence ?? 'n/a'})`);
      console.log(`  - Bounding box: ${JSON.stringify(cleanRes.boundingBox || null)}`);
      console.log(`  - Clean image path: ${cleanRes.cleanImagePath} (${finalStats.size} bytes)`);
      console.log(`  - Original preserved: ${cleanRes.originalImagePath} (${originalStats.size} bytes)`);

      // Generate thumbnail
      fs.copyFileSync(cleanRes.cleanImagePath, thumbnailPath);

      // Close tab
      await session.closeJobPage(page).catch(() => page.close().catch(() => {}));

      // Update Slot & Job to completed
      await ProjectRepository.updateSlot(projectId, item.slotIndex, {
        status: 'completed',
        result: {
          assetId: `gemini_image_${promptId}_${jobId}`,
          mediaPath: cleanRes.cleanImagePath,
          originalMediaPath: cleanRes.originalImagePath,
          watermarkCleaned: cleanRes.watermarkCleaned,
          thumbnailPath,
          provider: 'gemini',
          providerModel: 'Gemini Without Watermark',
          modelUsed: 'Gemini Without Watermark',
          ratioUsed: item.ratio,
          resolution: `${completion.width || 1024}x${completion.height || (item.ratio === '9:16' ? 1024 : 572)}`,
          completedAt: new Date().toISOString(),
          fileSizeBytes: finalStats.size,
          mimeType: 'image/png',
        },
      });

      await JobRepository.updateJob(projectId, jobId, {
        status: 'completed',
        outputPath: cleanRes.cleanImagePath,
        thumbnailPath,
        provider: 'gemini',
      });

      results.push({
        slotIndex: item.slotIndex,
        mode: item.mode,
        ratio: item.ratio,
        resolution: `${completion.width || 1024}x${completion.height || (item.ratio === '9:16' ? 1024 : 572)}`,
        genDurationSec: (genDurationMs / 1000).toFixed(1),
        dlDurationMs,
        cleanDurationMs,
        watermarkCleaned: cleanRes.watermarkCleaned,
        detectionMethod: cleanRes.detectionMethod || 'none',
        detectionConfidence: cleanRes.confidence ?? 0,
        cleanSize: finalStats.size,
        originalSize: originalStats.size,
        cleanPath: cleanRes.cleanImagePath,
        originalPath: cleanRes.originalImagePath,
      });
    }

    console.log('\n================================================================');
    console.log('            LIVE GEMINI VALIDATION EXECUTION SUMMARY            ');
    console.log('================================================================');
    console.table(results.map(r => ({
      Slot: r.slotIndex,
      Mode: r.mode,
      Ratio: r.ratio,
      Resolution: r.resolution,
      'Gen Time': `${r.genDurationSec}s`,
      'DL Time': `${r.dlDurationMs}ms`,
      'Clean Time': `${r.cleanDurationMs}ms`,
      'Watermark?': r.watermarkCleaned ? 'YES' : 'CLEAN (No W/M)',
      Method: r.detectionMethod,
      'Clean Size': `${(r.cleanSize / 1024).toFixed(1)} KB`,
      'Orig Size': `${(r.originalSize / 1024).toFixed(1)} KB`,
    })));

    const summaryPath = path.join(rootDir, 'scratch', 'live_gemini_image_validation_results.json');
    fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
    fs.writeFileSync(summaryPath, JSON.stringify({ projectId, timestamp: new Date().toISOString(), results }, null, 2));
    console.log(`\nDetailed validation results written to: ${summaryPath}`);

  } finally {
    console.log('Stopping profile session cleanly...');
    await sessionManager.stopProfile(targetProfile.profileId).catch(() => {});
    console.log('Profile session stopped.');
  }
}

runLiveValidation().catch(err => {
  console.error('\n*** LIVE VALIDATION FAILED ***', err);
  process.exit(1);
});
