/**
 * ZipService – Secure archive extraction and sequential ordered archive creation.
 *
 * SECURITY INVARIANTS:
 *  1. Path traversal protection: rejects entries with "..", absolute paths, drive letters,
 *     UNC paths, or null bytes. Every path is canonicalized to ensure it stays strictly within destDir.
 *  2. Resource bounds: enforces max archive size (200MB), max total uncompressed size (500MB),
 *     and max file count (500 files) to prevent zip bombs.
 *  3. Isolated extraction: extracts only to temporary directories, never directly into permanent storage.
 *  4. Format validation: only extracts supported image formats (.jpg, .jpeg, .png, .webp).
 *  5. Sequential zero-padded export: bundles completed media by slotIndex (01_video.mp4, 02_video.mp4).
 */

import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { naturalSort } from '../../shared/utils/NaturalSort';
import { getAppDataDir, AppLogger } from './AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX_ARCHIVE_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB
const MAX_UNCOMPRESSED_TOTAL_BYTES = 500 * 1024 * 1024; // 500 MB
const MAX_FILE_COUNT = 500;

export interface ExtractedImageFile {
  path: string;
  name: string;
  sizeBytes: number;
}

export interface ZipExtractionResult {
  files: ExtractedImageFile[];
  tempDir: string;
  totalCount: number;
}

export interface ExportMediaItem {
  slotIndex: number;
  mediaPath: string;
  type: 'image' | 'video';
  originalName?: string;
}

export class ZipService {
  /**
   * Safely extracts images from a ZIP file into an isolated temporary folder.
   */
  static async extractImageZip(zipFilePath: string): Promise<ZipExtractionResult> {
    if (!fs.existsSync(zipFilePath)) {
      throw new Error(`ZIP file not found: ${zipFilePath}`);
    }

    const stat = fs.statSync(zipFilePath);
    if (stat.size > MAX_ARCHIVE_SIZE_BYTES) {
      throw new Error(`ZIP archive exceeds maximum allowed size of 200MB (actual: ${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
    }

    const zip = new AdmZip(zipFilePath);
    const entries = zip.getEntries();

    if (entries.length > MAX_FILE_COUNT) {
      throw new Error(`ZIP archive contains too many entries (${entries.length} > max ${MAX_FILE_COUNT})`);
    }

    // Prepare clean, isolated temp directory
    const importId = `zip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const tempDir = path.join(getAppDataDir(), 'temp', 'zip_imports', importId);
    fs.mkdirSync(tempDir, { recursive: true });
    const canonicalTempDir = path.resolve(tempDir);

    let totalUncompressedBytes = 0;
    const extractedFiles: ExtractedImageFile[] = [];

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      const rawName = entry.entryName;

      // Security check: reject null bytes, drive letters, and relative escapes
      if (rawName.includes('\0') || rawName.includes('..') || /^[a-zA-Z]:/.test(rawName) || rawName.startsWith('\\\\') || rawName.startsWith('//')) {
        throw new Error(`Directory traversal detected in ZIP entry: ${rawName}`);
      }

      // Check uncompressed size
      totalUncompressedBytes += entry.header.size;
      if (totalUncompressedBytes > MAX_UNCOMPRESSED_TOTAL_BYTES) {
        throw new Error('ZIP archive exceeds maximum uncompressed size limit of 500MB');
      }

      // Filter allowed extensions
      const ext = path.extname(rawName).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        continue;
      }

      // Compute and canonicalize target file path
      const baseName = path.basename(rawName);
      const targetFilePath = path.resolve(canonicalTempDir, baseName);

      // Verify path canonicalization security check
      if (!targetFilePath.startsWith(canonicalTempDir + path.sep)) {
        throw new Error(`Path traversal attempt blocked for entry: ${rawName}`);
      }

      // Extract file
      const buffer = entry.getData();
      fs.writeFileSync(targetFilePath, buffer);

      extractedFiles.push({
        path: targetFilePath,
        name: baseName,
        sizeBytes: buffer.length,
      });
    }

    // Naturally sort extracted files by filename
    const sortedFiles = naturalSort(extractedFiles, (f) => f.name);

    logger.info('zip_service', `Successfully extracted ${sortedFiles.length} valid images from ZIP to ${tempDir}`);

    return {
      files: sortedFiles,
      tempDir,
      totalCount: sortedFiles.length,
    };
  }

  /**
   * Safely cleans up a temporary extraction directory.
   */
  static cleanTempDir(tempDir: string): void {
    try {
      const canonicalBase = path.resolve(path.join(getAppDataDir(), 'temp', 'zip_imports'));
      const canonicalTarget = path.resolve(tempDir);
      if (canonicalTarget.startsWith(canonicalBase + path.sep) && fs.existsSync(canonicalTarget)) {
        fs.rmSync(canonicalTarget, { recursive: true, force: true });
        logger.info('zip_service', `Cleaned temporary extraction directory: ${tempDir}`);
      }
    } catch (err) {
      logger.warn('zip_service', `Failed to clean temp directory ${tempDir}: ${(err as Error).message}`);
    }
  }

  /**
   * Creates an ordered ZIP archive containing completed media with zero-padded serial naming.
   * Order is strictly determined by slotIndex.
   */
  static async createOrderedZip(
    items: ExportMediaItem[],
    outputZipPath: string
  ): Promise<{ zipPath: string; fileCount: number }> {
    if (!items || items.length === 0) {
      throw new Error('No media items provided for ZIP export.');
    }

    // Strict invariant: sort strictly by slotIndex
    const sortedItems = [...items].sort((a, b) => a.slotIndex - b.slotIndex);
    const zip = new AdmZip();
    let addedCount = 0;

    for (const item of sortedItems) {
      if (!fs.existsSync(item.mediaPath)) continue;

      const ext = path.extname(item.mediaPath) || (item.type === 'video' ? '.mp4' : '.jpg');
      const serialNumber = String(item.slotIndex + 1).padStart(2, '0');
      const entryName = `${serialNumber}_${item.type}${ext}`;

      zip.addLocalFile(item.mediaPath, '', entryName);
      addedCount++;
    }

    if (addedCount === 0) {
      throw new Error('None of the specified media files exist on disk.');
    }

    fs.mkdirSync(path.dirname(outputZipPath), { recursive: true });
    zip.writeZip(outputZipPath);

    logger.info('zip_service', `Created ordered export ZIP at ${outputZipPath} with ${addedCount} files`);
    return { zipPath: outputZipPath, fileCount: addedCount };
  }

  static cleanupExtractedDir(tempDir: string): void {
    this.cleanTempDir(tempDir);
  }

  static async createOrderedZipArchive(
    items: Array<{ slotIndex: number; sourcePath: string; filename?: string; type?: 'image' | 'video' }>,
    outputZipPath: string
  ): Promise<{ zipPath: string; fileCount: number }> {
    return this.createOrderedZip(
      items.map((i) => ({
        slotIndex: i.slotIndex,
        mediaPath: i.sourcePath,
        type: i.type || (i.sourcePath.endsWith('.mp4') ? 'video' : 'image'),
      })),
      outputZipPath
    );
  }
}
