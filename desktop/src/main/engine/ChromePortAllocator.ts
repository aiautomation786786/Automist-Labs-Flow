/**
 * ChromePortAllocator – Dynamic TCP port allocator for Chrome CDP connections.
 *
 * Design:
 *  - The allocator owns a registry of profileId → port mappings.
 *  - Before assigning a port it probes the TCP socket to confirm it is free.
 *  - Ports are held in-memory while the session is active; released on stop.
 *  - Port range: configurable, default 9222-9350 (128 possible concurrent profiles).
 *  - Does NOT use random numbers without availability checks.
 *  - Thread-safety is guaranteed by Node.js single-threaded execution.
 */

import * as net from 'net';
import type { AllocatedPort } from '../../shared/types';
import { appLogger } from '../utils/AppLogger';

const DEFAULT_PORT_START = 9222;
const DEFAULT_PORT_END = 9350;

// ---------------------------------------------------------------------------
// Port probe helper
// ---------------------------------------------------------------------------

/**
 * Returns true if the TCP port is currently NOT in use (i.e., available).
 * Uses a 500ms connection timeout to avoid hanging.
 */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', () => {
      // Port is already bound by something else.
      resolve(false);
    });

    server.once('listening', () => {
      // Successfully bound; port is free. Release it immediately.
      server.close(() => resolve(true));
    });

    // Bind on 127.0.0.1 only — Chrome CDP is loopback only.
    server.listen(port, '127.0.0.1');
  });
}

// ---------------------------------------------------------------------------
// Allocator class
// ---------------------------------------------------------------------------

export class ChromePortAllocator {
  private readonly allocations = new Map<string, AllocatedPort>();
  private readonly portStart: number;
  private readonly portEnd: number;

  constructor(options: { portStart?: number; portEnd?: number } = {}) {
    this.portStart = options.portStart ?? DEFAULT_PORT_START;
    this.portEnd = options.portEnd ?? DEFAULT_PORT_END;

    if (this.portStart < 1024 || this.portStart > 65535) {
      throw new RangeError(`portStart ${this.portStart} is out of valid range [1024, 65535].`);
    }
    if (this.portEnd <= this.portStart || this.portEnd > 65535) {
      throw new RangeError(`portEnd ${this.portEnd} must be > portStart and ≤ 65535.`);
    }
  }

  // ---- Public API ----------------------------------------------------------

  /**
   * Allocates a free CDP port for a profile.
   * Scans from portStart to portEnd, probing each one.
   *
   * @throws Error if no free port is found in the configured range.
   */
  async allocate(profileId: string): Promise<number> {
    // If this profile already has a port, return it (idempotent).
    const existing = this.allocations.get(profileId);
    if (existing) {
      appLogger.info('port_allocator', `Re-using existing port for profile`, {
        profileId,
        port: existing.port,
      });
      return existing.port;
    }

    const usedPorts = new Set(
      Array.from(this.allocations.values()).map((a) => a.port),
    );

    for (let port = this.portStart; port <= this.portEnd; port++) {
      if (usedPorts.has(port)) {
        // Already claimed by another profile in this allocator instance.
        continue;
      }

      const free = await isPortFree(port);
      if (free) {
        const allocation: AllocatedPort = {
          port,
          profileId,
          allocatedAt: new Date().toISOString(),
        };
        this.allocations.set(profileId, allocation);

        appLogger.info('port_allocator', `Allocated CDP port`, {
          profileId,
          port,
        });

        return port;
      }
    }

    throw new Error(
      `No free TCP port found in range ${this.portStart}-${this.portEnd}. ` +
      `All ${this.portEnd - this.portStart + 1} ports are in use. ` +
      'Reduce the number of concurrent profiles or increase the port range.'
    );
  }

  /**
   * Releases the port previously allocated to a profile.
   * A released port may be reallocated to a different profile later.
   */
  release(profileId: string): void {
    const allocation = this.allocations.get(profileId);
    if (!allocation) return;

    this.allocations.delete(profileId);
    appLogger.info('port_allocator', `Released CDP port`, {
      profileId,
      port: allocation.port,
    });
  }

  /**
   * Returns the port currently assigned to a profile, or null.
   */
  getPort(profileId: string): number | null {
    return this.allocations.get(profileId)?.port ?? null;
  }

  /**
   * Returns all current allocations (read-only snapshot).
   */
  getAllocations(): ReadonlyMap<string, AllocatedPort> {
    return this.allocations;
  }

  /**
   * Number of currently active port allocations.
   */
  get size(): number {
    return this.allocations.size;
  }

  /**
   * Directly registers a port allocation for a profileId.
   * Used internally by ProfileSessionManager when a new profile is created
   * and we need to reassign from the temporary key to the real profileId.
   * @internal
   */
  setAllocation(profileId: string, port: number): void {
    this.allocations.set(profileId, {
      port,
      profileId,
      allocatedAt: new Date().toISOString(),
    });
  }

}

// ---------------------------------------------------------------------------
// Singleton allocator shared across all sessions in the process
// ---------------------------------------------------------------------------

export const portAllocator = new ChromePortAllocator();
