/**
 * Rubric Service
 * Manages evaluation rubrics and criteria with prompt caching
 */

import { pool } from '../db.js';

/**
 * Generate the LLM evaluation prompt from an array of criteria
 * @param {Array} criteria - Array of criteria objects with question_text, max_points, scoring_guide
 * @returns {string} - Generated prompt text
 */
export function generateCriteriaPrompt(criteria) {
  if (!criteria || criteria.length === 0) {
    return '';
  }

  let prompt = 'Evaluate the student based on the following criteria:\n\n';

  criteria.forEach((c, index) => {
    prompt += `Q${index + 1}. ${c.question_text} (${c.max_points} points)\n`;

    if (c.scoring_guide) {
      const guide = typeof c.scoring_guide === 'string'
        ? JSON.parse(c.scoring_guide)
        : c.scoring_guide;

      for (let i = 1; i <= c.max_points; i++) {
        const desc = guide[String(i)] || '';
        if (desc) {
          prompt += `- ${i} point${i > 1 ? 's' : ''} = ${desc}\n`;
        }
      }
    }
    prompt += '\n';
  });

  return prompt.trim();
}

/**
 * Calculate total points from an array of criteria
 * @param {Array} criteria - Array of criteria objects with max_points
 * @returns {number} - Sum of max_points
 */
export function calculateTotalPoints(criteria) {
  if (!criteria || criteria.length === 0) {
    return 0;
  }
  return criteria.reduce((sum, c) => sum + (c.max_points || 0), 0);
}

/**
 * Get the system default rubric with resolved criteria
 * @returns {Promise<Object|null>} - Default rubric or null
 */
export async function getDefaultRubric() {
  try {
    const [rubrics] = await pool.execute(
      `SELECT rubric_id, rubric_name, description, criteria_ids, total_points,
              criteria_prompt, additional_prompt, prompt_stale, is_system_default,
              created_by, enabled, created_at, updated_at
       FROM rubrics
       WHERE is_system_default = 1 AND enabled = 1
       LIMIT 1`
    );

    if (rubrics.length === 0) {
      return null;
    }

    const rubric = rubrics[0];
    rubric.criteria = await getCriteriaForRubric(rubric.criteria_ids);
    return rubric;
  } catch (error) {
    throw new Error(`Failed to get default rubric: ${error.message}`);
  }
}

/**
 * Get a rubric by ID with resolved criteria
 * @param {number} rubricId - Rubric ID
 * @returns {Promise<Object|null>} - Rubric or null
 */
export async function getRubricById(rubricId) {
  try {
    const [rubrics] = await pool.execute(
      `SELECT rubric_id, rubric_name, description, criteria_ids, total_points,
              criteria_prompt, additional_prompt, prompt_stale, is_system_default,
              created_by, enabled, created_at, updated_at
       FROM rubrics
       WHERE rubric_id = ?`,
      [rubricId]
    );

    if (rubrics.length === 0) {
      return null;
    }

    const rubric = rubrics[0];
    rubric.criteria = await getCriteriaForRubric(rubric.criteria_ids);
    return rubric;
  } catch (error) {
    throw new Error(`Failed to get rubric: ${error.message}`);
  }
}

/**
 * Set a rubric as the system default
 * @param {number} rubricId - Rubric ID to set as default
 * @returns {Promise<Object>} - Updated rubric
 */
export async function setDefaultRubric(rubricId) {
  try {
    // First check if the rubric exists and is enabled
    const [rubrics] = await pool.execute(
      'SELECT rubric_id, enabled FROM rubrics WHERE rubric_id = ?',
      [rubricId]
    );

    if (rubrics.length === 0) {
      throw new Error(`Rubric not found: ${rubricId}`);
    }

    if (!rubrics[0].enabled) {
      throw new Error('Cannot set disabled rubric as default');
    }

    // Clear current default(s)
    await pool.execute(
      'UPDATE rubrics SET is_system_default = 0 WHERE is_system_default = 1'
    );

    // Set new default
    await pool.execute(
      'UPDATE rubrics SET is_system_default = 1, updated_at = CURRENT_TIMESTAMP WHERE rubric_id = ?',
      [rubricId]
    );

    return await getRubricById(rubricId);
  } catch (error) {
    throw new Error(`Failed to set default rubric: ${error.message}`);
  }
}

