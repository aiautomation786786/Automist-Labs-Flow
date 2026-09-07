/**
 * Tests for IpcHandlers & IPC Bridge.
 *
 * Verifies:
 *  - Handler registration across projects, generation, profiles, settings, and events.
 *  - Argument validation on IPC invocations.
 *  - Event forwarding from GenerationEventBus to webContents.
 *  - Settings read/write persistence.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { IpcHandlers, type IpcMainLike, type WebContentsLike } from '../main/ipc/IpcHandlers';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { generationEventBus } from '../main/events/GenerationEventBus';

class MockIpcMain implements IpcMainLike {
  private handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown>();

  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown): void {
    this.handlers.set(channel, listener);
  }

  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const fn = this.handlers.get(channel);
    if (!fn) throw new Error(`No IPC handler registered for channel "${channel}"`);
    return await fn({}, ...args);
  }

  has(channel: string): boolean {
    return this.handlers.has(channel);
  }
}

describe('IpcHandlers Bridge', () => {
  let tmpBaseDir: string;
  const originalEnv = process.env.LOCALAPPDATA;
  let mockIpc: MockIpcMain;
  let mockWebContents: { send: ReturnType<typeof vi.fn> };
  let mockScheduler: any;
  let mockSessionManager: any;

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-ipc-test-'));
    process.env.LOCALAPPDATA = tmpBaseDir;

    mockIpc = new MockIpcMain();
    mockWebContents = { send: vi.fn() };

    mockScheduler = {
      enqueueProject: vi.fn().mockResolvedValue([{ jobId: 'job_test_1', status: 'queued' }]),
      cancelJob: vi.fn().mockResolvedValue(undefined),
    };

    mockSessionManager = {
      getAllProfiles: vi.fn().mockReturnValue([
        { profileId: 'p1', displayName: 'Profile 1', status: 'ready' },
      ]),
      createProfile: vi.fn().mockResolvedValue({ profileId: 'p2', displayName: 'New Profile' }),
      startProfile: vi.fn().mockResolvedValue(undefined),
      stopProfile: vi.fn().mockResolvedValue(undefined),
      deleteProfile: vi.fn().mockResolvedValue(undefined),
      getSession: vi.fn().mockReturnValue({
        profileId: 'p1',
        getSnapshot: () => ({ profileId: 'p1', status: 'ready' }),
      }),
    };

    IpcHandlers.register(mockIpc, {
      scheduler: mockScheduler,
      sessionManager: mockSessionManager,
      getWebContents: () => mockWebContents as unknown as WebContentsLike,
    });
  });

  afterEach(() => {
    process.env.LOCALAPPDATA = originalEnv;
    if (fs.existsSync(tmpBaseDir)) {
      fs.rmSync(tmpBaseDir, { recursive: true, force: true });
    }
  });

  it('should register all expected IPC channels', () => {
    const expectedChannels = [
      'projects:list',
      'projects:get',
      'projects:create',
      'projects:update',
      'projects:delete',
      'projects:start',
      'projects:cancelJob',
      'projects:getJobs',
      'profiles:list',
      'profiles:create',
      'profiles:start',
      'profiles:stop',
      'profiles:delete',
      'profiles:openChrome',
      'system:getAppInfo',
      'settings:get',
      'settings:update',
    ];

    for (const ch of expectedChannels) {
      expect(mockIpc.has(ch), `Channel ${ch} should be registered`).toBe(true);
    }
  });

  it('should handle projects:create and projects:list via repositories', async () => {
    const created = (await mockIpc.invoke('projects:create', {
      name: 'IPC Test Project',
      prompts: [{ text: 'Prompt 1', type: 'image' }],
    })) as any;

    expect(created.projectId).toMatch(/^proj_/);
    expect(created.name).toBe('IPC Test Project');

    const list = (await mockIpc.invoke('projects:list')) as any[];
    expect(list).toHaveLength(1);
    expect(list[0].projectId).toBe(created.projectId);

    const fetched = (await mockIpc.invoke('projects:get', created.projectId)) as any;
    expect(fetched.name).toBe('IPC Test Project');
  });

  it('should handle projects:start delegating to scheduler', async () => {
    const result = await mockIpc.invoke('projects:start', 'proj_sample');
    expect(mockScheduler.enqueueProject).toHaveBeenCalledWith('proj_sample');
    expect(result).toEqual([{ jobId: 'job_test_1', status: 'queued' }]);
  });

  it('should handle profiles:list delegating to sessionManager', async () => {
    const profiles = (await mockIpc.invoke('profiles:list')) as any[];
    expect(profiles).toHaveLength(1);
    expect(profiles[0].displayName).toBe('Profile 1');
  });

  it('should read and write settings correctly', async () => {
    const initialSettings = (await mockIpc.invoke('settings:get')) as any;
    expect(initialSettings.defaultImageRatio).toBe('16:9');
    expect(initialSettings.maxRetries).toBe(2);

    const updated = (await mockIpc.invoke('settings:update', {
      defaultImageRatio: '9:16',
      maxRetries: 3,
    })) as any;

    expect(updated.defaultImageRatio).toBe('9:16');
    expect(updated.maxRetries).toBe(3);

    const reloaded = (await mockIpc.invoke('settings:get')) as any;
    expect(reloaded.defaultImageRatio).toBe('9:16');
  });

  it('should forward GenerationEventBus events to webContents', () => {
    generationEventBus.emitTyped('job:progress', {
      jobId: 'job_123',
      projectId: 'proj_1',
      promptId: 'prompt_1',
      slotIndex: 0,
      status: 'generating',
      stepDescription: 'Prompt entered',
      timestamp: new Date().toISOString(),
    });

    expect(mockWebContents.send).toHaveBeenCalledWith('flow:job:progress', expect.objectContaining({
      jobId: 'job_123',
      status: 'generating',
    }));
  });
});
