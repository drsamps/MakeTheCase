/**
 * Prompt Service
 * Manages AI prompt templates with versioning and active version selection
 */

import { pool } from '../db.js';

/**
 * Get the active prompt version for a specific use case
 * @param {string} use - The prompt use case (e.g., 'case_outline_generation', 'notes_cleanup')
 * @returns {Promise<{id: number, use: string, version: string, description: string, prompt_template: string}>}
 */
export async function getActivePrompt(use) {
  try {
    // Get the active version from settings
    const settingKey = `active_prompt_${use}`;
    const [settingsRows] = await pool.execute(
      'SELECT setting_value FROM settings WHERE setting_key = ?',
      [settingKey]
    );

    if (settingsRows.length === 0) {
      throw new Error(`No active prompt configured for use: ${use}`);
    }

    const activeVersion = settingsRows[0].setting_value;

    // Get the prompt template
    const [promptRows] = await pool.execute(
      'SELECT id, `use`, version, description, prompt_template FROM ai_prompts WHERE `use` = ? AND version = ? AND enabled = 1',
      [use, activeVersion]
    );

    if (promptRows.length === 0) {
      throw new Error(`Prompt not found for use: ${use}, version: ${activeVersion}`);
    }

    return promptRows[0];
  } catch (error) {
    throw new Error(`Failed to get active prompt: ${error.message}`);
  }
}

/**
 * Get all prompt versions for a specific use case
 * @param {string} use - The prompt use case
 * @returns {Promise<Array>} - Array of prompt versions
 */
export async function getAllPromptsForUse(use) {
  try {
    const [rows] = await pool.execute(
      'SELECT id, `use`, version, description, prompt_template, enabled, created_at, updated_at FROM ai_prompts WHERE `use` = ? ORDER BY version',
      [use]
    );
    return rows;
  } catch (error) {
    throw new Error(`Failed to get prompts for use ${use}: ${error.message}`);
  }
}

/**
 * Get all prompts (optionally filtered by use)
 * @param {string|null} use - Optional filter by use case
 * @returns {Promise<Array>} - Array of all prompts with active status
 */
export async function getAllPrompts(use = null) {
  try {
    let query = `
      SELECT
        ap.id,
        ap.use,
        ap.version,
        ap.description,
        ap.prompt_template,
        ap.enabled,
        ap.created_at,
        ap.updated_at,
        s.setting_value as active_version
      FROM ai_prompts ap
      LEFT JOIN settings s ON s.setting_key = CONCAT('active_prompt_', ap.use)
    `;
    const params = [];

    if (use) {
      query += ' WHERE ap.use = ?';
      params.push(use);
    }

    query += ' ORDER BY ap.use, ap.version';

    const [rows] = await pool.execute(query, params);

    // Add is_active flag
    return rows.map(row => ({
      ...row,
      is_active: row.version === row.active_version
    }));
  } catch (error) {
    throw new Error(`Failed to get prompts: ${error.message}`);
  }
}

/**
 * Get a single prompt by ID
 * @param {number} id - Prompt ID
 * @returns {Promise<Object>} - Prompt object
 */
export async function getPromptById(id) {
  try {
    const [rows] = await pool.execute(
      'SELECT id, `use`, version, description, prompt_template, enabled, created_at, updated_at FROM ai_prompts WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      throw new Error(`Prompt not found with id: ${id}`);
    }

    return rows[0];
  } catch (error) {
    throw new Error(`Failed to get prompt: ${error.message}`);
  }
}

/**
 * Create a new prompt version
 * @param {Object} promptData - {use, version, description, prompt_template}
 * @returns {Promise<Object>} - Created prompt
 */
export async function createPrompt(promptData) {
  const { use, version, description, prompt_template } = promptData;

  if (!use || !version || !prompt_template) {
    throw new Error('Missing required fields: use, version, prompt_template');
  }

  try {
    const [result] = await pool.execute(
      'INSERT INTO ai_prompts (`use`, version, description, prompt_template, enabled) VALUES (?, ?, ?, ?, 1)',
      [use, version, description || null, prompt_template]
    );

    return await getPromptById(result.insertId);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      throw new Error(`Prompt already exists for use: ${use}, version: ${version}`);
    }
    throw new Error(`Failed to create prompt: ${error.message}`);
  }
}

/**
 * Update an existing prompt
 * @param {number} id - Prompt ID
 * @param {Object} updateData - Fields to update {description, prompt_template, enabled}
 * @returns {Promise<Object>} - Updated prompt
 */
