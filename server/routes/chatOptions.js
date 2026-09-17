import express from 'express';
import { pool } from '../db.js';
import { verifyToken } from '../middleware/auth.js';
import {
  canManageSectionCases,
  canViewSection,
  requireAdminOrInstructor,
} from '../middleware/instructorAccess.js';

const router = express.Router();

// Global defaults and "all sections" copies stay admin-only; section-scoped writes follow the
// section-case rule (admin, primary instructor, or TA with can_manage_cases).
const isAdminUser = (req) => Boolean(req.user?.superuser || req.user?.role === 'admin');
const forbid = (res, message) => res.status(403).json({ data: null, error: { message } });

// Default chat options - used when section_cases.chat_options is NULL
const DEFAULT_CHAT_OPTIONS = {
  // Hints configuration
  hints_allowed: 3,
  free_hints: 1,
  // Feedback options
  ask_for_feedback: false,
  ask_save_transcript: false,
  auto_save_transcript: true,    // Auto-save transcript after each chat exchange
  // Persona options
  allowed_personas: 'moderate,strict,liberal,leading,sycophantic',
  default_persona: 'moderate',
  // Display and flow options
  show_case: true,
  show_timer: true,              // Show countdown timer during chat
  do_evaluation: true,
  show_evaluation_details: true, // Show full evaluation criteria vs just score
  // Chatbot personality customization
  chatbot_personality: '',
  // Multi-chat options
  chat_repeats: 0,           // 0 = one chat only, 1+ = can repeat N times
  save_dead_transcripts: false,  // Save transcripts for abandoned/canceled/killed chats
  // Chat control options
  allow_repeat: false,
  timeout_chat: false,
  allow_finish_button: false,
  restart_chat: false,
  allow_exit: false,
  require_minimum_exchanges: 0,  // 0 = no minimum, N = require N exchanges before "time is up"
  max_message_length: 0,         // 0 = unlimited, N = max N characters per message
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
    label: 'Ask to Share Transcript with Developers',
    type: 'boolean',
    default: false,
    description: 'Ask the student for permission to share the transcript with the developers (recorded in transcripts.saved_with_permission). Transcripts are saved for instructor review either way.',
    category: 'feedback'
  },
  {
    key: 'auto_save_transcript',
    label: 'Auto-Save Transcript',
    type: 'boolean',
    default: true,
    description: 'Automatically save transcript after each chat exchange (ensures transcripts are available even for incomplete chats)',
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
    key: 'show_timer',
    label: 'Show Timer',
    type: 'boolean',
    default: true,
    description: 'Display countdown timer during chat',
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
    key: 'show_evaluation_details',
    label: 'Show Evaluation Details',
    type: 'boolean',
    default: true,
    description: 'Show full evaluation criteria and feedback (vs just overall score)',
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
  // Chat control options
  {
    key: 'allow_repeat',
    label: 'Allow Repeat',
    type: 'boolean',
    default: false,
    description: 'Allow students to repeat the chat multiple times',
    category: 'chat_control'
  },
  {
    key: 'timeout_chat',
    label: 'Auto-End on Timeout',
    type: 'boolean',
    default: false,
    description: 'Automatically end chat when time limit expires',
    category: 'chat_control'
  },
  {
    key: 'allow_finish_button',
    label: 'Allow Finish Button',
    type: 'boolean',
    default: false,
    description: 'Provide students a "Finish Chat" button to conclude the chat when done',
    category: 'chat_control'
  },
  {
    key: 'restart_chat',
    label: 'Allow Restart',
    type: 'boolean',
    default: false,
    description: 'Provide students a "Restart Chat" button to restart the current case chat',
    category: 'chat_control'
  },
  {
    key: 'allow_exit',
    label: 'Allow Exit',
    type: 'boolean',
    default: false,
    description: 'Provide students a "Cancel Chat" button to cancel and perhaps start over',
    category: 'chat_control'
  },
  {
    key: 'require_minimum_exchanges',
    label: 'Minimum Exchanges',
    type: 'number',
    default: 0,
    min: 0,
    max: 20,
    description: 'Require N exchanges before allowing "time is up" (0 = no minimum)',
    category: 'chat_control'
  },
  {
    key: 'max_message_length',
    label: 'Max Message Length',
    type: 'number',
    default: 0,
    min: 0,
    max: 10000,
    description: 'Maximum characters per student message (0 = unlimited)',
    category: 'chat_control'
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
router.post('/defaults', verifyToken, requireAdminOrInstructor, async (req, res) => {
  const { section_id, chat_options } = req.body;

  if (!chat_options) {
    return res.status(400).json({ data: null, error: { message: 'chat_options is required' } });
  }

  try {
    if (!section_id && !isAdminUser(req)) {
      return forbid(res, 'Only admins can change the global chat options default');
    }
    if (section_id && !(await canManageSectionCases(req, section_id))) {
      return forbid(res, 'You do not have permission to manage cases on this section');
    }

    const chatOptionsJson = JSON.stringify(chat_options);

    // First, try to update existing record (LIMIT 1 to prevent multiple updates)
    const updateQuery = section_id
      ? 'UPDATE chat_options_defaults SET chat_options = ?, updated_at = CURRENT_TIMESTAMP WHERE section_id = ? LIMIT 1'
      : 'UPDATE chat_options_defaults SET chat_options = ?, updated_at = CURRENT_TIMESTAMP WHERE section_id IS NULL LIMIT 1';
    
    const updateParams = section_id ? [chatOptionsJson, section_id] : [chatOptionsJson];
    const [updateResult] = await pool.execute(updateQuery, updateParams);

    // If no rows were updated, insert new record
    if (updateResult.affectedRows === 0) {
      await pool.execute(
        'INSERT INTO chat_options_defaults (section_id, chat_options) VALUES (?, ?)',
        [section_id || null, chatOptionsJson]
      );
    }

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

// DELETE /api/chat-options/defaults - Delete section-specific defaults
// Query params: ?section_id=X (required - cannot delete global default)
router.delete('/defaults', verifyToken, requireAdminOrInstructor, async (req, res) => {
  const { section_id } = req.query;

  if (!section_id) {
    return res.status(400).json({
      data: null,
      error: { message: 'section_id is required. Cannot delete global default.' }
    });
  }

  try {
    if (!(await canManageSectionCases(req, section_id))) {
      return forbid(res, 'You do not have permission to manage cases on this section');
    }

    const [result] = await pool.execute(
      'DELETE FROM chat_options_defaults WHERE section_id = ?',
      [section_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        data: null,
        error: { message: 'Section-specific default not found' }
      });
    }

    res.json({
      data: { deleted: true },
      message: `Section default deleted. Section will now use global defaults.`,
      error: null
    });
  } catch (error) {
    console.error('Error deleting section default:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/chat-options/bulk-copy - Copy chat options to multiple section-cases
// Body: { source_section_id, source_case_id, target: 'section'|'all', target_section_id? }
// Rows that follow a course case version are skipped: their chat_options are written through
// from the version (services/caseVersionSync.js) and a copy here would be overwritten.
router.post('/bulk-copy', verifyToken, requireAdminOrInstructor, async (req, res) => {
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
    if (!isAdminUser(req)) {
      if (target === 'all') {
        return forbid(res, 'Only admins can copy chat options to every section');
      }
      if (!(await canViewSection(req, source_section_id))) {
        return forbid(res, 'Access denied to the source section');
      }
      if (!(await canManageSectionCases(req, target_section_id))) {
        return forbid(res, 'You do not have permission to manage cases on the target section');
      }
    }

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

    const scopeSql = target === 'section' ? 'section_id = ? AND ' : '';
    const scopeParams = target === 'section' ? [target_section_id] : [];
    const notSourceSql = 'NOT (section_id = ? AND case_id = ?)';

    // section_cases has no updated_at column; the previous version referenced one and failed.
    const [result] = await pool.execute(
      `UPDATE section_cases
       SET chat_options = ?
       WHERE ${scopeSql}${notSourceSql} AND version_id IS NULL`,
      [chatOptionsJson, ...scopeParams, source_section_id, source_case_id]
    );
    const [[{ skipped }]] = await pool.execute(
      `SELECT COUNT(*) AS skipped FROM section_cases
       WHERE ${scopeSql}${notSourceSql} AND version_id IS NOT NULL`,
      [...scopeParams, source_section_id, source_case_id]
    );

    const skippedNote = skipped > 0
      ? `; skipped ${skipped} that follow course settings (edit those on the Courses screen)`
      : '';
    res.json({
      data: { updated: result.affectedRows, skipped_following_version: skipped },
      message: `Chat options copied to ${result.affectedRows} section-case assignment(s)${skippedNote}`,
      error: null
    });
  } catch (error) {
    console.error('Error bulk copying chat options:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
