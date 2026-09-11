import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iflow-pdf-skill-test-'));
process.env['LOCALAPPDATA'] = tmpDir;

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PdfTextExtractor } from '../main/storage/PdfTextExtractor';
import { SkillRepository } from '../main/storage/SkillRepository';
import { AssetManager } from '../main/storage/AssetManager';

function createValidPdf(textOrLines: string | string[]): Buffer {
  const lines = Array.isArray(textOrLines) ? textOrLines : [textOrLines];
  const textOps = lines
    .map((l) => `(${l.replace(/[\(\)\\\r\n]/g, ' ')}) '`)
    .join('\n');
  const content = `BT /F1 12 Tf 50 700 Td 14 TL\n${textOps}\nET`;
  const streamLen = Buffer.byteLength(content, 'utf-8');
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];

  offsets.push(body.length);
  body += '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';

  offsets.push(body.length);
  body += '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';

  offsets.push(body.length);
  body += '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n';

  offsets.push(body.length);
  body += '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';

  offsets.push(body.length);
  body += `5 0 obj\n<< /Length ${streamLen} >>\nstream\n${content}\nendstream\nendobj\n`;

  const xrefOffset = body.length;
  body += 'xref\n0 6\n0000000000 65535 f \n';
  for (const off of offsets) {
    body += String(off).padStart(10, '0') + ' 00000 n \n';
  }
  body += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'utf-8');
}

describe('PDF Skill Import & Text Extractor (ZBot Parity)', () => {
  let tempDir: string;
  let originalLocalAppData: string | undefined;

  beforeEach(() => {
    originalLocalAppData = process.env['LOCALAPPDATA'];
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iflow-pdf-skill-test-'));
    process.env['LOCALAPPDATA'] = tempDir;
    SkillRepository.clearCache();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    process.env['LOCALAPPDATA'] = originalLocalAppData;
    SkillRepository.clearCache();
  });

  it('correctly extracts plain text from a real valid PDF document', async () => {
    const rawText = 'Deep Oceanic Mystery Documentary Script';
    const pdfBuf = createValidPdf(rawText);

    const extracted = await PdfTextExtractor.extractText(pdfBuf);
    expect(extracted).toContain(rawText);

    const detailed = await PdfTextExtractor.extract(pdfBuf);
    expect(detailed.numPages).toBe(1);
    expect(detailed.text).toContain(rawText);
  });

  it('parses real PDF with frontmatter and imports into SkillRepository', async () => {
    const pdfBuf = createValidPdf([
      '---',
      'name: Ancient Civilizations',
      'description: Historical documentary skill',
      '---',
      '# Ancient Civilizations',
      'Explore archaeological wonders.',
    ]);

    const imported = await SkillRepository.importSkill(pdfBuf, 'ancient_wonders.pdf');
    expect(imported).toBeDefined();
    expect(imported.name).toBe('Ancient Civilizations');
    expect(imported.description).toBe('Historical documentary skill');
    expect(imported.systemInstructions).toContain('Explore archaeological wonders');

    // Verify stored and retrievable
    const retrieved = await SkillRepository.get(imported.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.name).toBe('Ancient Civilizations');
  });

  it('rejects buffers missing %PDF- file signature header', async () => {
    const invalidBuf = Buffer.from('This is a plain text file pretending to be PDF');
    await expect(PdfTextExtractor.extract(invalidBuf)).rejects.toThrow(
      /Missing %PDF- file signature header/i
    );
  });

  it('rejects empty buffers safely', async () => {
    await expect(PdfTextExtractor.extract(Buffer.alloc(0))).rejects.toThrow(
      /Cannot extract text from empty PDF buffer/i
    );
  });

  it('handles corrupt PDF data gracefully without process crash', async () => {
    const corruptPdf = Buffer.from('%PDF-1.4\nCorrupt junk byte stream with no catalog or xref');
    await expect(PdfTextExtractor.extract(corruptPdf)).rejects.toThrow();
  });

  it('supports Uint8Array and ArrayBuffer inputs directly', async () => {
    const rawText = 'Universal Buffer Extraction Test';
    const pdfBuf = createValidPdf(rawText);
    const uint8 = new Uint8Array(pdfBuf);

    const textFromUint8 = await PdfTextExtractor.extractText(uint8);
    expect(textFromUint8).toContain(rawText);

    const arrayBuf = pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength);
    const textFromArrayBuf = await PdfTextExtractor.extractText(arrayBuf);
    expect(textFromArrayBuf).toContain(rawText);
  });
});
