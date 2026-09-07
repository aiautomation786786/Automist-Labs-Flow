/**
 * Tests for ChromePortAllocator.
 *
 * These tests use real TCP sockets to confirm port availability probing.
 * All tests run without Chrome, using only the Node.js net module.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as net from 'net';
import { ChromePortAllocator } from '../main/engine/ChromePortAllocator';

// Helper: Bind a real TCP server on a port to simulate occupation.
function occupyPort(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(port, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function releasePort(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('ChromePortAllocator', () => {
  let allocator: ChromePortAllocator;
  const TEST_PORT_START = 19222;
  const TEST_PORT_END = 19250;

  beforeEach(() => {
    allocator = new ChromePortAllocator({
      portStart: TEST_PORT_START,
      portEnd: TEST_PORT_END,
    });
  });

  afterEach(async () => {
    // Release all allocations
    for (const [profileId] of allocator.getAllocations()) {
      allocator.release(profileId);
    }
  });

  it('should allocate a port in the configured range', async () => {
    const port = await allocator.allocate('profile_test1');
    expect(port).toBeGreaterThanOrEqual(TEST_PORT_START);
    expect(port).toBeLessThanOrEqual(TEST_PORT_END);
  });

  it('should skip ports that are already in use', async () => {
    // Occupy the first port in range
    const occupied = await occupyPort(TEST_PORT_START);

    try {
      const port = await allocator.allocate('profile_test2');
      expect(port).toBeGreaterThan(TEST_PORT_START);
    } finally {
      await releasePort(occupied);
    }
  });

  it('should not assign the same port to two different profiles', async () => {
    const port1 = await allocator.allocate('profile_a');
    const port2 = await allocator.allocate('profile_b');
    expect(port1).not.toBe(port2);
  });

  it('should be idempotent: allocating for the same profile returns the same port', async () => {
    const port1 = await allocator.allocate('profile_idem');
    const port2 = await allocator.allocate('profile_idem');
    expect(port1).toBe(port2);
  });

  it('should release a port so it can be reused by another profile', async () => {
    const port1 = await allocator.allocate('profile_release_test');
    expect(allocator.size).toBe(1);

    allocator.release('profile_release_test');
    expect(allocator.size).toBe(0);
    expect(allocator.getPort('profile_release_test')).toBeNull();

    // A new allocation may now receive the same port (or a different one — both OK)
    const port2 = await allocator.allocate('profile_new');
    expect(port2).toBeGreaterThanOrEqual(TEST_PORT_START);
    void port1; // Not asserting port1 === port2; OS may keep it briefly
  });

  it('getPort should return null for unknown profiles', () => {
    expect(allocator.getPort('nonexistent_profile')).toBeNull();
  });

  it('getPort should return the allocated port for a known profile', async () => {
    const port = await allocator.allocate('profile_gp_test');
    expect(allocator.getPort('profile_gp_test')).toBe(port);
  });

  it('getAllocations should reflect current state', async () => {
    await allocator.allocate('profile_ga1');
    await allocator.allocate('profile_ga2');
    const allocs = allocator.getAllocations();
    expect(allocs.size).toBe(2);
    expect(allocs.has('profile_ga1')).toBe(true);
    expect(allocs.has('profile_ga2')).toBe(true);
  });

  it('size should track active allocations', async () => {
    expect(allocator.size).toBe(0);
    await allocator.allocate('profile_sz1');
    expect(allocator.size).toBe(1);
    await allocator.allocate('profile_sz2');
    expect(allocator.size).toBe(2);
    allocator.release('profile_sz1');
    expect(allocator.size).toBe(1);
  });

  it('should throw if constructed with invalid port range', () => {
    expect(() => new ChromePortAllocator({ portStart: 100, portEnd: 200 })).toThrow();
    expect(() => new ChromePortAllocator({ portStart: 9000, portEnd: 9000 })).toThrow();
    expect(() => new ChromePortAllocator({ portStart: 9200, portEnd: 9100 })).toThrow();
  });

  it('should throw if the entire port range is exhausted', async () => {
    // Use a range of exactly 2 ports (start < end required by constructor).
    // Allocate both, then verify the third allocation fails.
    const tightAllocator = new ChromePortAllocator({
      portStart: TEST_PORT_START + 20,
      portEnd: TEST_PORT_START + 21,
    });

    await tightAllocator.allocate('profile_first');
    await tightAllocator.allocate('profile_second');

    // Both ports are used; next allocation must fail
    await expect(tightAllocator.allocate('profile_third')).rejects.toThrow(
      'No free TCP port found'
    );
  });
});
