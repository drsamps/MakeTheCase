export enum MessageRole {
  USER = 'user',
  MODEL = 'model',
}

export interface Message {
  role: MessageRole;
  content: string;
}

export enum ConversationPhase {
  PRE_CHAT,
  CHATTING,
  AWAITING_HELPFUL_PERMISSION,
  AWAITING_HELPFUL_SCORE,
  AWAITING_LIKED_FEEDBACK,
  AWAITING_IMPROVE_FEEDBACK,
  AWAITING_TRANSCRIPT_PERMISSION,
  FEEDBACK_COMPLETE,
  EVALUATION_LOADING,
  EVALUATING,
}

export enum CEOPersona {
  STRICT = 'strict',
  MODERATE = 'moderate',
  LIBERAL = 'liberal',
  LEADING = 'leading',
  SYCOPHANTIC = 'sycophantic',
}

export interface Persona {
  persona_id: string;
  persona_name: string;
  description?: string;
  instructions: string;
  enabled: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface ChatOptions {
  hints_allowed: number;
  free_hints: number;
  ask_for_feedback: boolean;
  ask_save_transcript: boolean;
  allowed_personas: string;
  default_persona: string;
  show_case: boolean;
  do_evaluation: boolean;
  chatbot_personality: string;
}

export interface EvaluationCriterion {
  question: string;
  score: number;
  feedback: string;
}

export interface EvaluationResult {
  criteria: EvaluationCriterion[];
  totalScore: number;
  summary: string;
  hints: number;
}

export interface Section {
    section_id: string;
    section_title: string;
    year_term: string;
    chat_model: string | null;
    super_model: string | null;
}