import { describe, it, expect, afterEach } from 'vitest';
import { ProjectRepository } from '../main/storage/ProjectRepository';
import { naturalSort } from '../shared/utils/NaturalSort';
import { PromptParser } from '../shared/PromptParser';

describe('Scale 500 Jobs Invariant & Ordering Test', () => {
  let createdProjectId: string | null = null;

  afterEach(async () => {
    if (createdProjectId) {
      await ProjectRepository.delete(createdProjectId).catch(() => {});
      createdProjectId = null;
    }
  });

  it('should deterministically order and manage 500 image-to-video slots without drift', async () => {
    const COUNT = 500;

    // Simulate 500 unordered image filenames: image_500.png, image_1.png, image_2.png...
    const rawFiles: string[] = [];
    for (let i = COUNT; i >= 1; i--) {
      rawFiles.push(`C:/assets/scene_${i}.jpg`);
    }

    // Naturally sort files
    const sortedImages = naturalSort(rawFiles, (f) => f.split('/').pop() || f);

    // Verify natural sort order
    expect(sortedImages[0]).toBe('C:/assets/scene_1.jpg');
    expect(sortedImages[1]).toBe('C:/assets/scene_2.jpg');
    expect(sortedImages[9]).toBe('C:/assets/scene_10.jpg');
    expect(sortedImages[499]).toBe('C:/assets/scene_500.jpg');

    // Simulate 500-line prompt block
    const promptLines = Array.from({ length: COUNT }, (_, i) => `Cinematic camera move for scene ${i + 1}`);
    const multilineText = promptLines.join('\n');
    const parsedPrompts = PromptParser.parseRawText(multilineText, 'video');

    expect(parsedPrompts.length).toBe(COUNT);
    expect(parsedPrompts[0].text).toBe('Cinematic camera move for scene 1');
    expect(parsedPrompts[499].text).toBe('Cinematic camera move for scene 500');

    // Pair 1-to-1
    const combinedPrompts = sortedImages.map((img, idx) => ({
      text: parsedPrompts[idx].text,
      type: 'video' as const,
      sourceImagePath: img,
    }));

    // Create project with 500 slots using static ProjectRepository
    const project = await ProjectRepository.create({
      name: 'Mega Bulk 500 Campaign',
      generationMode: 'bulk_image_to_video',
      videoModel: 'Omni 1.1 Flash',
      prompts: combinedPrompts,
    });
    createdProjectId = project.projectId;

    expect(project.slots.length).toBe(500);

    // Verify strict slotIndex invariant: slot 0 -> scene_1.jpg, slot 499 -> scene_500.jpg
    for (let i = 0; i < 500; i++) {
      const slot = project.slots[i];
      expect(slot.slotIndex).toBe(i);
      expect(slot.sourceImagePath).toBe(`C:/assets/scene_${i + 1}.jpg`);
      expect(slot.promptText).toBe(`Cinematic camera move for scene ${i + 1}`);
    }

    // Verify serialization and retrieval integrity from disk
    const retrieved = await ProjectRepository.get(project.projectId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.slots.length).toBe(500);
    expect(retrieved?.slots[0].slotIndex).toBe(0);
    expect(retrieved?.slots[499].slotIndex).toBe(499);
  });
});
