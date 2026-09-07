/**
 * FileMutex – In-process async serialization lock for file and resource operations.
 *
 * Prevents race conditions and lost updates when multiple workers concurrently
 * read, modify, and write persistent JSON files (e.g. project.json, jobs.json).
 *
 * Guarantees:
 *  - Calls with the same key execute strictly sequentially in FIFO order.
 *  - Calls with different keys execute concurrently without blocking each other.
 *  - Safe against promise rejections (lock is always released in finally block).
 */

export class FileMutex {
  private queues: Map<string, Promise<unknown>> = new Map();

  /**
   * Executes an asynchronous task exclusively for a given resource key.
   * If another operation is currently executing for the same key, this task
   * waits until the previous operation completes before executing.
   *
   * @param key   Unique key identifying the resource (e.g., project directory or file path)
   * @param task  The async operation to execute
   */
  async runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    const currentQueue = this.queues.get(key) ?? Promise.resolve();

    let resolveOperation!: () => void;
    const operationPromise = new Promise<void>((resolve) => {
      resolveOperation = resolve;
    });

    // Chain the new task onto the queue for this key
    const newQueue = currentQueue.then(async () => {
      try {
        return await task();
      } finally {
        resolveOperation();
      }
    });

    this.queues.set(key, newQueue);

    try {
      return await newQueue;
    } finally {
      // If no other operations are pending, clean up the map entry
      operationPromise.then(() => {
        if (this.queues.get(key) === newQueue) {
          this.queues.delete(key);
        }
      });
    }
  }

  /**
   * Returns true if there is an active or queued operation for the given key.
   */
  isLocked(key: string): boolean {
    return this.queues.has(key);
  }
}

/** Global singleton file mutex for desktop storage operations */
export const fileMutex = new FileMutex();
