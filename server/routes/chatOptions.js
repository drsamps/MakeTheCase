import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

// Default chat options - used when section_cases.chat_options is NULL
const DEFAULT_CHAT_OPTIONS = {
  // Hints configuration
  hints_allowed: 3,
  free_hints: 1,
  // Feedback options
  ask_for_feedback: false,
  ask_save_transcript: false,
  // Persona options
  allowed_personas: 'moderate,strict,liberal,leading,sycophantic',
  default_persona: 'moderate',
  // Display and flow options
  show_case: true,
  do_evaluation: true,
  // Chatbot personality customization
  chatbot_personality: '',
  // Multi-chat options
  chat_repeats: 0,           // 0 = one chat only, 1+ = can repeat N times
  save_dead_transcripts: false,  // Save transcripts for abandoned/canceled/killed chats
  // Position tracking override (position config is now per-scenario)
  disable_position_tracking: false  // Override to disable scenario-level position tracking
};

// Base schema describing available options (for UI generation)
// Note: persona options are loaded dynamically from database
const BASE_CHAT_OPTIONS_SCHEMA = [
  {
    key: 'hints_allowed',
    label: 'Hints Allowed',
    type: 'number',
    default: 3,
    min: 0,
    max: 10,
    description: 'Maximum hints student can request (0 = disabled)',
    category: 'hints'
  },
  {
    key: 'free_hints',
    label: 'Free Hints',
    type: 'number',
    default: 1,
    min: 0,
    max: 5,
    description: 'Hints without score penalty',
    category: 'hints'
  },
  {
    key: 'ask_for_feedback',
    label: 'Ask for Feedback',
    type: 'boolean',
    default: false,
    description: 'Ask student for feedback at end of chat',
    category: 'feedback'
  },
  {
    key: 'ask_save_transcript',
    label: 'Ask to Save Transcript',
    type: 'boolean',
    default: false,
    description: 'Ask permission to save anonymized transcript',
    category: 'feedback'
  },
  {
    key: 'show_case',
    label: 'Show Case Content',
    type: 'boolean',
    default: true,
    description: 'Display case contents in left panel during chat',
    category: 'display'
  },
  {
    key: 'do_evaluation',
    label: 'Run Evaluation',
    type: 'boolean',
    default: true,
    description: 'Run supervisor evaluation after chat completes',
    category: 'flow'
  },
  {
    key: 'chatbot_personality',
    label: 'Chatbot Personality',
    type: 'textarea',
    default: '',
    description: 'Additional AI instructions to customize chatbot behavior (appended to persona instructions)',
    category: 'personality'
  },
  {
    key: 'chat_repeats',
    label: 'Allowed Repeats',
    type: 'number',
    default: 0,
    min: 0,
    max: 10,
    description: 'Number of additional chats allowed (0 = one chat only, 1 = can repeat once, etc.)',
    category: 'flow'
  },
  {
    key: 'save_dead_transcripts',
    label: 'Save Dead Transcripts',
    type: 'boolean',
    default: false,
    description: 'Save transcripts for abandoned, canceled, or killed chats',
    category: 'flow'
  },
  // Position tracking override (position config is now per-scenario)
  {
    key: 'disable_position_tracking',
    label: 'Disable Position Tracking',
    type: 'boolean',
    default: false,
    description: 'Override to disable scenario-level position tracking for this assignment',
    category: 'position_tracking'
  }
];

// Helper to build full schema with dynamic persona options
async function buildSchemaWithPersonas() {
  let personaOptions = [
    { value: 'moderate', label: 'Moderate' },
    { value: 'strict', label: 'Strict' },
    { value: 'liberal', label: 'Liberal' },
    { value: 'leading', label: 'Leading' },
    { value: 'sycophantic', label: 'Sycophantic' }
  ];

  try {
    const [rows] = await pool.execute(
      'SELECT persona_id, persona_name FROM personas WHERE enabled = 1 ORDER BY sort_order ASC'
    );
    if (rows.length > 0) {
      personaOptions = rows.map(p => ({ value: p.persona_id, label: p.persona_name }));
    }
  } catch (error) {
    console.warn('Could not load personas from database, using defaults:', error.message);
  }

  const defaultAllowedPersonas = personaOptions.map(p => p.value).join(',');

  return [
    ...BASE_CHAT_OPTIONS_SCHEMA,
    {
      key: 'allowed_personas',
      label: 'Allowed Personas',
      type: 'multiselect',
      default: defaultAllowedPersonas,
      options: personaOptions,
      description: 'Personas available to students',
      category: 'personas'
    },
    {
      key: 'default_persona',
      label: 'Default Persona',
      type: 'select',
      default: personaOptions[0]?.value || 'moderate',
      options: personaOptions,
      description: 'Pre-selected persona for new chats',
      category: 'personas'
    }
  ];
}