/**
 * Get criteria objects for a rubric's criteria_ids array
 * @param {string|Array} criteriaIds - JSON string or array of criteria_id values
 * @returns {Promise<Array>} - Ordered array of criteria objects
 */
export async function getCriteriaForRubric(criteriaIds) {
  try {
    const ids = typeof criteriaIds === 'string' ? JSON.parse(criteriaIds) : criteriaIds;

    if (!ids || ids.length === 0) {
      return [];
    }

    // Get all criteria matching the IDs
    const placeholders = ids.map(() => '?').join(', ');
    const [criteria] = await pool.execute(
      `SELECT id, criteria_id, name, question_text, max_points, scoring_guide,
              prompt_text, created_by, enabled, created_at, updated_at
       FROM rubric_criteria
       WHERE criteria_id IN (${placeholders}) AND enabled = 1`,
      ids
    );

    // Sort criteria to match the order in criteria_ids
    const criteriaMap = new Map(criteria.map(c => [c.criteria_id, c]));
    const orderedCriteria = ids
      .map(id => criteriaMap.get(id))
      .filter(c => c !== undefined);

    return orderedCriteria;
  } catch (error) {
    throw new Error(`Failed to get criteria for rubric: ${error.message}`);
  }
}

/**
 * Regenerate the criteria_prompt and total_points for a rubric
 * @param {number} rubricId - Rubric ID
 * @returns {Promise<Object>} - Updated rubric
 */
export async function regenerateRubricPrompt(rubricId) {
  try {
    // Get the rubric
    const [rubrics] = await pool.execute(
      'SELECT criteria_ids FROM rubrics WHERE rubric_id = ?',
      [rubricId]
    );

    if (rubrics.length === 0) {
      throw new Error(`Rubric not found: ${rubricId}`);
    }

    // Get criteria
    const criteria = await getCriteriaForRubric(rubrics[0].criteria_ids);

    // Generate new prompt and calculate total
    const criteriaPrompt = generateCriteriaPrompt(criteria);
    const totalPoints = calculateTotalPoints(criteria);

    // Update the rubric
    await pool.execute(
      `UPDATE rubrics
       SET criteria_prompt = ?, total_points = ?, prompt_stale = 0, updated_at = CURRENT_TIMESTAMP
       WHERE rubric_id = ?`,
      [criteriaPrompt, totalPoints, rubricId]
    );

    return await getRubricById(rubricId);
  } catch (error) {
    throw new Error(`Failed to regenerate rubric prompt: ${error.message}`);
  }
}

/**
 * Mark rubrics as stale when a criterion is updated
 * @param {string} criteriaId - The criteria_id that was updated
 * @returns {Promise<number>} - Number of rubrics marked stale
 */
export async function markRubricsStale(criteriaId) {
  try {
    // Find all rubrics that contain this criteria_id
    const [result] = await pool.execute(
      `UPDATE rubrics
       SET prompt_stale = 1, updated_at = CURRENT_TIMESTAMP
       WHERE JSON_CONTAINS(criteria_ids, ?)`,
      [JSON.stringify(criteriaId)]
    );

    return result.affectedRows;
  } catch (error) {
    throw new Error(`Failed to mark rubrics stale: ${error.message}`);
  }
}

/**
 * Get all rubrics that use a specific criterion
 * @param {string} criteriaId - The criteria_id to search for
 * @returns {Promise<Array>} - Array of rubric summaries
 */
export async function getRubricsUsingCriterion(criteriaId) {
  try {
    const [rubrics] = await pool.execute(
      `SELECT rubric_id, rubric_name, is_system_default, prompt_stale
       FROM rubrics
       WHERE JSON_CONTAINS(criteria_ids, ?) AND enabled = 1
       ORDER BY rubric_name`,
      [JSON.stringify(criteriaId)]
    );

    return rubrics;
  } catch (error) {
    throw new Error(`Failed to get rubrics using criterion: ${error.message}`);
  }
}

