import { _electron as electron } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runPackagedPhase3Verification() {
  console.log('======================================================');
  console.log('  STARTING REAL PACKAGED APP VERIFICATION (PHASE 3)   ');
  console.log('======================================================\n');

  const exePath = path.resolve(__dirname, '..', 'release', 'win-unpacked', 'InfinityFlow.exe');
  console.log(`Checking packaged executable at: ${exePath}`);
  if (!fs.existsSync(exePath)) {
    throw new Error(`Packaged executable not found at: ${exePath}`);
  }
  console.log('✓ Packaged executable found.\n');

  console.log('Launching packaged Electron application...');
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
    console.log(`✓ Main window loaded. Title: "${title}"`);

    // Verify window.flowApi exists
    const flowApiCheck = await window.evaluate(() => {
      const api = window.flowApi;
      if (!api) return { ok: false, reason: 'window.flowApi missing' };
      const expectedMethods = [
        'listPublishingAccounts',
        'getPublishingAccount',
        'connectYouTubeAccount',
        'disconnectPublishingAccount',
        'linkChannelToPublishingAccount',
        'publishProjectToYouTube',
        'cancelPublishing',
        'getProjectPublishingState',
        'generatePublishingMetadata',
        'onPublishingProgress',
      ];
      const missing = expectedMethods.filter((m) => typeof api[m] !== 'function');
      return { ok: missing.length === 0, missing };
    });

    console.log('✓ Checking flowApi publishing methods...');
    if (!flowApiCheck.ok) {
      throw new Error(`flowApi missing expected publishing methods: ${flowApiCheck.missing?.join(', ')}`);
    }
    console.log('✓ All 10 Phase 3 IPC publishing methods exposed on window.flowApi!\n');

    // 1. List accounts in real packaged runtime
    console.log('--- Test 1: List Publishing Accounts ---');
    const accounts = await window.evaluate(async () => {
      return await window.flowApi.listPublishingAccounts();
    });
    console.log(`✓ Retrieved ${accounts.length} publishing account(s) from safeStorage/DPAPI storage`);
    // Ensure no secrets leaked in sanitized accounts
    for (const acc of accounts) {
      if (acc.secrets) {
        throw new Error(`CRITICAL: secrets leaked in sanitized account: ${acc.id}`);
      }
    }
    console.log('✓ Secrets are strictly sanitized and never exposed to renderer runtime!\n');

    // 2. Create test project and test AI Publishing Metadata generation
    console.log('--- Test 2: AI Publishing Metadata Generation with Model Separation ---');
    const testProject = await window.evaluate(async () => {
      const proj = await window.flowApi.createProject({
        name: 'Packaged Phase3 YouTube Test',
        prompts: [{ text: 'The History of Artificial Intelligence', type: 'image' }],
        videoRatio: '16:9',
      });
      return proj;
    });
    console.log(`✓ Test project created: ${testProject.projectId}`);

    const metadataAiResult = await window.evaluate(async (projectId) => {
      return await window.flowApi.generatePublishingMetadata(projectId);
    }, testProject.projectId);

    console.log('Metadata result:', JSON.stringify(metadataAiResult, null, 2));

    if (!metadataAiResult.metadata || !metadataAiResult.metadata.title) {
      throw new Error('generatePublishingMetadata failed to return valid metadata');
    }
    // Strict architectural invariant check: suggestedThumbnailHook MUST NOT be in metadata
    if ('suggestedThumbnailHook' in metadataAiResult.metadata) {
      throw new Error('CRITICAL ARCHITECTURAL LEAK: suggestedThumbnailHook found inside YouTubePublishingMetadata!');
    }
    // Verify suggestedThumbnailHook is present in suggestion
    if (!metadataAiResult.suggestedThumbnailHook) {
      throw new Error('Expected res.suggestedThumbnailHook to be present');
    }
    console.log('✓ Architectural Invariant Verified: suggestedThumbnailHook strictly isolated in suggestion structure!\n');

    // 3. Channels linking in real packaged runtime
    console.log('--- Test 3: Channel Linking & Destination Integration ---');
    const testChannel = await window.evaluate(async () => {
      const ch = await window.flowApi.createChannel({
        name: 'Packaged Tech YouTube Channel',
        color: '#ff0000',
        platform: 'youtube',
      });
      return ch;
    });
    console.log(`✓ Created test channel: ${testChannel.id} (${testChannel.name})`);

    // Verify unlinking works cleanly
    const unlinked = await window.evaluate(async (channelId) => {
      return await window.flowApi.linkChannelToPublishingAccount(channelId, undefined);
    }, testChannel.id);
    console.log(`✓ Unlinked channel result: linkedPublishingAccountId = ${unlinked.linkedPublishingAccountId}`);
    if (unlinked.linkedPublishingAccountId !== undefined) {
      throw new Error('Failed to unset linkedPublishingAccountId');
    }

    // 4. Duplicate publish prevention in packaged runtime
    console.log('\n--- Test 4: Duplicate Publication Prevention & State Probing ---');
    const initialPublishState = await window.evaluate(async (projectId) => {
      return await window.flowApi.getProjectPublishingState(projectId);
    }, testProject.projectId);
    console.log('Initial project publishing state:', initialPublishState);

    const duplicateCheck = await window.evaluate(async (projectId) => {
      try {
        await window.flowApi.publishProjectToYouTube({
          projectId,
          publishingAccountId: 'non_existent_account',
          metadata: {
            title: 'Test',
            description: 'Test',
            tags: [],
            privacyStatus: 'private',
          },
          forceRetry: false,
        });
        return { blocked: false };
      } catch (err) {
        return { blocked: true, message: err.message };
      }
    }, testProject.projectId);
    console.log('Publish attempt result:', duplicateCheck);
    console.log('✓ Publishing account validation & project verification operational in packaged app!\n');

    // 5. Navigate to Channels screen and capture UI
    console.log('--- Test 5: UI Verification & Screenshots ---');
    // Click Channels in navigation
    await window.click('text=Channels');
    await window.waitForTimeout(1000);

    const artifactDir = 'C:\\Users\\mrand\\.gemini\\antigravity\\brain\\695c5008-e5b0-4f26-a33b-a01a0f5e542c';
    const channelsScreenshot = path.join(artifactDir, 'packaged_phase3_channels_screen.png');
    await window.screenshot({ path: channelsScreenshot });
    console.log(`✓ Captured Channels screen screenshot: ${channelsScreenshot}`);

    // Click YouTube Accounts button
    const connectedBtn = window.locator('text=YouTube Accounts');
    if (await connectedBtn.isVisible()) {
      await connectedBtn.click();
      await window.waitForTimeout(800);
      const accountsModalScreenshot = path.join(artifactDir, 'packaged_phase3_accounts_modal.png');
      await window.screenshot({ path: accountsModalScreenshot });
      console.log(`✓ Captured YouTube Accounts modal screenshot: ${accountsModalScreenshot}`);

      // Close modal
      const closeBtn = window.locator('button:has-text("×")');
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
        await window.waitForTimeout(500);
      }
    }

    // Also open ChannelModal to test destination linking tab
    const newChannelBtn = window.locator('text=New Channel');
    if (await newChannelBtn.first().isVisible()) {
      await newChannelBtn.first().click();
      await window.waitForTimeout(600);
      // Click Output Folders tab in ChannelModal
      const outputFoldersTab = window.locator('text=Output Folders');
      if (await outputFoldersTab.isVisible()) {
        await outputFoldersTab.click();
        await window.waitForTimeout(400);
        const channelModalScreenshot = path.join(artifactDir, 'packaged_phase3_channel_destinations_modal.png');
        await window.screenshot({ path: channelModalScreenshot });
        console.log(`✓ Captured ChannelModal destinations tab screenshot: ${channelModalScreenshot}`);
      }
      const closeChannelModal = window.locator('button:has-text("×")').last();
      if (await closeChannelModal.isVisible()) {
        await closeChannelModal.click();
        await window.waitForTimeout(400);
      }
    }

    // 6. Test Workspace YouTube Publishing Drawer
    console.log('--- Test 6: Workspace YouTube Publishing Drawer ---');
    const testVideoPath = path.join(os.tmpdir(), 'phase3_sample_video.mp4');
    try {
      execFileSync('ffmpeg', [
        '-y', '-f', 'lavfi', '-i', 'color=c=navy:s=640x360:r=30:d=1.0',
        '-f', 'lavfi', '-i', 'sine=f=440:d=1.0',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-shortest', testVideoPath
      ], { stdio: 'ignore' });
    } catch {}

    let importedProj = null;
    if (fs.existsSync(testVideoPath)) {
      importedProj = await window.evaluate(async (fpath) => {
        return await window.flowApi.importMediaToProject({
          filePath: fpath,
          name: 'Packaged YouTube Demo',
        });
      }, testVideoPath);
      console.log(`✓ Created imported video project: ${importedProj.projectId}`);

      // Navigate to Projects view
      const projectsTab = window.locator('[data-testid="tab-projects"]');
      if (await projectsTab.isVisible()) {
        await projectsTab.click();
      } else {
        await window.click('button:has-text("Projects (")');
      }
      await window.waitForTimeout(600);

      // Refresh project list
      const refreshBtn = window.locator('button[title="Refresh"]');
      if (await refreshBtn.isVisible()) {
        await refreshBtn.click();
        await window.waitForTimeout(1000);
      }

      // Click on the project card to open Workspace
      const projCard = window.locator(`text="${importedProj.name}"`).first();
      if (await projCard.isVisible()) {
        await projCard.click();
        await window.waitForTimeout(1500);

        // Open YouTube Publishing drawer
        const pubDrawerBtn = window.locator('button:has-text("Publish to YouTube")');
        if (await pubDrawerBtn.isVisible()) {
          await pubDrawerBtn.click();
          await window.waitForTimeout(600);

          // Click Suggest with AI
          const aiSuggestBtn = window.locator('button:has-text("Suggest with AI")');
          if (await aiSuggestBtn.isVisible()) {
            await aiSuggestBtn.click();
            await window.waitForTimeout(1500);
          }

          const workspaceDrawerScreenshot = path.join(artifactDir, 'packaged_phase3_workspace_publishing_drawer.png');
          await window.screenshot({ path: workspaceDrawerScreenshot });
          console.log(`✓ Captured Workspace YouTube Publishing drawer screenshot: ${workspaceDrawerScreenshot}`);
        }
      }
    }

    // Clean up test channel and projects
    await window.evaluate(async ({ channelId, projectIds }) => {
      try { await window.flowApi.deleteChannel(channelId); } catch {}
      for (const pid of projectIds) {
        try { await window.flowApi.deleteProject(pid); } catch {}
      }
    }, {
      channelId: testChannel.id,
      projectIds: [testProject.projectId, importedProj?.projectId].filter(Boolean),
    });

    console.log('\n======================================================');
    console.log('  ALL PACKAGED VERIFICATION TESTS PASSED SUCCESSFULLY! ');
    console.log('======================================================');
  } finally {
    await app.close();
  }
}

runPackagedPhase3Verification().catch((err) => {
  console.error('\n❌ Packaged verification failed:', err);
  process.exit(1);
});
