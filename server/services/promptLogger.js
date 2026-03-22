/**
 * Prompt Logger Service
 * Handles logging of AI model calls for case chats and evaluations
 */

import { pool } from '../db.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Get project root directory (one level up from server/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const LOG_DIR = path.join(PROJECT_ROOT, 'logs');

/**
 * Get a setting value from the database
 * @param {string} key - Setting key
 * @returns {Promise<string|null>} - Setting value or null
 */
async function getSetting(key) {
  try {
    const [rows] = await pool.execute(
      'SELECT setting_value FROM settings WHERE setting_key = ?',
      [key]
    );
    return rows.length > 0 ? rows[0].setting_value : null;
  } catch (error) {
    console.warn(`Failed to get setting ${key}:`, error.message);
    return null;
  }
}

/**
 * Update a setting value in the database
 * @param {string} key - Setting key
 * @param {string} value - New setting value
 */
async function updateSettingValue(key, value) {
  await pool.execute(
    'UPDATE settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?',
    [value, key]
  );
}

/**
 * Check if logging is enabled for a specific type
 * @param {'chat' | 'eval'} logType - Type of log
 * @returns {Promise<boolean>}
 */
export async function isLoggingEnabled(logType) {
  const settingKey = logType === 'chat' ? 'log_case_chat_prompts' : 'log_evaluation_prompts';
  const value = await getSetting(settingKey);
  return value !== null && parseInt(value, 10) > 0;
}

/**
 * Ensure the logs directory exists
 */
