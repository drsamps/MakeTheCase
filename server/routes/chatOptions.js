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
  save_dead_transcripts: false  // Save transcripts for abandoned/canceled/killed chats
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
router.get('/defaults', (req, res) => {
  res.json({ data: DEFAULT_CHAT_OPTIONS, error: null });
});

export default router;
