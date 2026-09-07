/**
 * AppLogger – Structured file + console logger for Google Flow Desktop.
 *
 * Design constraints:
 *  - MUST NOT write to process.stdout, which is reserved for MCP JSON-RPC
 *    communication in the existing MCP server.
 *  - Writes to a daily rotating log file under the application data directory.
 *  - Optionally mirrors to process.stderr (safe for MCP stdio).
 *  - Supports per-profile context tagging.
 *  - Thread-safe append semantics (Node.js single-threaded; all writes are
 *    synchronous within an event loop tick via fs.appendFileSync).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { LogLevel, LogEntry } from '../../shared/types';

// ---------------------------------------------------------------------------
// Application data directory
// ---------------------------------------------------------------------------

/**
 * Returns the application-managed root data directory.
 * Uses %LOCALAPPDATA% on Windows, ~/Library/Application Support on macOS (CI),
 * and ~/.local/share on Linux (CI/testing).
 */
export function getAppDataDir(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'] ?? process.env['APPDATA'];
    if (!localAppData) {
      throw new Error(
        'LOCALAPPDATA environment variable is not set. ' +
        'Cannot determine application data directory on Windows.'
      );
    }
    return path.join(localAppData, 'GoogleFlowApp');
  }
  // Fallback for macOS (CI) and Linux (CI/testing only — not production target)
  return path.join(os.homedir(), '.google-flow-app');
}

// ---------------------------------------------------------------------------
// Logger implementation
// ---------------------------------------------------------------------------

export class AppLogger {
  private readonly logDir: string;
  private readonly profileId?: string;
  private readonly mirrorToStderr: boolean;

  constructor(options: {
    profileId?: string;
    mirrorToStderr?: boolean;
  } = {}) {
    this.profileId = options.profileId;
    this.mirrorToStderr = options.mirrorToStderr ?? true;

    this.logDir = path.join(getAppDataDir(), 'logs');
    this.ensureLogDir();
  }

  // ---- Public API ---------------------------------------------------------

  debug(event: string, message: string, data?: Record<string, unknown>): void {
    this.write('debug', event, message, data);
  }

  info(event: string, message: string, data?: Record<string, unknown>): void {
    this.write('info', event, message, data);
  }

  warn(event: string, message: string, data?: Record<string, unknown>): void {
    this.write('warn', event, message, data);
  }

  error(event: string, message: string, errorOrData?: Error | Record<string, unknown>): void {
    if (errorOrData instanceof Error) {
      this.write('error', event, message, undefined, errorOrData.stack);
    } else {
      this.write('error', event, message, errorOrData);
    }
  }

  /** Creates a child logger scoped to a specific profileId. */
  forProfile(profileId: string): AppLogger {
    return new AppLogger({
      profileId,
      mirrorToStderr: this.mirrorToStderr,
    });
  }

  // ---- Private helpers ----------------------------------------------------

  private write(
    level: LogLevel,
    event: string,
    message: string,
    data?: Record<string, unknown>,
    errorStack?: string,
  ): void {
    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      event,
      message,
      ...(this.profileId ? { profileId: this.profileId } : {}),
      ...(data ? { data } : {}),
      ...(errorStack ? { errorStack } : {}),
    };

    const line = JSON.stringify(entry) + '\n';

    // Write to file
    try {
      const logFile = this.dailyLogFile();
      fs.appendFileSync(logFile, line, 'utf-8');
    } catch {
      // If file logging fails, fall through to stderr only
    }

    // Mirror to stderr (never stdout — stdout is reserved for MCP JSON-RPC)
    if (this.mirrorToStderr) {
      const prefix = this.profileId ? `[${this.profileId}]` : '';
      const levelTag = level.toUpperCase().padEnd(5);
      process.stderr.write(`[${entry.timestamp}] ${levelTag} ${prefix} ${event}: ${message}\n`);
      if (errorStack && (level === 'error' || level === 'warn')) {
        process.stderr.write(errorStack + '\n');
      }
    }
  }

  private dailyLogFile(): string {
    const date = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    return path.join(this.logDir, `flow-desktop-${date}.log`);
  }

  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton application logger
// ---------------------------------------------------------------------------

/** Global application logger (not profile-scoped). */
export const appLogger = new AppLogger({ mirrorToStderr: true });