// GET /api/chat-options/schema - Returns schema for UI generation (with dynamic personas)
router.get('/schema', async (req, res) => {
  try {
    const schema = await buildSchemaWithPersonas();
    res.json({ data: schema, error: null });
  } catch (error) {
    console.error('Error building chat options schema:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/chat-options/defaults - Returns default options
// Query params: ?section_id=X for section-specific, omit for global
router.get('/defaults', async (req, res) => {
  const { section_id } = req.query;

  try {
    // Try to get section-specific default first
    if (section_id) {
      const [rows] = await pool.execute(
        'SELECT chat_options FROM chat_options_defaults WHERE section_id = ?',
        [section_id]
      );
      if (rows.length > 0) {
        return res.json({ data: rows[0].chat_options, section_specific: true, error: null });
      }
    }

    // Fall back to global default
    const [globalRows] = await pool.execute(
      'SELECT chat_options FROM chat_options_defaults WHERE section_id IS NULL'
    );
    if (globalRows.length > 0) {
      return res.json({ data: globalRows[0].chat_options, section_specific: false, error: null });
    }

    // Final fallback to hardcoded defaults
    res.json({ data: DEFAULT_CHAT_OPTIONS, section_specific: false, error: null });
  } catch (error) {
    console.error('Error fetching defaults:', error);
    res.json({ data: DEFAULT_CHAT_OPTIONS, section_specific: false, error: null });
  }
});

// POST /api/chat-options/defaults - Create or update defaults
// Body: { section_id: string|null, chat_options: object }
router.post('/defaults', async (req, res) => {
  const { section_id, chat_options } = req.body;

  if (!chat_options) {
    return res.status(400).json({ data: null, error: { message: 'chat_options is required' } });
  }

  try {
    const chatOptionsJson = JSON.stringify(chat_options);

    // Use REPLACE to insert or update (handles unique constraint on section_id)
    await pool.execute(
      `INSERT INTO chat_options_defaults (section_id, chat_options)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE chat_options = ?, updated_at = CURRENT_TIMESTAMP`,
      [section_id || null, chatOptionsJson, chatOptionsJson]
    );

    res.json({
      data: { section_id: section_id || null, chat_options },
      message: section_id ? `Defaults saved for section ${section_id}` : 'Global defaults saved',
      error: null
    });
  } catch (error) {
    console.error('Error saving defaults:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/chat-options/bulk-copy - Copy chat options to multiple section-cases
// Body: { source_section_id, source_case_id, target: 'section'|'all', target_section_id? }
router.post('/bulk-copy', async (req, res) => {
  const { source_section_id, source_case_id, target, target_section_id } = req.body;

  if (!source_section_id || !source_case_id || !target) {
    return res.status(400).json({
      data: null,
      error: { message: 'source_section_id, source_case_id, and target are required' }
    });
  }

  if (target !== 'section' && target !== 'all') {
    return res.status(400).json({
      data: null,
      error: { message: 'target must be "section" or "all"' }
    });
  }

  if (target === 'section' && !target_section_id) {
    return res.status(400).json({
      data: null,
      error: { message: 'target_section_id is required when target is "section"' }
    });
  }

  try {
    // Get source chat options
    const [sourceRows] = await pool.execute(
      'SELECT chat_options FROM section_cases WHERE section_id = ? AND case_id = ?',
      [source_section_id, source_case_id]
    );

    if (sourceRows.length === 0) {
      return res.status(404).json({
        data: null,
        error: { message: 'Source section-case not found' }
      });
    }

    const sourceOptions = sourceRows[0].chat_options || DEFAULT_CHAT_OPTIONS;
    const chatOptionsJson = JSON.stringify(sourceOptions);

    let result;
    if (target === 'section') {
      // Copy to all cases in target section
      [result] = await pool.execute(
        `UPDATE section_cases
         SET chat_options = ?, updated_at = CURRENT_TIMESTAMP
         WHERE section_id = ? AND NOT (section_id = ? AND case_id = ?)`,
        [chatOptionsJson, target_section_id, source_section_id, source_case_id]
      );
    } else {
      // Copy to all cases in all sections
      [result] = await pool.execute(
        `UPDATE section_cases
         SET chat_options = ?, updated_at = CURRENT_TIMESTAMP
         WHERE NOT (section_id = ? AND case_id = ?)`,
        [chatOptionsJson, source_section_id, source_case_id]
      );
    }

    res.json({
      data: { updated: result.affectedRows },
      message: `Chat options copied to ${result.affectedRows} section-case assignment(s)`,
      error: null
    });
  } catch (error) {
    console.error('Error bulk copying chat options:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