/**
 * Get all section-case assignments using a specific rubric
 * @param {number} rubricId - The rubric ID to search for
 * @returns {Promise<Array>} - Array of assignment summaries with section and case info
 */
export async function getAssignmentsUsingRubric(rubricId) {
  try {
    const [assignments] = await pool.execute(
      `SELECT sc.section_id, sc.case_id, sc.active,
              s.section_title, s.year_term,
              c.case_title
       FROM section_cases sc
       JOIN sections s ON sc.section_id = s.section_id
       JOIN cases c ON sc.case_id = c.case_id
       WHERE sc.rubric_id = ?
       ORDER BY s.year_term DESC, s.section_title, c.case_title`,
      [rubricId]
    );

    return assignments;
  } catch (error) {
    throw new Error(`Failed to get assignments using rubric: ${error.message}`);
  }
}

/**
 * Get a criterion by its criteria_id
 * @param {string} criteriaId - User-specified criteria identifier
 * @returns {Promise<Object|null>} - Criterion or null
 */
export async function getCriterionById(criteriaId) {
  try {
    const [criteria] = await pool.execute(
      `SELECT id, criteria_id, name, question_text, max_points, scoring_guide,
              prompt_text, created_by, enabled, created_at, updated_at
       FROM rubric_criteria
       WHERE criteria_id = ?`,
      [criteriaId]
    );

    return criteria.length > 0 ? criteria[0] : null;
  } catch (error) {
    throw new Error(`Failed to get criterion: ${error.message}`);
  }
}

/**
 * Get all criteria
 * @param {boolean} enabledOnly - Only return enabled criteria
 * @returns {Promise<Array>} - Array of criteria
 */
export async function getAllCriteria(enabledOnly = true) {
  try {
    let query = `SELECT id, criteria_id, name, question_text, max_points, scoring_guide,
                        prompt_text, created_by, enabled, created_at, updated_at
                 FROM rubric_criteria`;

    if (enabledOnly) {
      query += ' WHERE enabled = 1';
    }

    query += ' ORDER BY name';

    const [criteria] = await pool.execute(query);
    return criteria;
  } catch (error) {
    throw new Error(`Failed to get all criteria: ${error.message}`);
  }
}

/**
 * Get all rubrics
 * @param {boolean} enabledOnly - Only return enabled rubrics
 * @returns {Promise<Array>} - Array of rubrics (without resolved criteria)
 */
export async function getAllRubrics(enabledOnly = true) {
  try {
    let query = `SELECT rubric_id, rubric_name, description, criteria_ids, total_points,
                        criteria_prompt, additional_prompt, prompt_stale, is_system_default,
                        created_by, enabled, created_at, updated_at
                 FROM rubrics`;

    if (enabledOnly) {
      query += ' WHERE enabled = 1';
    }

    query += ' ORDER BY is_system_default DESC, rubric_name';

    const [rubrics] = await pool.execute(query);
    return rubrics;
  } catch (error) {
    throw new Error(`Failed to get all rubrics: ${error.message}`);
  }
}

/**
 * Create a new criterion
 * @param {Object} data - Criterion data
 * @returns {Promise<Object>} - Created criterion
 */
