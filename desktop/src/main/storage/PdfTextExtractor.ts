/**
 * PdfTextExtractor – Production PDF text extraction engine.
 *
 * Implements ZBot §2 and §9 specification:
 *  - "PDF import: pdf-parse (lazy-required)"
 *  - Extracts real textual contents from standard PDF documents.
 *  - Handles multi-page text concatenation with clean newline formatting.
 *  - Gracefully detects and handles malformed, corrupt, or password-protected PDFs.
 */

import { AppLogger } from '../utils/AppLogger';

const logger = new AppLogger({ mirrorToStderr: false });

export interface PdfExtractResult {
  text: string;
  numPages: number;
  info?: Record<string, any>;
}

export class PdfTextExtractor {
  private static pdfParseModule: any = null;

  /**
   * Lazily loads pdf-parse to avoid startup overhead (ZBot §2).
   */
  private static getPdfParse(): any {
    if (!this.pdfParseModule) {
      try {
        // Use standard require for lazy loading
        this.pdfParseModule = require('pdf-parse');
      } catch (err) {
        logger.error('pdf_extractor', 'Failed to load pdf-parse module', err as Error);
        throw new Error('PDF parsing engine is not installed or failed to load.');
      }
    }
    return this.pdfParseModule;
  }

  /**
   * Extracts clean plain text from a PDF binary buffer.
   *
   * @param buffer PDF data as Buffer, Uint8Array, or ArrayBuffer
   * @returns Clean extracted text string
   */
  static async extractText(buffer: Buffer | Uint8Array | ArrayBuffer): Promise<string> {
    const result = await this.extract(buffer);
    return result.text;
  }

  /**
   * Extracts text and document metadata from a PDF binary buffer.
   */
  static async extract(buffer: Buffer | Uint8Array | ArrayBuffer): Promise<PdfExtractResult> {
    if (!buffer || (Buffer.isBuffer(buffer) && buffer.length === 0)) {
      throw new Error('Cannot extract text from empty PDF buffer.');
    }

    const nodeBuffer = Buffer.isBuffer(buffer)
      ? buffer
      : Buffer.from(buffer as ArrayBuffer);

    // Validate PDF magic bytes (%PDF- / 0x25 0x50 0x44 0x46)
    if (nodeBuffer.length < 5 || !nodeBuffer.subarray(0, 5).toString('ascii').startsWith('%PDF-')) {
      throw new Error('Invalid PDF file: Missing %PDF- file signature header.');
    }

    const mod = this.getPdfParse();

    try {
      let rawText = '';
      let numPages = 1;
      let info: Record<string, any> | undefined;

      if (typeof mod === 'function') {
        const data = await mod(nodeBuffer);
        rawText = data && typeof data.text === 'string' ? data.text : '';
        numPages = data?.numpages || 1;
        info = data?.info;
      } else if (mod?.PDFParse) {
        const parser = new mod.PDFParse({ data: nodeBuffer });
        const res = await parser.getText();
        rawText = res && typeof res.text === 'string' ? res.text : '';
        numPages = res?.total || (res?.pages ? res.pages.length : 1);
        info = parser.getInfo ? await parser.getInfo().catch(() => undefined) : undefined;
      } else if (mod?.default && typeof mod.default === 'function') {
        const data = await mod.default(nodeBuffer);
        rawText = data && typeof data.text === 'string' ? data.text : '';
        numPages = data?.numpages || 1;
        info = data?.info;
      } else {
        throw new Error('Unsupported pdf-parse engine interface.');
      }
      
      // Clean up common PDF rendering artifacts and page pagination footers
      const cleanText = rawText
        .replace(/\x00/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\f/g, '\n\n')
        .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '')
        .trim();

      if (!cleanText) {
        throw new Error('PDF document contains no selectable text (scanned images or empty pages).');
      }

      return {
        text: cleanText,
        numPages,
        info,
      };
    } catch (err: any) {
      const errMsg = String(err?.message || err);
      logger.warn('pdf_extractor', 'PDF extraction failed', { error: errMsg });

      if (/password/i.test(errMsg) || /encrypted/i.test(errMsg)) {
        throw new Error('PDF is password protected or encrypted. Please provide an unlocked document.');
      }

      if (/Invalid PDF/i.test(errMsg) || /corrupt/i.test(errMsg) || /no selectable text/i.test(errMsg)) {
        throw err instanceof Error ? err : new Error(errMsg);
      }

      throw new Error(`Failed to extract text from PDF: ${errMsg}`);
    }
  }
}
