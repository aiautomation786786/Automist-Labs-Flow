import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';
import { SkillRepository, DEFAULT_BUILTIN_SKILLS } from '../main/storage/SkillRepository';
import { AssetManager } from '../main/storage/AssetManager';

describe('SkillRepository Unit & Import Tests', () => {
  let tempAppDir: string;

  beforeEach(() => {
    tempAppDir = path.join(os.tmpdir(), `infinity_flow_skill_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempAppDir, { recursive: true });
    process.env.LOCALAPPDATA = tempAppDir;
    SkillRepository.clearCache();
  });

  afterEach(() => {
    SkillRepository.clearCache();
    try {
      if (fs.existsSync(tempAppDir)) {
        fs.rmSync(tempAppDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('1. Automatically seeds built-in default skills on initial empty load', async () => {
    const skills = await SkillRepository.getAll();
    expect(skills.length).toBe(DEFAULT_BUILTIN_SKILLS.length);

    const docSkill = skills.find((s) => s.name === 'Cinematic Documentary');
    expect(docSkill).toBeDefined();
    expect(docSkill?.writingStyle).toContain('Objective');
    expect(docSkill?.promptGuidance).toContain('35mm film photography');

    const shortsSkill = skills.find((s) => s.name === 'Viral Explainer / Shorts');
    expect(shortsSkill).toBeDefined();
  });

  it('2. Enforces non-empty name validation', async () => {
    await expect(
      SkillRepository.create({
        name: '   ',
        description: 'Test description',
        systemInstructions: 'Test instructions',
      })
    ).rejects.toThrow('Skill name cannot be empty');
  });

  it('3. Enforces case-insensitive skill name uniqueness', async () => {
    await SkillRepository.create({
      name: 'History Channel Style',
      description: 'Historical breakdown',
      systemInstructions: 'Write historical scenes',
    });

    await expect(
      SkillRepository.create({
        name: 'history channel style', // Case-insensitive duplicate
        description: 'Duplicate',
        systemInstructions: 'Write duplicate',
      })
    ).rejects.toThrow('already exists');
  });

  it('4. Updates skill properties and rule directives atomically', async () => {
    const created = await SkillRepository.create({
      name: 'Cyberpunk Lore',
      description: 'Futuristic narratives',
      systemInstructions: 'Write cyberpunk stories',
    });

    const updated = await SkillRepository.update(created.id, {
      description: 'Expanded cyberpunk narratives',
      writingStyle: 'Gritty, neon-drenched, noir',
      promptGuidance: 'High contrast neon volumetric rain',
    });

    expect(updated.description).toBe('Expanded cyberpunk narratives');
    expect(updated.writingStyle).toBe('Gritty, neon-drenched, noir');
    expect(updated.promptGuidance).toBe('High contrast neon volumetric rain');

    const fetched = await SkillRepository.get(created.id);
    expect(fetched?.description).toBe('Expanded cyberpunk narratives');
  });

  it('5. Deletes skill safely removing directory from disk', async () => {
    const skill = await SkillRepository.create({
      name: 'Temporary Skill',
      description: 'To be deleted',
      systemInstructions: 'Temporary',
    });

    const skillDir = AssetManager.getSkillDir(skill.id);
    expect(fs.existsSync(skillDir)).toBe(true);

    const deleted = await SkillRepository.delete(skill.id);
    expect(deleted).toBe(true);

    expect(fs.existsSync(skillDir)).toBe(false);
    const fetched = await SkillRepository.get(skill.id);
    expect(fetched).toBeNull();
  });

  it('6. Imports skill from Markdown frontmatter', async () => {
    const markdown = `---
name: Mythological Legends
description: Epic myths and ancient folklore
writingstyle: Mythic, heroic, dramatic
promptguidance: Classical oil painting, chiaroscuro lighting
---
# Mythological Legends Directives
Focus on legendary gods, ancient monsters, and classical epics.`;

    const imported = await SkillRepository.importSkill(markdown, 'mythology.md');
    expect(imported.name).toBe('Mythological Legends');
    expect(imported.description).toBe('Epic myths and ancient folklore');
    expect(imported.writingStyle).toBe('Mythic, heroic, dramatic');
    expect(imported.promptGuidance).toBe('Classical oil painting, chiaroscuro lighting');
    expect(imported.systemInstructions).toContain('Focus on legendary gods');
  });

  it('7. Imports skill from .skill / .zip archive using native zlib', async () => {
    // Construct a minimal uncompressed ZIP archive containing SKILL.md
    const skillMdContent = `---
name: Deep Space Explorer
description: Cosmos exploration skill
---
Explore deep space anomalies with cosmic wonder.`;

    const fileName = 'SKILL.md';
    const fileData = Buffer.from(skillMdContent, 'utf-8');

    // Local file header structure (30 bytes + filename + data)
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // signature
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0, 6); // flags
    header.writeUInt16LE(0, 8); // compression: 0 (Stored)
    header.writeUInt16LE(0, 10); // mod time
    header.writeUInt16LE(0, 12); // mod date
    header.writeUInt32LE(0, 14); // crc32
    header.writeUInt32LE(fileData.length, 18); // comp size
    header.writeUInt32LE(fileData.length, 22); // uncomp size
    header.writeUInt16LE(fileName.length, 26); // name length
    header.writeUInt16LE(0, 28); // extra field length

    const zipBuffer = Buffer.concat([header, Buffer.from(fileName, 'utf-8'), fileData]);

    const imported = await SkillRepository.importSkill(zipBuffer, 'deep_space.skill');
    expect(imported.name).toBe('Deep Space Explorer');
    expect(imported.description).toBe('Cosmos exploration skill');
    expect(imported.systemInstructions).toContain('Explore deep space anomalies');
  });
});
