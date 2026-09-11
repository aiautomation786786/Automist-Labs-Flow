/**
 * Electron Main Process Entry Point.
 *
 * Responsibilities:
 *  - App lifecycle supervisor.
 *  - Secure custom protocol registration (`flow-asset://`) for local asset streaming.
 *  - Startup crash recovery via RecoveryManager.
 *  - Hardware & session initialization.
 *  - Window creation and secure preload binding.
 */

import { app, BrowserWindow, protocol, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { Readable } from 'stream';
import { ProfileSessionManager } from './engine/ProfileSessionManager';
import { WorkerPool } from './scheduler/WorkerPool';
import { GenerationScheduler } from './scheduler/GenerationScheduler';
import { RecoveryManager } from './storage/RecoveryManager';
import { AssetManager } from './storage/AssetManager';
import { IpcHandlers } from './ipc/IpcHandlers';
import { AppLogger } from './utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: true });

// Register privileged scheme before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'flow-asset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
let sessionManager: ProfileSessionManager | null = null;
let workerPool: WorkerPool | null = null;
let scheduler: GenerationScheduler | null = null;

function getAppIconPath(): string | undefined {
  const candidates = [
    path.join(__dirname, '../assets/infinity-flow.ico'),
    path.join(__dirname, '../../assets/infinity-flow.ico'),
    path.join(__dirname, '../assets/infinity-flow-mark.png'),
    path.join(__dirname, '../../assets/infinity-flow-mark.png'),
    path.join(__dirname, '../assets/icon.png'),
    path.join(__dirname, '../../assets/icon.png'),
    path.join(__dirname, '../assets/icon.ico'),
    path.join(__dirname, '../../assets/icon.ico'),
    path.join(process.resourcesPath, 'assets', 'infinity-flow.ico'),
    path.join(process.resourcesPath, 'assets', 'icon.ico'),
    path.join(process.resourcesPath, 'infinity-flow.ico'),
    path.join(process.resourcesPath, 'icon.ico'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return undefined;
}

async function createWindow(): Promise<void> {
  const iconPath = getAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: 'Infinity Flow',
    backgroundColor: '#0c0d12', // Dark background to prevent startup flash per ZBot §6/§14
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Preload needs IPC access
    },
  });

  // Remove default menu for clean desktop productivity UI
  mainWindow.setMenuBarVisibility(false);

  // In development, load from Vite dev server if available, else static build
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    const distHtml = path.join(__dirname, '../renderer/index.html');
    if (fs.existsSync(distHtml)) {
      await mainWindow.loadFile(distHtml);
    } else {
      // Fallback if built under dist root
      const fallbackHtml = path.join(__dirname, '../../renderer/index.html');
      if (fs.existsSync(fallbackHtml)) {
        await mainWindow.loadFile(fallbackHtml);
      } else {
        logger.error('main', `Could not find renderer index.html at ${distHtml}`);
      }
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerAssetProtocol(): void {
  // Protocol: flow-asset://project/{projectId}/{subPath} or flow-asset://{projectId}/{subPath}
  // Maps to: %LOCALAPPDATA%\GoogleFlowApp\projects\{projectId}\{subPath}
  protocol.handle('flow-asset', async (request) => {
    try {
      const url = new URL(request.url);
      const projectsRoot = path.resolve(AssetManager.getProjectsRootDir());
      let targetFilePath: string;

      if (url.host === 'project') {
        const relativePath = decodeURIComponent(url.pathname.replace(/^\//, ''));
        targetFilePath = path.resolve(path.join(projectsRoot, relativePath));
      } else if (url.host && url.host !== 'localhost' && !/^[a-zA-Z]$/.test(url.host)) {
        // host is projectId (e.g. flow-asset://proj_b121fc951973/images/img.jpg)
        const relativePath = path.join(decodeURIComponent(url.host), decodeURIComponent(url.pathname.replace(/^\//, '')));
        targetFilePath = path.resolve(path.join(projectsRoot, relativePath));
      } else if (/^[a-zA-Z]$/.test(url.host)) {
        // drive letter on Windows (e.g. flow-asset://C:/appdata/...)
        const full = decodeURIComponent(url.host + ':' + url.pathname);
        targetFilePath = path.resolve(full);
      } else {
        const relativePath = decodeURIComponent(url.pathname.replace(/^\//, ''));
        targetFilePath = path.resolve(path.join(projectsRoot, relativePath));
      }

      // Security check: strictly enforce path containment
      if (!targetFilePath.startsWith(projectsRoot)) {
        logger.warn('main', `flow-asset 403: access denied outside ${projectsRoot}`);
        return new Response('Not Found or Access Denied', { status: 404 });
      }

      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(targetFilePath);
      } catch {
        return new Response('Not Found', { status: 404 });
      }

      const fileSize = stat.size;
      const etag = `"${Math.round(stat.mtimeMs)}-${fileSize}"`;
      const ifNoneMatch = request.headers.get('if-none-match');

      if (ifNoneMatch === etag) {
        return new Response(null, {
          status: 304,
          headers: {
            'ETag': etag,
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }

      const ext = path.extname(targetFilePath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
      };
      const mimeType = mimeTypes[ext] || 'application/octet-stream';
      const rangeHeader = request.headers.get('range');

      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (isNaN(start) || start >= fileSize || end >= fileSize || start > end) {
          return new Response('Requested Range Not Satisfiable', {
            status: 416,
            headers: { 'Content-Range': `bytes */${fileSize}` },
          });
        }

        const chunkSize = end - start + 1;
        const nodeStream = fs.createReadStream(targetFilePath, { start, end });
        const webStream = Readable.toWeb(nodeStream) as ReadableStream;

        return new Response(webStream, {
          status: 206,
          statusText: 'Partial Content',
          headers: {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
            'Content-Type': mimeType,
            'ETag': etag,
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }

      const nodeStream = fs.createReadStream(targetFilePath);
      const webStream = Readable.toWeb(nodeStream) as ReadableStream;

      return new Response(webStream, {
        status: 200,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(fileSize),
          'Content-Type': mimeType,
          'ETag': etag,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    } catch (err) {
      logger.error('main', 'Error serving asset protocol', err as Error);
      return new Response('Internal Protocol Error', { status: 500 });
    }
  });
}

async function initializeApp(): Promise<void> {
  logger.info('main', 'Starting Infinity Flow Application...');

  // Step 1: Run crash recovery on stored projects
  try {
    const report = await RecoveryManager.recoverAll();
    logger.info('main', 'Cold-start crash recovery complete', report as unknown as Record<string, unknown>);
  } catch (err) {
    logger.warn('main', 'Recovery warning', { error: (err as Error).message });
  }

  // Step 2: Initialize Session Manager & Worker Pool
  try {
    sessionManager = new ProfileSessionManager();
    workerPool = new WorkerPool(sessionManager);
    scheduler = new GenerationScheduler(workerPool);

    // Register IPC handlers
    IpcHandlers.register(ipcMain, {
      scheduler,
      sessionManager,
      getWebContents: () => mainWindow?.webContents ?? null,
    });
  } catch (err) {
    logger.error('main', 'Failed to initialize core services', err as Error);
  }

  // Step 3: Register custom protocol
  registerAssetProtocol();

  // Step 4: Create UI window
  await createWindow();

  // Step 5: Automatically start & verify background Flow sessions
  if (sessionManager) {
    sessionManager.autoStartProfiles().catch((err) => {
      logger.warn('main', 'Background auto-start notice', { error: (err as Error).message });
    });
  }
}

// Single-instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(initializeApp).catch((err) => {
    logger.error('main', 'Fatal initialization error', err as Error);
  });

  app.on('before-quit', async () => {
    scheduler?.stop();
    if (sessionManager) {
      await sessionManager.stopAll().catch(() => {});
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      scheduler?.stop();
      if (sessionManager) {
        sessionManager.stopAll().catch(() => {});
      }
      app.quit();
    }
  });

  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow().catch((err) => {
        logger.error('main', 'Error activating window', err as Error);
      });
    }
  });
}