export async function updatePrompt(id, updateData) {
  const { description, prompt_template, enabled } = updateData;

  const updates = [];
  const values = [];

  if (description !== undefined) {
    updates.push('description = ?');
    values.push(description);
  }

  if (prompt_template !== undefined) {
    updates.push('prompt_template = ?');
    values.push(prompt_template);
  }

  if (enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(enabled ? 1 : 0);
  }

  if (updates.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(id);

  try {
    await pool.execute(
      `UPDATE ai_prompts SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    return await getPromptById(id);
  } catch (error) {
    throw new Error(`Failed to update prompt: ${error.message}`);
  }
}

/**
 * Delete (disable) a prompt
 * @param {number} id - Prompt ID
 * @returns {Promise<boolean>} - Success status
 */
export async function deletePrompt(id) {
  try {
    // Check if this is the active version
    const prompt = await getPromptById(id);
    const settingKey = `active_prompt_${prompt.use}`;

    const [settings] = await pool.execute(
      'SELECT setting_value FROM settings WHERE setting_key = ?',
      [settingKey]
    );

    if (settings.length > 0 && settings[0].setting_value === prompt.version) {
      throw new Error('Cannot delete the currently active prompt version');
    }

    // Soft delete by disabling
    await pool.execute(
      'UPDATE ai_prompts SET enabled = 0 WHERE id = ?',
      [id]
    );

    return true;
  } catch (error) {
    throw new Error(`Failed to delete prompt: ${error.message}`);
  }
}

/**
 * Set the active prompt version for a use case
 * @param {string} use - The prompt use case
 * @param {string} version - The version to activate
 * @returns {Promise<boolean>} - Success status
 */
export async function setActivePrompt(use, version) {
  try {
    // Verify the prompt exists and is enabled
    const [prompts] = await pool.execute(
      'SELECT id FROM ai_prompts WHERE `use` = ? AND version = ? AND enabled = 1',
      [use, version]
    );

    if (prompts.length === 0) {
      throw new Error(`Prompt not found or disabled: ${use} / ${version}`);
    }

    const settingKey = `active_prompt_${use}`;

    // Update or insert setting
    await pool.execute(
      `INSERT INTO settings (setting_key, setting_value, description)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = CURRENT_TIMESTAMP`,
      [
        settingKey,
        version,
        `Active version for ${use} prompts`,
        version
      ]
    );

    return true;
  } catch (error) {
    throw new Error(`Failed to set active prompt: ${error.message}`);
  }
}

/**
 * Render a prompt template by replacing {placeholder} variables
 * @param {string} template - The prompt template with {placeholders}
 * @param {Object} variables - Object with variable values {placeholder_name: value}
 * @returns {string} - Rendered prompt
 */
export function renderPrompt(template, variables) {
  if (!template) return '';

  let rendered = template;

  // Replace all {variable_name} placeholders
  Object.keys(variables).forEach((key) => {
    const placeholder = `{${key}}`;
    const value = variables[key] || '';
    rendered = rendered.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
  });

  return rendered;
}

/**
 * Get all available prompt use cases
 * @returns {Promise<Array<string>>} - List of unique use cases
 */
export async function getAllPromptUses() {
  try {
    const [rows] = await pool.execute(
      'SELECT DISTINCT `use` FROM ai_prompts ORDER BY `use`'
    );
    return rows.map(row => row.use);
  } catch (error) {
    throw new Error(`Failed to get prompt uses: ${error.message}`);
  }
}

/**
 * Get all settings
 * @returns {Promise<Object>} - Settings as key-value object
 */
export async function getAllSettings() {
  try {
    const [rows] = await pool.execute(
      'SELECT setting_key, setting_value, description FROM settings ORDER BY setting_key'
    );

    const settings = {};
    rows.forEach(row => {
      settings[row.setting_key] = {
        value: row.setting_value,
        description: row.description
      };
    });

    return settings;
  } catch (error) {
    throw new Error(`Failed to get settings: ${error.message}`);
  }
}

/**
 * Get a single setting value
 * @param {string} key - Setting key
 * @returns {Promise<string|null>} - Setting value or null
 */
export async function getSetting(key) {
  try {
    const [rows] = await pool.execute(
      'SELECT setting_value FROM settings WHERE setting_key = ?',
      [key]
    );

    return rows.length > 0 ? rows[0].setting_value : null;
  } catch (error) {
    throw new Error(`Failed to get setting: ${error.message}`);
  }
}

/**
 * Update a setting value
 * @param {string} key - Setting key
 * @param {string} value - New setting value
 * @returns {Promise<boolean>} - Success status
 */
export async function updateSetting(key, value) {
  try {
    // If it's a prompt setting, validate the prompt exists
    if (key.startsWith('active_prompt_')) {
      const use = key.replace('active_prompt_', '');
      const [prompts] = await pool.execute(
        'SELECT id FROM ai_prompts WHERE `use` = ? AND version = ? AND enabled = 1',
        [use, value]
      );

      if (prompts.length === 0) {
        throw new Error(`Invalid prompt version: ${value} for use: ${use}`);
      }
    }

    await pool.execute(
      'UPDATE settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?',
      [value, key]
    );

    return true;
  } catch (error) {
    throw new Error(`Failed to update setting: ${error.message}`);
  }
}
