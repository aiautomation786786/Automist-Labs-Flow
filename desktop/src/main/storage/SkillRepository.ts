/**
 * SkillRepository – Concurrency-safe atomic persistence, seeding,
 * and import parser for ZBot Skills in Infinity Flow.
 *
 * Guarantees:
 *  1. Concurrency-Safe: Serializes all mutations through FileMutex.
 *  2. Atomic Writes: Writes to .tmp file first, then renames with retry.
 *  3. In-Memory LRU Cache: Bounded cache with mtime invalidation.
 *  4. Default Seeding: Pre-populates 4 high-quality production skills if empty.
 *  5. Universal Importer: Parses .md (frontmatter), .txt, .json, and .skill / .zip archives
 *     using Node.js native zlib without external zip dependencies (ZBot spec §9).
 *  6. No Secrets: Never stores API credentials in skill files.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import type {
  SkillEntity,
  CreateSkillParams,
  UpdateSkillParams,
} from '../../shared/types';
import { AssetManager } from './AssetManager';
import { fileMutex } from './FileMutex';
import { PdfTextExtractor } from './PdfTextExtractor';
import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export const DEFAULT_BUILTIN_SKILLS: CreateSkillParams[] = [
  {
    name: 'Cinematic Documentary',
    description: 'Authoritative, evocative, pacing-oriented documentary storytelling with deep atmospheric visual prompts.',
    systemInstructions: 'You are an elite documentary filmmaker and narrator. Write evocative, fact-rich, beautifully paced scripts with cinematic visual descriptions. Every scene must convey wonder, gravitas, and visual clarity.',
    writingStyle: 'Objective, profound, measured, evocative, rich with sensory adjectives.',
    structureRequirements: 'Dynamic hook in Scene 1, deep context and tension in middle scenes, philosophical resolution in final scene.',
    sceneRequirements: 'Aim for 15-25 words of narration per scene (~5-8 seconds per scene).',
    promptGuidance: 'Cinematic 35mm film photography, volumetric atmospheric lighting, shallow depth of field, photorealistic textures, 8k resolution, IMAX composition.',
  },
  {
    name: 'Viral Explainer / Shorts',
    description: 'High retention, fast hook, punchy educational script designed for fast-paced vertical 9:16 video.',
    systemInstructions: 'You are a top-tier science communicator creating ultra-engaging short-form videos. Grab attention within the first 2 seconds and deliver surprising insight.',
    writingStyle: 'Conversational, energetic, crisp, suspenseful, zero fluff.',
    structureRequirements: 'Immediate cognitive hook (Scene 1), escalating revelation (Scenes 2-4), memorable takeaway or call to ponder (Final Scene).',
    sceneRequirements: 'Short punchy lines: 10-18 words per scene (~4-6 seconds per scene).',
    promptGuidance: 'High contrast, vibrant focal subject, eye-level macro perspective, studio lighting, bold visual metaphor.',
  },
  {
    name: 'Sci-Fi & Cosmic Wonders',
    description: 'Grand cosmic concepts, astrophysics, futuristic technology, and awe-inspiring galactic visuals.',
    systemInstructions: 'You are an astrophysicist and science fiction author exploring the outer bounds of reality, space exploration, and futuristic engineering.',
    writingStyle: 'Mind-bending, awe-inspiring, scientifically grounded, visionary.',
    structureRequirements: 'Opening cosmic question, exploration of mind-expanding phenomena, grand implications for humanity.',
    sceneRequirements: 'Balanced pacing: 18-28 words per scene.',
    promptGuidance: 'Deep space cosmic nebula photography, glowing interstellar dust, colossal futuristic spacecraft, neon cybernetic accents, cinematic lighting, Unreal Engine 5 render style.',
  },
  {
    name: 'Top 5 Countdown / Listicle',
    description: 'Ranked countdown structure with suspenseful transitions and crescendo reveals.',
    systemInstructions: 'You are an engaging host presenting a countdown. Build suspense from item 5 down to the number 1 ultimate reveal.',
    writingStyle: 'Engaging, structured, enthusiastic, punchy, conversational.',
    structureRequirements: 'Teaser intro, sequential countdown blocks (5 to 1) with escalating impact, wrap-up outro.',
    sceneRequirements: 'Clear transition cues per scene.',
    promptGuidance: 'Dynamic action framing, dramatic rim lighting, intense focus on the featured subject.',
  },
];

export class SkillRepository {
  private static readonly MAX_CACHE_ENTRIES = 50;
  private static cache = new Map<string, { entity: SkillEntity; mtimeMs: number }>();

  static generateSkillId(): string {
    return `skill_${crypto.randomBytes(6).toString('hex')}`;
  }

  static clearCache(): void {
    this.cache.clear();
  }

  private static setCache(id: string, entity: SkillEntity, mtimeMs: number): void {
    this.cache.delete(id);
    if (this.cache.size >= this.MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(id, {
      entity: JSON.parse(JSON.stringify(entity)),
      mtimeMs,
    });
  }

  private static readSkillDirect(skillId: string): SkillEntity | null {
    const filePath = AssetManager.getSkillJsonPath(skillId);
    if (!fs.existsSync(filePath)) {
      this.cache.delete(skillId);
      return null;
    }

    try {
      const stat = fs.statSync(filePath);
      const cached = this.cache.get(skillId);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return JSON.parse(JSON.stringify(cached.entity));
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const entity = JSON.parse(content) as SkillEntity;
      this.setCache(skillId, entity, stat.mtimeMs);
      return entity;
    } catch (err) {
      logger.error('skill_repo', `Failed to read skill ${skillId}`, err as Error);
      return null;
    }
  }

  private static async writeSkillAtomic(skill: SkillEntity): Promise<void> {
    const { skillDir } = AssetManager.ensureSkillDirectories(skill.id);
    const targetPath = AssetManager.getSkillJsonPath(skill.id);
    const tmpPath = path.join(skillDir, `skill.json.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`);

    const json = JSON.stringify(skill, null, 2);
    fs.writeFileSync(tmpPath, json, 'utf-8');

    let renamed = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        fs.renameSync(tmpPath, targetPath);
        renamed = true;
        break;
      } catch (err: any) {
        if ((err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES') && attempt < 5) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 25);
        } else {
          try {
            fs.copyFileSync(tmpPath, targetPath);
            fs.unlinkSync(tmpPath);
            renamed = true;
            break;
          } catch {
            if (fs.existsSync(tmpPath)) {
              try { fs.unlinkSync(tmpPath); } catch {}
            }
            throw err;
          }
        }
      }
    }

    if (!renamed && fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }

    try {
      const stat = fs.statSync(targetPath);
      this.setCache(skill.id, skill, stat.mtimeMs);
    } catch {
      this.cache.delete(skill.id);
    }
  }

  /**
   * Reads all skills directly from disk/cache without triggering default seeding.
   */
  private static readAllDirect(): SkillEntity[] {
    const rootDir = AssetManager.getSkillsRootDir();
    if (!fs.existsSync(rootDir)) return [];

    const entries = fs.readdirSync(rootDir);
    const skills: SkillEntity[] = [];

    for (const entry of entries) {
      if (entry.startsWith('skill_')) {
        const skill = this.readSkillDirect(entry);
        if (skill) skills.push(skill);
      }
    }

    return skills.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Automatically seeds built-in default skills if the skills directory is empty.
   */
  static async ensureDefaultSkills(): Promise<void> {
    const rootDir = AssetManager.getSkillsRootDir();
    if (!fs.existsSync(rootDir)) {
      fs.mkdirSync(rootDir, { recursive: true });
    }

    const entries = fs.readdirSync(rootDir);
    let skillCount = 0;
    for (const entry of entries) {
      if (entry.startsWith('skill_') && fs.existsSync(path.join(rootDir, entry, 'skill.json'))) {
        skillCount++;
      }
    }

    if (skillCount > 0) return;

    logger.info('skill_repo', 'No existing skills found. Seeding default built-in skills...');
    for (const def of DEFAULT_BUILTIN_SKILLS) {
      try {
        const id = this.generateSkillId();
        const now = new Date().toISOString();
        const skill: SkillEntity = {
          id,
          name: def.name.trim(),
          description: def.description?.trim() || '',
          systemInstructions: def.systemInstructions.trim(),
          writingStyle: def.writingStyle?.trim(),
          structureRequirements: def.structureRequirements?.trim(),
          sceneRequirements: def.sceneRequirements?.trim(),
          promptGuidance: def.promptGuidance?.trim(),
          channelCompatibility: def.channelCompatibility,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        };
        await this.writeSkillAtomic(skill);
      } catch (err) {
        logger.warn('skill_repo', `Failed to seed default skill "${def.name}"`, { error: (err as Error).message });
      }
    }
  }

  /**
   * Retrieves all skills sorted by creation date descending.
   */
  static async getAll(): Promise<SkillEntity[]> {
    await this.ensureDefaultSkills();
    return this.readAllDirect();
  }

  /**
   * Retrieves a skill by ID.
   */
  static async get(skillId: string): Promise<SkillEntity | null> {
    await this.ensureDefaultSkills();
    return this.readSkillDirect(skillId);
  }

  /**
   * Creates a new skill.
   */
  static async create(params: CreateSkillParams): Promise<SkillEntity> {
    const trimmedName = params.name ? params.name.trim() : '';
    if (!trimmedName) {
      throw new Error('Skill name cannot be empty');
    }

    return await fileMutex.runExclusive('skills_index', async () => {
      const existingSkills = this.readAllDirect();
      const duplicate = existingSkills.find(
        (s) => s.name.toLowerCase() === trimmedName.toLowerCase()
      );
      if (duplicate) {
        throw new Error(`Skill with name "${trimmedName}" already exists`);
      }

      const id = this.generateSkillId();
      const now = new Date().toISOString();

      const skill: SkillEntity = {
        id,
        name: trimmedName,
        description: params.description?.trim() || '',
        systemInstructions: params.systemInstructions?.trim() || '',
        writingStyle: params.writingStyle?.trim(),
        structureRequirements: params.structureRequirements?.trim(),
        sceneRequirements: params.sceneRequirements?.trim(),
        promptGuidance: params.promptGuidance?.trim(),
        channelCompatibility: params.channelCompatibility || [],
        rawMarkdown: params.rawMarkdown,
        createdAt: now,
        updatedAt: now,
        enabled: params.enabled ?? true,
      };

      await this.writeSkillAtomic(skill);
      logger.info('skill_repo', 'Created skill', { skillId: id, name: skill.name });
      return skill;
    });
  }

  /**
   * Updates an existing skill.
   */
  static async update(skillId: string, patch: UpdateSkillParams): Promise<SkillEntity> {
    return await fileMutex.runExclusive(`skill:${skillId}`, async () => {
      const current = this.readSkillDirect(skillId);
      if (!current) {
        throw new Error(`Skill ${skillId} not found`);
      }

      if (patch.name !== undefined) {
        const trimmed = patch.name.trim();
        if (!trimmed) throw new Error('Skill name cannot be empty');
        if (trimmed.toLowerCase() !== current.name.toLowerCase()) {
          const allSkills = this.readAllDirect();
          const duplicate = allSkills.find(
            (s) => s.id !== skillId && s.name.toLowerCase() === trimmed.toLowerCase()
          );
          if (duplicate) {
            throw new Error(`Skill with name "${trimmed}" already exists`);
          }
        }
      }

      const updated: SkillEntity = {
        ...current,
        name: patch.name !== undefined ? patch.name.trim() : current.name,
        description: patch.description !== undefined ? patch.description.trim() : current.description,
        systemInstructions: patch.systemInstructions !== undefined ? patch.systemInstructions.trim() : current.systemInstructions,
        writingStyle: patch.writingStyle !== undefined ? patch.writingStyle.trim() : current.writingStyle,
        structureRequirements: patch.structureRequirements !== undefined ? patch.structureRequirements.trim() : current.structureRequirements,
        sceneRequirements: patch.sceneRequirements !== undefined ? patch.sceneRequirements.trim() : current.sceneRequirements,
        promptGuidance: patch.promptGuidance !== undefined ? patch.promptGuidance.trim() : current.promptGuidance,
        channelCompatibility: patch.channelCompatibility !== undefined ? patch.channelCompatibility : current.channelCompatibility,
        rawMarkdown: patch.rawMarkdown !== undefined ? patch.rawMarkdown : current.rawMarkdown,
        enabled: patch.enabled !== undefined ? patch.enabled : current.enabled,
        updatedAt: new Date().toISOString(),
      };

      await this.writeSkillAtomic(updated);
      logger.info('skill_repo', 'Updated skill', { skillId, name: updated.name });
      return updated;
    });
  }

  /**
   * Deletes a skill safely.
   */
  static async delete(skillId: string): Promise<boolean> {
    return await fileMutex.runExclusive('skills_index', async () => {
      return await fileMutex.runExclusive(`skill:${skillId}`, async () => {
        const current = this.readSkillDirect(skillId);
        if (!current) return false;

        this.cache.delete(skillId);
        const skillDir = AssetManager.getSkillDir(skillId);
        if (fs.existsSync(skillDir)) {
          try {
            fs.rmSync(skillDir, { recursive: true, force: true });
          } catch (err) {
            logger.warn('skill_repo', `Failed to delete skill directory ${skillDir}`, { error: (err as Error).message });
          }
        }

        logger.info('skill_repo', 'Deleted skill', { skillId, name: current.name });
        return true;
      });
    });
  }

  /**
   * Universal Skill Importer.
   *
   * Accepts:
   *  - .md (YAML frontmatter or markdown sections)
   *  - .txt (raw text instructions)
   *  - .json (SkillEntity or CreateSkillParams)
   *  - .skill / .zip archives (decompresses SKILL.md or primary entry via zlib.inflateRawSync per ZBot spec §9)
   */
  static async importSkill(contentOrBuffer: string | Buffer | Uint8Array | ArrayBuffer, fileName?: string): Promise<SkillEntity> {
    let rawText = '';
    let defaultTitle = fileName ? path.basename(fileName, path.extname(fileName)) : 'Imported Skill';

    // 1. Detect if input is a PDF document (magic bytes %PDF- or .pdf extension)
    const isPdfHeader = Buffer.isBuffer(contentOrBuffer)
      ? contentOrBuffer.subarray(0, 5).toString('ascii').startsWith('%PDF-')
      : contentOrBuffer instanceof Uint8Array
      ? Buffer.from(contentOrBuffer).subarray(0, 5).toString('ascii').startsWith('%PDF-')
      : (typeof contentOrBuffer === 'string' && contentOrBuffer.startsWith('%PDF-'));
    const isPdfExt = fileName ? fileName.toLowerCase().endsWith('.pdf') : false;

    if (isPdfHeader || isPdfExt) {
      const buf = Buffer.isBuffer(contentOrBuffer)
        ? contentOrBuffer
        : (contentOrBuffer instanceof Uint8Array || contentOrBuffer instanceof ArrayBuffer)
        ? Buffer.from(contentOrBuffer as any)
        : Buffer.from(contentOrBuffer, typeof contentOrBuffer === 'string' && contentOrBuffer.startsWith('%PDF-') ? 'binary' : 'utf-8');
      rawText = await PdfTextExtractor.extractText(buf);
    }
    // 2. Detect if input is a ZIP / .skill archive (magic bytes 0x50 0x4B 0x03 0x04)
    else if (Buffer.isBuffer(contentOrBuffer) || (typeof contentOrBuffer === 'string' && contentOrBuffer.startsWith('PK\x03\x04'))) {
      const buf = Buffer.isBuffer(contentOrBuffer) ? contentOrBuffer : Buffer.from(contentOrBuffer, 'binary');
      const unzipped = this.unpackZipSkill(buf);
      if (unzipped) {
        rawText = unzipped;
      } else {
        throw new Error('Could not unpack .skill archive: missing or unreadable SKILL.md');
      }
    } else {
      rawText = typeof contentOrBuffer === 'string' ? contentOrBuffer : (contentOrBuffer as Buffer).toString('utf-8');
    }

    rawText = rawText.trim();
    if (!rawText) throw new Error('Cannot import empty skill file');

    // 2. Check if JSON
    if (rawText.startsWith('{') && rawText.endsWith('}')) {
      try {
        const parsed = JSON.parse(rawText);
        if (parsed.name && parsed.systemInstructions) {
          return await this.create({
            name: parsed.name,
            description: parsed.description || `Imported ${parsed.name}`,
            systemInstructions: parsed.systemInstructions,
            writingStyle: parsed.writingStyle,
            structureRequirements: parsed.structureRequirements,
            sceneRequirements: parsed.sceneRequirements,
            promptGuidance: parsed.promptGuidance,
            channelCompatibility: parsed.channelCompatibility,
            rawMarkdown: parsed.rawMarkdown || rawText,
          });
        }
      } catch {
        // Not valid JSON, continue with Markdown/text parsing
      }
    }

    // 3. Parse Markdown Frontmatter if present:
    // ---
    // name: Skill Name
    // description: ...
    // ---
    let name = defaultTitle;
    let description = 'Imported Skill';
    let systemInstructions = rawText;
    let writingStyle: string | undefined;
    let promptGuidance: string | undefined;

    if (rawText.startsWith('---')) {
      const endMarker = rawText.indexOf('---', 3);
      if (endMarker !== -1) {
        const frontmatter = rawText.slice(3, endMarker);
        const body = rawText.slice(endMarker + 3).trim();
        systemInstructions = body || rawText;

        for (const line of frontmatter.split('\n')) {
          const colonIdx = line.indexOf(':');
          if (colonIdx > 0) {
            const key = line.slice(0, colonIdx).trim().toLowerCase();
            const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
            if (key === 'name' || key === 'title') name = val;
            if (key === 'description' || key === 'desc') description = val;
            if (key === 'writingstyle' || key === 'style') writingStyle = val;
            if (key === 'promptguidance' || key === 'prompt') promptGuidance = val;
          }
        }
      }
    } else {
      // Check for markdown headers like "# My Skill Title"
      const match = rawText.match(/^#\s+(.+)$/m);
      if (match && match[1]) {
        name = match[1].trim();
      }
    }

    return await this.create({
      name,
      description,
      systemInstructions,
      writingStyle,
      promptGuidance,
      rawMarkdown: rawText,
    });
  }

  /**
   * Unpacks a ZIP / .skill archive using Node.js native zlib.inflateRawSync.
   * Walks local file headers (0x04034b50) and extracts SKILL.md or the largest entry.
   * ZBot spec §9: "walk the ZIP central directory with zlib inflateRawSync, prefer SKILL.md; no zip dependency needed".
   */
  private static unpackZipSkill(buffer: Buffer): string | null {
    try {
      let offset = 0;
      let skillMdText: string | null = null;
      let fallbackLargestText: string | null = null;
      let largestSize = 0;

      while (offset < buffer.length - 30) {
        // Local file header signature: 0x04034b50 (Little Endian: 50 4b 03 04)
        if (buffer.readUInt32LE(offset) !== 0x04034b50) {
          offset++;
          continue;
        }

        const compression = buffer.readUInt16LE(offset + 8);
        const compSize = buffer.readUInt32LE(offset + 18);
        const uncompSize = buffer.readUInt32LE(offset + 22);
        const nameLen = buffer.readUInt16LE(offset + 26);
        const extraLen = buffer.readUInt16LE(offset + 28);

        const fileNameStart = offset + 30;
        const fileNameEnd = fileNameStart + nameLen;
        const fileName = buffer.toString('utf-8', fileNameStart, fileNameEnd);

        const dataStart = fileNameEnd + extraLen;
        const dataEnd = dataStart + compSize;

        if (dataEnd <= buffer.length) {
          const compData = buffer.slice(dataStart, dataEnd);
          let decompressed: Buffer | null = null;

          if (compression === 0) {
            // Stored (no compression)
            decompressed = compData;
          } else if (compression === 8) {
            // Deflated
            try {
              decompressed = zlib.inflateRawSync(compData);
            } catch {
              decompressed = null;
            }
          }

          if (decompressed) {
            const text = decompressed.toString('utf-8');
            if (fileName.toLowerCase().endsWith('skill.md')) {
              skillMdText = text;
              break;
            }
            if (uncompSize > largestSize && (fileName.endsWith('.md') || fileName.endsWith('.txt'))) {
              fallbackLargestText = text;
              largestSize = uncompSize;
            }
          }
        }

        offset = dataEnd;
      }

      return skillMdText || fallbackLargestText;
    } catch (err) {
      logger.error('skill_repo', 'Error unpacking zip skill archive', err as Error);
      return null;
    }
  }
}
