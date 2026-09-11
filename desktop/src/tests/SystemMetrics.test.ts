import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { IpcHandlers, type IpcMainLike } from '../main/ipc/IpcHandlers';
import type { SystemMetrics, ScriptParseResult } from '../shared/types';

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

describe('System Metrics & IPC Handlers (ZBot §4 Parity)', () => {
  let tmpBaseDir: string;
  const originalEnv = process.env['LOCALAPPDATA'];
  let mockIpc: MockIpcMain;
  let mockWebContents: { send: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-metrics-test-'));
    process.env['LOCALAPPDATA'] = tmpBaseDir;

    mockIpc = new MockIpcMain();
    mockWebContents = { send: vi.fn() };

    IpcHandlers.register(mockIpc, {
      scheduler: {} as any,
      sessionManager: { getAllProfiles: () => [] } as any,
      getWebContents: () => mockWebContents as any,
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpBaseDir, { recursive: true, force: true });
    } catch {}
    process.env['LOCALAPPDATA'] = originalEnv;
  });

  it('registers system:getSystemMetrics IPC channel', () => {
    expect(mockIpc.has('system:getSystemMetrics')).toBe(true);
  });

  it('returns valid CPU, RAM, and Ping telemetry metrics', async () => {
    const metrics = (await mockIpc.invoke('system:getSystemMetrics')) as SystemMetrics;

    expect(metrics).toBeDefined();
    expect(typeof metrics.cpuPercent).toBe('number');
    expect(metrics.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(metrics.cpuPercent).toBeLessThanOrEqual(100);

    expect(typeof metrics.totalMemMb).toBe('number');
    expect(metrics.totalMemMb).toBeGreaterThan(0);

    expect(typeof metrics.freeMemMb).toBe('number');
    expect(metrics.freeMemMb).toBeGreaterThanOrEqual(0);
    expect(metrics.freeMemMb).toBeLessThanOrEqual(metrics.totalMemMb);

    expect(typeof metrics.memPercent).toBe('number');
    expect(metrics.memPercent).toBeGreaterThanOrEqual(0);
    expect(metrics.memPercent).toBeLessThanOrEqual(100);

    expect(typeof metrics.pingMs).toBe('number');
    expect(metrics.pingMs).toBeGreaterThan(0);

    expect(typeof metrics.timestamp).toBe('string');
    expect(new Date(metrics.timestamp).getTime()).not.toBeNaN();
  });

  it('registers script:parseSeparateFiles IPC channel and processes input', async () => {
    expect(mockIpc.has('script:parseSeparateFiles')).toBe(true);

    const result = (await mockIpc.invoke('script:parseSeparateFiles', {
      promptsText: 'IMAGE 1: Majestic mountains under starry sky\nIMAGE 2: Deep pine forest in morning mist',
      narrationText: 'Scene 1: High above the peaks, stars illuminate the range.\nScene 2: Down in the valleys, mist rolls through the evergreens.',
      title: 'Alpine Journey',
    })) as ScriptParseResult;

    expect(result).toBeDefined();
    expect(result.scenes).toHaveLength(2);
    expect(result.title).toBe('Alpine Journey');
    expect(result.scenes[0].imagePrompt).toContain('Majestic mountains');
    expect(result.scenes[0].narration).toContain('High above the peaks');
  });
});
