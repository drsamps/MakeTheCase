import express from 'express';

const router = express.Router();

// Default chat options - used when section_cases.chat_options is NULL
const DEFAULT_CHAT_OPTIONS = {
  hints_allowed: 3,
  free_hints: 1,
  ask_for_feedback: false,
  ask_save_transcript: false,
  allowed_personas: 'moderate,strict,liberal,leading,sycophantic',
  default_persona: 'moderate'
};

// Schema describing available options (for UI generation)
const CHAT_OPTIONS_SCHEMA = [
  {
    key: 'hints_allowed',
    label: 'Hints Allowed',
    type: 'number',
    default: 3,
    min: 0,
    max: 10,
    description: 'Maximum hints student can request (0 = disabled)'
  },
  {
    key: 'free_hints',
    label: 'Free Hints',
    type: 'number',
    default: 1,
    min: 0,
    max: 5,
    description: 'Hints without score penalty'
  },
  {
    key: 'ask_for_feedback',
    label: 'Ask for Feedback',
    type: 'boolean',
    default: false,
    description: 'Ask student for feedback at end of chat'
  },
  {
    key: 'ask_save_transcript',
    label: 'Ask to Save Transcript',
    type: 'boolean',
    default: false,
    description: 'Ask permission to save anonymized transcript'
  },
  {
    key: 'allowed_personas',
    label: 'Allowed Personas',
    type: 'multiselect',
    default: 'moderate,strict,liberal,leading,sycophantic',
    options: [
      { value: 'moderate', label: 'Moderate' },
      { value: 'strict', label: 'Strict' },
      { value: 'liberal', label: 'Liberal' },
      { value: 'leading', label: 'Leading' },
      { value: 'sycophantic', label: 'Sycophantic' }
    ],
    description: 'Personas available to students'
  },
  {
    key: 'default_persona',
    label: 'Default Persona',
    type: 'select',
    default: 'moderate',
    options: [
      { value: 'moderate', label: 'Moderate' },
      { value: 'strict', label: 'Strict' },
      { value: 'liberal', label: 'Liberal' },
      { value: 'leading', label: 'Leading' },
      { value: 'sycophantic', label: 'Sycophantic' }
    ],
    description: 'Pre-selected persona for new chats'
  }
];

// GET /api/chat-options/schema - Returns schema for UI generation
router.get('/schema', (req, res) => {
  res.json({ data: CHAT_OPTIONS_SCHEMA, error: null });
});

// GET /api/chat-options/defaults - Returns default options
router.get('/defaults', (req, res) => {
  res.json({ data: DEFAULT_CHAT_OPTIONS, error: null });
});

export default router;
