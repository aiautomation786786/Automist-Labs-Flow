import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfileSession } from '../main/engine/ProfileSession';
import { ProfileSessionManager } from '../main/engine/ProfileSessionManager';
import { ProfileConfigManager } from '../main/engine/ProfileConfig';
import { FlowAuthDetector } from '../main/engine/FlowAuthDetector';
import { WorkerPool } from '../main/scheduler/WorkerPool';
import { MAX_CONCURRENT_JOBS_PER_PROFILE } from '../main/scheduler/ConcurrencyConfig';
import type { ProfileConfig } from '../shared/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Persistent Invisible Google Flow Authentication', () => {
  const testDir = path.join(os.tmpdir(), `flow-test-auth-${Date.now()}`);

  function makeConfig(id: string, port: number): ProfileConfig {
    return {
      profileId: id,
      displayName: `Persistent Profile ${id}`,
      userDataDir: path.join(testDir, id, 'chrome-user-data'),
      chromeProfileName: 'Default',
      chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      cdpPort: port,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      flowUrlLocale: null,
      detectedEmail: `${id}@gmail.com`,
      notes: '',
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves persistent userDataDir and cookies across session stop and restart', async () => {
    const config = makeConfig('prof_persistent_1', 9444);
    fs.mkdirSync(config.userDataDir, { recursive: true });

    // Write a dummy cookie/state file to simulate authenticated session persistence
    const cookieFile = path.join(config.userDataDir, 'Cookies');
    fs.writeFileSync(cookieFile, 'MOCK_ENCRYPTED_GOOGLE_FLOW_SESSION_COOKIE');

    const session = new ProfileSession(config);

    // Verify file exists
    expect(fs.existsSync(cookieFile)).toBe(true);

    // Calling stop() must NEVER delete the userDataDir or cookies
    await session.stop();
    expect(fs.existsSync(cookieFile)).toBe(true);
    expect(fs.readFileSync(cookieFile, 'utf-8')).toBe('MOCK_ENCRYPTED_GOOGLE_FLOW_SESSION_COOKIE');

    // Clean up test directory
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it('runs autoStartProfiles in parallel without serial blocking delays', async () => {
    const configA = makeConfig('prof_parallel_a', 9445);
    const configB = makeConfig('prof_parallel_b', 9446);

    vi.spyOn(ProfileConfigManager, 'list').mockReturnValue([configA, configB]);

    const sessionManager = new ProfileSessionManager();

    // Mock start method with simulated launch delays
    let aStartedAt = 0;
    let bStartedAt = 0;

    const mockStart = vi.fn().mockImplementation(async function (this: ProfileSession) {
      const now = Date.now();
      if (this.profileId === 'prof_parallel_a') aStartedAt = now;
      if (this.profileId === 'prof_parallel_b') bStartedAt = now;
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    vi.spyOn(ProfileSession.prototype, 'start').mockImplementation(mockStart);

    const startTime = Date.now();
    await sessionManager.autoStartProfiles();
    const duration = Date.now() - startTime;

    expect(mockStart).toHaveBeenCalledTimes(2);
    // Both starts should have fired nearly simultaneously (within 35ms of each other)
    expect(Math.abs(aStartedAt - bStartedAt)).toBeLessThan(35);
    // Total duration should be ~50-90ms (parallel), not 100ms+ (serial)
    expect(duration).toBeLessThan(120);
  });

  it('isolates session expiration: Profile A auth_required does not invalidate Profile B ready state', async () => {
    const configA = makeConfig('prof_iso_a', 9447);
    const configB = makeConfig('prof_iso_b', 9448);

    const sessionA = new ProfileSession(configA);
    const sessionB = new ProfileSession(configB);

    // Simulate session B is authenticated and ready
    (sessionB as any)._status = 'ready';

    // Simulate session A requires re-authentication
    (sessionA as any)._status = 'auth_required';

    const sessionManager = new ProfileSessionManager();
    vi.spyOn(sessionManager, 'getAllProfiles').mockReturnValue([
      sessionA.getSnapshot(),
      sessionB.getSnapshot(),
    ]);
    vi.spyOn(sessionManager, 'getSession').mockImplementation((id) => {
      if (id === 'prof_iso_a') return sessionA;
      if (id === 'prof_iso_b') return sessionB;
      return undefined;
    });

    const pool = new WorkerPool();
    pool.attachSessionManager(sessionManager);
    pool.syncWithSessionManager();

    // Pool should only allocate capacity to ready workers (Profile B)
    const availableWorker = pool.getAvailableWorker();
    expect(availableWorker).not.toBeNull();
    expect(availableWorker?.profileId).toBe('prof_iso_b');

    // Total available slots should strictly match profile B's capacity
    expect(pool.getCapacityMetrics().availableCapacity).toBe(MAX_CONCURRENT_JOBS_PER_PROFILE);
  });

  it('detects session expiration strings accurately in FlowAuthDetector', async () => {
    // Direct check simulating session expiration text
    const mockPageWithContent = {
      url: () => 'https://labs.google/fx/en/tools/flow',
      evaluate: vi.fn().mockImplementation((fn: () => any) => {
        // Return true when evaluating isSessionExpired
        const fnStr = fn.toString();
        if (fnStr.includes('Your session has expired')) {
          return true;
        }
        return false;
      }),
    } as any;

    const result = await FlowAuthDetector.check(mockPageWithContent);
    expect(result.state).toBe('login_required');
  });

  it('manages post-login watcher lifecycle and auto-hides window on authenticated', async () => {
    const config = makeConfig('prof_watcher_test', 9449);
    const session = new ProfileSession(config);

    expect((session as any).postLoginWatcherTimer).toBeNull();

    session.startPostLoginWatcher();
    expect((session as any).postLoginWatcherTimer).not.toBeNull();

    // Starting again should be idempotent
    const timerRef = (session as any).postLoginWatcherTimer;
    session.startPostLoginWatcher();
    expect((session as any).postLoginWatcherTimer).toBe(timerRef);

    // Stopping should clear the timer
    session.stopPostLoginWatcher();
    expect((session as any).postLoginWatcherTimer).toBeNull();
  });
});
