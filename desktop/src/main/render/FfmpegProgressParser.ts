/**
 * FfmpegProgressParser – Deterministic FFmpeg progress reporting via stdout `-progress pipe:1`.
 *
 * FFmpeg writes key=value lines separated by newlines to stdout when `-progress pipe:1` is given.
 * Typical keys:
 *   frame=120
 *   fps=29.97
 *   stream_0_0_q=28.0
 *   bitrate= 1800.0kbits/s
 *   total_size=1048576
 *   out_time_us=4000000
 *   out_time_ms=4000000
 *   out_time=00:00:04.000000
 *   dup_frames=0
 *   drop_frames=0
 *   speed=1.5x
 *   progress=continue | progress=end
 */

export interface FfmpegProgressData {
  outTimeUs?: number;
  outTimeSec?: number;
  progress?: 'continue' | 'end';
  fps?: number;
  speed?: string;
  bitrate?: string;
  totalSize?: number;
}

export class FfmpegProgressParser {
  private buffer = '';
  private currentData: FfmpegProgressData = {};

  constructor(
    private readonly onProgress: (data: FfmpegProgressData) => void
  ) {}

  /**
   * Feeds a raw data chunk from child.stdout into the parser.
   * Handles arbitrary chunk boundaries safely.
   */
  feed(chunk: Buffer | string): void {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    const lines = this.buffer.split(/\r?\n/);
    // Keep the last element as trailing incomplete line buffer
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;

      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();

      if (key === 'out_time_us') {
        const us = parseInt(val, 10);
        if (!isNaN(us) && us >= 0) {
          this.currentData.outTimeUs = us;
          this.currentData.outTimeSec = us / 1_000_000;
        }
      } else if (key === 'progress') {
        this.currentData.progress = val === 'end' ? 'end' : 'continue';
        this.emitCurrent();
      } else if (key === 'fps') {
        const fps = parseFloat(val);
        if (!isNaN(fps)) {
          this.currentData.fps = fps;
        }
      } else if (key === 'speed') {
        this.currentData.speed = val;
      } else if (key === 'total_size') {
        const size = parseInt(val, 10);
        if (!isNaN(size)) {
          this.currentData.totalSize = size;
        }
      }
    }
  }

  private emitCurrent(): void {
    if (Object.keys(this.currentData).length > 0) {
      this.onProgress({ ...this.currentData });
      this.currentData = {};
    }
  }

  /**
   * Flushes any remaining data in the buffer and emits any uncommitted progress data.
   */
  flush(): void {
    if (this.buffer.trim()) {
      this.feed('\n');
    }
    this.buffer = '';
    this.emitCurrent();
  }
}

/**
 * Maps raw FFmpeg process exit errors and stderr traces into actionable, user-facing error messages
 * while preserving technical details for logging.
 */
export function mapFfmpegErrorMessage(code: number | null, stderr: string, context: string): string {
  const lower = (stderr || '').toLowerCase();

  if (lower.includes('no space left on device')) {
    return `${context}: Insufficient disk space on the target drive. Please free up space and retry.`;
  }
  if (lower.includes('permission denied') || lower.includes('ebusy') || lower.includes('eperm')) {
    return `${context}: A destination or source media file is locked by another process or permissions are denied.`;
  }
  if (lower.includes('moov atom not found') || lower.includes('invalid data found when processing input')) {
    return `${context}: One or more input media files are corrupted, truncated, or incompatible.`;
  }
  if (lower.includes('divisible by 2') || lower.includes('height not divisible') || lower.includes('width not divisible')) {
    return `${context}: Video dimensions are incompatible with the H.264 codec (width and height must both be even numbers).`;
  }
  if (lower.includes('font') && lower.includes('subtitles')) {
    return `${context}: Subtitle rendering encountered a font loading or style syntax error.`;
  }
  if (lower.includes('error reinitializing filters') || lower.includes('filtergraph')) {
    return `${context}: Video filter composition error occurred during scene assembly or audio mixing.`;
  }

  return `${context}: FFmpeg process failed with exit code ${code ?? 'unknown'}. One or more input clips or filters may be incompatible.`;
}
