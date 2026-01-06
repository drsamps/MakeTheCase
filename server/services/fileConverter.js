/**
 * File Conversion Service
 * Converts PDF and Word documents to clean markdown/text
 */

import fs from 'fs/promises';
import mammoth from 'mammoth';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/**
 * Convert PDF to text using pdf-parse
 * @param {string} filePath - Path to PDF file
 * @returns {Promise<string>} - Extracted text
 */
export async function convertPdfToText(filePath) {
  try {
    // Using pdf-parse v1.1.1 which has simpler CommonJS exports
    const pdfParse = require('pdf-parse');
    const dataBuffer = await fs.readFile(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } catch (error) {
    console.error('[FileConverter] PDF conversion error:', error);
    throw new Error(`PDF conversion failed: ${error.message}`);
  }
}

/**
 * Convert DOCX to markdown using mammoth
 * @param {string} filePath - Path to DOCX file
 * @returns {Promise<string>} - Converted markdown
 */
export async function convertDocxToMarkdown(filePath) {
  try {
    const buffer = await fs.readFile(filePath);
    const result = await mammoth.convertToMarkdown({ buffer });

    if (result.messages && result.messages.length > 0) {
      console.warn('DOCX conversion warnings:', result.messages);
    }

    return result.value;
  } catch (error) {
    throw new Error(`DOCX conversion failed: ${error.message}`);
  }
}

/**
 * Convert DOCX to plain text (fallback option)
 * @param {string} filePath - Path to DOCX file
 * @returns {Promise<string>} - Extracted text
 */
export async function convertDocxToText(filePath) {
  try {
    const buffer = await fs.readFile(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error) {
    throw new Error(`DOCX text extraction failed: ${error.message}`);
  }
}

/**
 * Clean PDF text - fix common PDF conversion issues
 * @param {string} text - Raw PDF text
 * @returns {string} - Cleaned text
 */
export function cleanPdfText(text) {
  if (!text) return '';

  let cleaned = text;

  // Fix extra spaces between characters (e.g., "w o r d s" -> "words")
  // Look for single characters surrounded by spaces
  cleaned = cleaned.replace(/\b(\w)\s+(?=\w\s)/g, '$1');

  // More aggressive spacing fix for patterns like "w o r d s"
  // Match sequences of single letters with spaces
  cleaned = cleaned.replace(/(\b\w)\s+(\w)\s+(\w)\s+(\w)\s+(\w)/g, '$1$2$3$4$5');
  cleaned = cleaned.replace(/(\b\w)\s+(\w)\s+(\w)\s+(\w)/g, '$1$2$3$4');
  cleaned = cleaned.replace(/(\b\w)\s+(\w)\s+(\w)/g, '$1$2$3');

  // Remove excessive line breaks (more than 3 consecutive)
  cleaned = cleaned.replace(/\n{4,}/g, '\n\n\n');

  // Remove page numbers that appear alone on a line
  cleaned = cleaned.replace(/^\s*\d+\s*$/gm, '');

  // Remove common footer patterns (e.g., "Page 1 of 50")
  cleaned = cleaned.replace(/^(Page\s+)?\d+\s+(of\s+\d+)?$/gmi, '');

  // Remove standalone dates in common formats
  cleaned = cleaned.replace(/^\s*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\s*$/gm, '');

  // Clean up extra whitespace
  cleaned = cleaned.replace(/[ \t]+/g, ' '); // Multiple spaces to single space
  cleaned = cleaned.replace(/^\s+/gm, ''); // Leading whitespace on lines
  cleaned = cleaned.replace(/\s+$/gm, ''); // Trailing whitespace on lines

  // Remove zero-width and non-breaking spaces
  cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF]/g, '');
  cleaned = cleaned.replace(/\u00A0/g, ' ');

  return cleaned.trim();
}

/**
 * Detect and remove repeating headers/footers from PDF text
 * This function finds text that appears repeatedly throughout the document
 * @param {string} text - PDF text
 * @param {number} minRepeat - Minimum times a line should repeat to be considered header/footer
 * @returns {string} - Text with headers/footers removed
 */
export function detectAndRemoveHeadersFooters(text, minRepeat = 3) {
  if (!text) return '';

  const lines = text.split('\n');
  const lineFrequency = new Map();

  // Count frequency of each line (ignoring empty lines and very short lines)
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.length > 5 && trimmed.length < 200) { // Headers/footers are usually short
      lineFrequency.set(trimmed, (lineFrequency.get(trimmed) || 0) + 1);
    }
  });

  // Find lines that repeat more than minRepeat times (likely headers/footers)
  const headersFooters = new Set();
  lineFrequency.forEach((count, line) => {
    if (count >= minRepeat) {
      headersFooters.add(line);
    }
  });

  // Remove the identified headers/footers
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    return !headersFooters.has(trimmed);
  });

  return filtered.join('\n');
}

/**
 * Full conversion pipeline for a file
 * @param {string} filePath - Path to file
 * @param {string} fileExtension - File extension (.pdf, .docx, .txt, .md)
 * @returns {Promise<{text: string, format: string}>} - Converted text and source format
 */
export async function convertFile(filePath, fileExtension) {
  const ext = fileExtension.toLowerCase();

  try {
    if (ext === '.pdf') {
      let text = await convertPdfToText(filePath);
      text = cleanPdfText(text);
      text = detectAndRemoveHeadersFooters(text);
      return { text, format: 'pdf' };
    }

    if (ext === '.docx' || ext === '.doc') {
      // Try markdown conversion first
      try {
        const markdown = await convertDocxToMarkdown(filePath);
        return { text: markdown, format: 'docx-markdown' };
      } catch (error) {
        console.warn('Markdown conversion failed, falling back to text extraction:', error.message);
        const text = await convertDocxToText(filePath);
        return { text: cleanPdfText(text), format: 'docx-text' };
      }
    }

    if (ext === '.txt' || ext === '.md') {
      const text = await fs.readFile(filePath, 'utf-8');
      return { text, format: ext === '.md' ? 'markdown' : 'text' };
    }

    throw new Error(`Unsupported file format: ${ext}`);
  } catch (error) {
    throw new Error(`File conversion failed: ${error.message}`);
  }
}

/**
 * Get file size in bytes
 * @param {string} filePath - Path to file
 * @returns {Promise<number>} - File size in bytes
 */
export async function getFileSize(filePath) {
  const stats = await fs.stat(filePath);
  return stats.size;
}

/**
 * Validate file size (max 10MB for case prep)
 * @param {string} filePath - Path to file
 * @param {number} maxSizeBytes - Maximum file size in bytes (default 10MB)
 * @returns {Promise<boolean>} - True if file is within size limit
 */
export async function validateFileSize(filePath, maxSizeBytes = 10 * 1024 * 1024) {
  const size = await getFileSize(filePath);
  return size <= maxSizeBytes;
}