async function ensureLogDir() {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Sanitize a string for use in filenames
 * Replaces invalid characters (\ / : * ? " < > |) with underscores
 * @param {string} str
 * @returns {string}
 */
function sanitizeForFilename(str) {
  return str.replace(/[\\/:*?"<>|]/g, '_');
}

/**
 * Generate a timestamped filename for a log
 * @param {'chat' | 'eval'} logType
 * @param {string} studentId
 * @param {string} caseId
 * @returns {string}
 */
function generateFilename(logType, studentId, caseId) {
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/T/, '_')
    .replace(/:/g, '-')
    .replace(/\..+/, '');
  const typeLabel = logType === 'chat' ? 'CHAT' : 'EVAL';
  // Sanitize and truncate IDs to prevent invalid filenames
  const shortStudentId = sanitizeForFilename(studentId).substring(0, 20);
  const shortCaseId = sanitizeForFilename(caseId).substring(0, 20);
  return `${timestamp}_${typeLabel}-${shortStudentId}-${shortCaseId}-prompt.txt`;
}

/**
 * Strip case context content from prompt using <context> tags
 * - If content is substantial, replaces with "NOT SHOWN IN THIS LOG"
 * - If content is empty/minimal, replaces with "NOT INCLUDED IN PROMPT"
 * @param {string} prompt
 * @returns {string}
 */
function stripCaseContent(prompt) {
  // The boilerplate text that's always in the teaching_note section
  const teachingNoteBoilerplate = 'Use these points to formulate challenging questions and counter-arguments';

  // Replace content inside <context...>...</context> tags
  // Check if content is substantial or just boilerplate/empty
  return prompt.replace(
    /<context([^>]*)>([\s\S]*?)<\/context>/g,
    (match, attributes, content) => {
      const trimmedContent = content.trim();

      // Check if this is a teaching_note with minimal content
      const isTeachingNote = attributes.includes('type="teaching_note"');
      const isMinimalContent = trimmedContent.length < 300 ||
        (isTeachingNote && trimmedContent.startsWith(teachingNoteBoilerplate) && trimmedContent.length < 300);

      if (isMinimalContent) {
        return `<context${attributes}>NOT INCLUDED IN PROMPT</context>`;
      }
      return `<context${attributes}>NOT SHOWN IN THIS LOG</context>`;
    }
  );
}

/**
 * Strip case content if the setting says to do so
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function stripCaseContentIfNeeded(prompt) {
  const fullContext = await getSetting('log_with_full_case_context');
  if (fullContext === 'true') {
    return prompt; // Return unchanged
  }
  return stripCaseContent(prompt);
}

/**
 * Format conversation history for logging
 * @param {Array<{role: string, content: string}>} history
 * @returns {string}
 */
function formatHistory(history) {
  if (!history || history.length === 0) {
    return '(No previous messages)';
  }

  return history.map((msg, i) => {
    const roleLabel = msg.role === 'user' ? 'STUDENT' : 'AI';
    return `[${i + 1}] ${roleLabel}:\n${msg.content}`;
  }).join('\n\n');
}

/**
 * Format log file content with headers
 * @param {'chat' | 'eval'} logType
 * @param {Object} metadata
 * @param {string} systemPrompt
 * @param {Array<{role: string, content: string}>} history - Conversation history (for chat logs)
 * @param {string} currentMessage - Current student message (for chat logs)
 * @param {string} response
 * @returns {string}
 */
function formatLogContent(logType, metadata, systemPrompt, history, currentMessage, response) {
  const headerType = logType === 'chat' ? 'CASE CHAT LOG' : 'TRANSCRIPT EVALUATION LOG';
  const separator = '='.repeat(60);

  if (logType === 'eval') {
    // Evaluation logs don't have history/message structure
    return `${separator}
${headerType}
${separator}
Student ID: ${metadata.studentId}
Case ID: ${metadata.caseId}
Model: ${metadata.modelId}
Timestamp: ${metadata.timestamp}
${separator}

=== EVALUATION PROMPT ===

${systemPrompt}

=== AI RESPONSE ===

${response}
`;
  }

  // Chat logs include system prompt, history, and current message
  return `${separator}
${headerType}
${separator}
Student ID: ${metadata.studentId}
Case ID: ${metadata.caseId}
Model: ${metadata.modelId}
Timestamp: ${metadata.timestamp}
${separator}

=== SYSTEM PROMPT ===

${systemPrompt}

=== CONVERSATION HISTORY ===

${formatHistory(history)}

=== CURRENT STUDENT MESSAGE ===

${currentMessage || '(No message)'}

=== AI RESPONSE ===

${response}
`;
}

/**
 * Decrement the logging counter for a type
 * Uses atomic SQL to prevent race conditions
 * @param {'chat' | 'eval'} logType
 */
async function decrementCounter(logType) {
  const settingKey = logType === 'chat' ? 'log_case_chat_prompts' : 'log_evaluation_prompts';
  await pool.execute(
    `UPDATE settings
     SET setting_value = CAST(GREATEST(CAST(setting_value AS SIGNED) - 1, 0) AS CHAR),
         updated_at = CURRENT_TIMESTAMP
     WHERE setting_key = ?`,
    [settingKey]
  );
}

/**
 * Check if we're under the max file limit
 * @returns {Promise<{ok: boolean, count: number, max: number}>}
 */
async function checkFileLimit() {
  const maxSetting = await getSetting('max_log_files');
  const maxFiles = maxSetting ? parseInt(maxSetting, 10) : 100;

  try {
    const files = await fs.readdir(LOG_DIR);
    const logFiles = files.filter(f => f.endsWith('-prompt.txt'));
    return {
      ok: logFiles.length < maxFiles,
      count: logFiles.length,
      max: maxFiles
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      // Directory doesn't exist yet, that's fine
      return { ok: true, count: 0, max: maxFiles };
    }
    throw error;
  }
}

/**
 * Log an error to the error log file
 * @param {Error} error
 * @param {Object} context
 */
async function logError(error, context = {}) {
  try {
    await ensureLogDir();
    const errorLogPath = path.join(LOG_DIR, 'error_log.txt');
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${error.message}\nContext: ${JSON.stringify(context)}\nStack: ${error.stack}\n\n`;
    await fs.appendFile(errorLogPath, entry);
  } catch (appendError) {
    console.error('Failed to write to error log:', appendError.message);
  }
}

/**
 * Main logging entry point - logs a prompt if enabled
 * This is async and non-blocking - errors don't propagate to caller
 * @param {Object} params
 * @param {'chat' | 'eval'} params.logType
 * @param {string} params.studentId
 * @param {string} params.caseId
 * @param {string} params.modelId
 * @param {string} params.systemPrompt - The system prompt
 * @param {Array<{role: string, content: string}>} [params.history] - Conversation history (chat only)
 * @param {string} [params.currentMessage] - Current student message (chat only)
 * @param {string} params.response
 */
export async function logPromptIfEnabled({ logType, studentId, caseId, modelId, systemPrompt, history, currentMessage, response }) {
  try {
    // Check if logging is enabled
    const enabled = await isLoggingEnabled(logType);
    if (!enabled) {
      return;
    }

    // Check file limit
    const limitCheck = await checkFileLimit();
    if (!limitCheck.ok) {
      const error = new Error(`Too many log files (${limitCheck.count}/${limitCheck.max}) - delete old files to resume logging`);
      await logError(error, { logType, studentId, caseId });
      console.warn(error.message);
      return;
    }

    // Ensure log directory exists
    await ensureLogDir();

    // Strip case content if needed
    const processedSystemPrompt = await stripCaseContentIfNeeded(systemPrompt);

    // Generate filename and content
    const filename = generateFilename(logType, studentId, caseId);
    const metadata = {
      studentId,
      caseId,
      modelId,
      timestamp: new Date().toISOString()
    };
    const content = formatLogContent(logType, metadata, processedSystemPrompt, history, currentMessage, response);

    // Write log file
    const filePath = path.join(LOG_DIR, filename);
    await fs.writeFile(filePath, content, 'utf-8');

    // Decrement counter
    await decrementCounter(logType);

    console.log(`Logged ${logType} prompt to ${filename}`);
  } catch (error) {
    // Don't throw - just log the error and continue
    console.warn(`Failed to log ${logType} prompt:`, error.message);
    await logError(error, { logType, studentId, caseId, modelId });
  }
}

/**
 * List log files in the logs directory
 * @param {'chat' | 'eval' | null} filter - Optional filter by type
 * @returns {Promise<Array<{filename: string, type: string, timestamp: string, studentId: string, caseId: string, size: number}>>}
 */
export async function listLogFiles(filter = null) {
  try {
    await ensureLogDir();
    const files = await fs.readdir(LOG_DIR);
    const logFiles = files.filter(f => f.endsWith('-prompt.txt'));

    const results = [];
    for (const filename of logFiles) {
      // Parse filename: {timestamp}_CHAT-{studentId}-{caseId}-prompt.txt
      const match = filename.match(/^(.+?)_(CHAT|EVAL)-([^-]+)-(.+)-prompt\.txt$/);
      if (!match) continue;

      const [, timestamp, type, studentId, caseId] = match;

      // Apply filter if specified
      if (filter) {
        const typeToMatch = filter === 'chat' ? 'CHAT' : 'EVAL';
        if (type !== typeToMatch) continue;
      }

      // Get file stats
      const filePath = path.join(LOG_DIR, filename);
      const stats = await fs.stat(filePath);

      // Convert timestamp from filename format (2026-03-21_23-17-34) to ISO format (2026-03-21T23:17:34)
      const [datePart, timePart] = timestamp.split('_');
      const isoTimestamp = timePart ? `${datePart}T${timePart.replace(/-/g, ':')}` : timestamp;

      results.push({
        filename,
        type: type.toLowerCase(),
        timestamp: isoTimestamp,
        studentId,
        caseId,
        size: stats.size,
        mtime: stats.mtime
      });
    }

    // Sort by modification time, newest first
    results.sort((a, b) => b.mtime - a.mtime);

    return results;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Read a log file's content
 * @param {string} filename
 * @returns {Promise<string>}
 */
export async function readLogFile(filename) {
  // Sanitize filename to prevent directory traversal
  const sanitized = path.basename(filename);
  if (!sanitized.endsWith('-prompt.txt') && sanitized !== 'error_log.txt') {
    throw new Error('Invalid log filename');
  }

  const filePath = path.join(LOG_DIR, sanitized);
  return await fs.readFile(filePath, 'utf-8');
}

/**
 * Delete a log file
 * @param {string} filename
 */
export async function deleteLogFile(filename) {
  // Sanitize filename to prevent directory traversal
  const sanitized = path.basename(filename);
  if (!sanitized.endsWith('-prompt.txt') && sanitized !== 'error_log.txt') {
    throw new Error('Invalid log filename');
  }

  const filePath = path.join(LOG_DIR, sanitized);
  await fs.unlink(filePath);
}

/**
 * Delete multiple log files
 * @param {string[]} filenames
 * @returns {Promise<{deleted: number, errors: string[]}>}
 */
export async function deleteLogFiles(filenames) {
  const errors = [];
  let deleted = 0;

  for (const filename of filenames) {
    try {
      await deleteLogFile(filename);
      deleted++;
    } catch (error) {
      errors.push(`${filename}: ${error.message}`);
    }
  }

  return { deleted, errors };
}

/**
 * Get current logging settings
 * @returns {Promise<Object>}
 */
export async function getLoggingSettings() {
  const [chatCount, evalCount, maxFiles, fullContext] = await Promise.all([
    getSetting('log_case_chat_prompts'),
    getSetting('log_evaluation_prompts'),
    getSetting('max_log_files'),
    getSetting('log_with_full_case_context')
  ]);

  return {
    log_case_chat_prompts: parseInt(chatCount || '0', 10),
    log_evaluation_prompts: parseInt(evalCount || '0', 10),
    max_log_files: parseInt(maxFiles || '100', 10),
    log_with_full_case_context: fullContext === 'true'
  };
}

/**
 * Update a logging setting
 * @param {string} key
 * @param {string|number|boolean} value
 */
export async function updateLoggingSetting(key, value) {
  const validKeys = ['log_case_chat_prompts', 'log_evaluation_prompts', 'max_log_files', 'log_with_full_case_context'];
  if (!validKeys.includes(key)) {
    throw new Error(`Invalid logging setting key: ${key}`);
  }

  // Convert value to string for storage
  const stringValue = String(value);
  await updateSettingValue(key, stringValue);
}