export async function createCriterion(data) {
  const { criteria_id, name, question_text, max_points, scoring_guide, prompt_text, created_by } = data;

  if (!criteria_id || !name || !question_text) {
    throw new Error('Missing required fields: criteria_id, name, question_text');
  }

  try {
    const scoringGuideJson = scoring_guide
      ? (typeof scoring_guide === 'string' ? scoring_guide : JSON.stringify(scoring_guide))
      : null;

    await pool.execute(
      `INSERT INTO rubric_criteria (criteria_id, name, question_text, max_points, scoring_guide, prompt_text, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [criteria_id, name, question_text, max_points || 5, scoringGuideJson, prompt_text || null, created_by || null]
    );

    return await getCriterionById(criteria_id);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      throw new Error(`Criterion already exists with criteria_id: ${criteria_id}`);
    }
    throw new Error(`Failed to create criterion: ${error.message}`);
  }
}

/**
 * Update an existing criterion
 * @param {string} criteriaId - The criteria_id to update
 * @param {Object} data - Fields to update
 * @returns {Promise<Object>} - Updated criterion and count of affected rubrics
 */
export async function updateCriterion(criteriaId, data) {
  const { name, question_text, max_points, scoring_guide, prompt_text, enabled } = data;

  const updates = [];
  const values = [];

  if (name !== undefined) {
    updates.push('name = ?');
    values.push(name);
  }
  if (question_text !== undefined) {
    updates.push('question_text = ?');
    values.push(question_text);
  }
  if (max_points !== undefined) {
    updates.push('max_points = ?');
    values.push(max_points);
  }
  if (scoring_guide !== undefined) {
    updates.push('scoring_guide = ?');
    values.push(typeof scoring_guide === 'string' ? scoring_guide : JSON.stringify(scoring_guide));
  }
  if (prompt_text !== undefined) {
    updates.push('prompt_text = ?');
    values.push(prompt_text);
  }
  if (enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(enabled ? 1 : 0);
  }

  if (updates.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(criteriaId);

  try {
    await pool.execute(
      `UPDATE rubric_criteria SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE criteria_id = ?`,
      values
    );

    // Mark rubrics using this criterion as stale
    const affectedRubrics = await markRubricsStale(criteriaId);

    const criterion = await getCriterionById(criteriaId);
    return { criterion, affectedRubrics };
  } catch (error) {
    throw new Error(`Failed to update criterion: ${error.message}`);
  }
}

/**
 * Delete a criterion (fails if used in any rubric)
 * @param {string} criteriaId - The criteria_id to delete
 * @returns {Promise<boolean>} - Success status
 */
export async function deleteCriterion(criteriaId) {
  try {
    // Check if any rubrics use this criterion
    const rubrics = await getRubricsUsingCriterion(criteriaId);
    if (rubrics.length > 0) {
      const names = rubrics.map(r => r.rubric_name).join(', ');
      throw new Error(`Cannot delete criterion: used by rubrics: ${names}`);
    }

    await pool.execute(
      'DELETE FROM rubric_criteria WHERE criteria_id = ?',
      [criteriaId]
    );

    return true;
  } catch (error) {
    throw new Error(`Failed to delete criterion: ${error.message}`);
  }
}

/**
 * Create a new rubric
 * @param {Object} data - Rubric data
 * @returns {Promise<Object>} - Created rubric
 */
export async function createRubric(data) {
  const { rubric_name, description, criteria_ids, additional_prompt, created_by } = data;

  if (!rubric_name || !criteria_ids || criteria_ids.length === 0) {
    throw new Error('Missing required fields: rubric_name, criteria_ids (non-empty array)');
  }

  try {
    // Validate all criteria_ids exist
    const criteria = await getCriteriaForRubric(criteria_ids);
    if (criteria.length !== criteria_ids.length) {
      const foundIds = criteria.map(c => c.criteria_id);
      const missingIds = criteria_ids.filter(id => !foundIds.includes(id));
      throw new Error(`Invalid criteria_ids: ${missingIds.join(', ')}`);
    }

    // Generate prompt and calculate total
    const criteriaPrompt = generateCriteriaPrompt(criteria);
    const totalPoints = calculateTotalPoints(criteria);

    const criteriaIdsJson = JSON.stringify(criteria_ids);

    const [result] = await pool.execute(
      `INSERT INTO rubrics (rubric_name, description, criteria_ids, total_points, criteria_prompt, additional_prompt, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [rubric_name, description || null, criteriaIdsJson, totalPoints, criteriaPrompt, additional_prompt || null, created_by || null]
    );

    return await getRubricById(result.insertId);
  } catch (error) {
    throw new Error(`Failed to create rubric: ${error.message}`);
  }
}

/**
 * Update an existing rubric
 * @param {number} rubricId - Rubric ID
 * @param {Object} data - Fields to update
 * @returns {Promise<Object>} - Updated rubric
 */
export async function updateRubric(rubricId, data) {
  const { rubric_name, description, criteria_ids, additional_prompt, enabled } = data;

  // Check if it's the system default (some fields cannot be changed)
  const existing = await getRubricById(rubricId);
  if (!existing) {
    throw new Error(`Rubric not found: ${rubricId}`);
  }

  const updates = [];
  const values = [];

  if (rubric_name !== undefined) {
    updates.push('rubric_name = ?');
    values.push(rubric_name);
  }
  if (description !== undefined) {
    updates.push('description = ?');
    values.push(description);
  }
  if (additional_prompt !== undefined) {
    updates.push('additional_prompt = ?');
    values.push(additional_prompt);
  }
  if (enabled !== undefined) {
    if (existing.is_system_default && !enabled) {
      throw new Error('Cannot disable the system default rubric');
    }
    updates.push('enabled = ?');
    values.push(enabled ? 1 : 0);
  }

  // If criteria_ids changed, regenerate prompt
  if (criteria_ids !== undefined) {
    // Validate all criteria_ids exist
    const criteria = await getCriteriaForRubric(criteria_ids);
    if (criteria.length !== criteria_ids.length) {
      const foundIds = criteria.map(c => c.criteria_id);
      const missingIds = criteria_ids.filter(id => !foundIds.includes(id));
      throw new Error(`Invalid criteria_ids: ${missingIds.join(', ')}`);
    }

    const criteriaPrompt = generateCriteriaPrompt(criteria);
    const totalPoints = calculateTotalPoints(criteria);

    updates.push('criteria_ids = ?');
    values.push(JSON.stringify(criteria_ids));
    updates.push('criteria_prompt = ?');
    values.push(criteriaPrompt);
    updates.push('total_points = ?');
    values.push(totalPoints);
    updates.push('prompt_stale = 0');
  }

  if (updates.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(rubricId);

  try {
    await pool.execute(
      `UPDATE rubrics SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE rubric_id = ?`,
      values
    );

    return await getRubricById(rubricId);
  } catch (error) {
    throw new Error(`Failed to update rubric: ${error.message}`);
  }
}

/**
 * Delete a rubric (fails if system default)
 * @param {number} rubricId - Rubric ID
 * @returns {Promise<boolean>} - Success status
 */
export async function deleteRubric(rubricId) {
  try {
    const rubric = await getRubricById(rubricId);
    if (!rubric) {
      throw new Error(`Rubric not found: ${rubricId}`);
    }

    if (rubric.is_system_default) {
      throw new Error('Cannot delete the system default rubric');
    }

    // Check if any section_cases reference this rubric
    const [usages] = await pool.execute(
      `SELECT COUNT(*) as count FROM section_cases WHERE rubric_id = ?`,
      [rubricId]
    );

    if (usages[0].count > 0) {
      throw new Error(`Cannot delete rubric: used by ${usages[0].count} assignment(s). Remove rubric from assignments first.`);
    }

    await pool.execute(
      'DELETE FROM rubrics WHERE rubric_id = ?',
      [rubricId]
    );

    return true;
  } catch (error) {
    throw new Error(`Failed to delete rubric: ${error.message}`);
  }
}

/**
 * Get the rubric for a section-case assignment (or default)
 * @param {string} sectionId - Section ID
 * @param {string} caseId - Case ID
 * @returns {Promise<Object>} - Rubric with criteria
 */
export async function getRubricForAssignment(sectionId, caseId) {
  try {
    // Get the rubric_id from section_cases
    const [assignments] = await pool.execute(
      'SELECT rubric_id FROM section_cases WHERE section_id = ? AND case_id = ?',
      [sectionId, caseId]
    );

    if (assignments.length === 0 || !assignments[0].rubric_id) {
      // No specific rubric assigned, use default
      return await getDefaultRubric();
    }

    return await getRubricById(assignments[0].rubric_id);
  } catch (error) {
    throw new Error(`Failed to get rubric for assignment: ${error.message}`);
  }
}
