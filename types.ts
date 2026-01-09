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

export enum ChatStatus {
  STARTED = 'started',
  IN_PROGRESS = 'in_progress',
  ABANDONED = 'abandoned',
  CANCELED = 'canceled',
  KILLED = 'killed',
  COMPLETED = 'completed',
}

export type PositionCaptureMethod = 'explicit' | 'ai_inferred' | 'instructor_manual' | 'none';

// Position tracking settings stored in scenario's chat_options_override
export interface ScenarioPositionSettings {
  position_tracking_enabled?: boolean;
  position_capture_method?: PositionCaptureMethod;
  position_options?: string[];     // Position choices (default: ['for', 'against'])
  position_labels?: Record<string, string>; // Custom display labels for positions
  track_position_change?: boolean; // Ask for final position after chat
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

export interface CaseChat {
  id: string;
  student_id: string;
  case_id: string;
  section_id: string | null;
  scenario_id: number | null;
  status: ChatStatus;
  persona: string | null;
  hints_used: number;
  chat_model: string | null;
  start_time: string;
  last_activity: string;
  end_time: string | null;
  transcript: string | null;
  evaluation_id: string | null;
  time_limit_minutes: number | null;
  time_started: string | null;
  // Position tracking fields
  initial_position: string | null;
  final_position: string | null;
  position_method: PositionCaptureMethod | null;
  // Joined fields
  student_name?: string;
  case_title?: string;
  section_title?: string;
  scenario_name?: string;
}

export interface CaseScenario {
  id: number;
  case_id: string;
  scenario_name: string;
  protagonist: string;
  protagonist_initials: string;
  protagonist_role: string | null;
  chat_topic: string | null;
  chat_question: string;
  chat_time_limit: number;
  chat_time_warning: number;
  arguments_for: string | null;
  arguments_against: string | null;
  chat_options_override: (Partial<ChatOptions> & ScenarioPositionSettings) | null;
  sort_order: number;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface SectionCaseScenario {
  id: number;
  section_case_id: number;
  scenario_id: number;
  enabled: boolean;
  sort_order: number;
  created_at?: string;
  // Joined from case_scenarios
  scenario?: CaseScenario;
}

export type ScenarioSelectionMode = 'student_choice' | 'all_required';

export interface SectionCase {
  id: number;
  section_id: string;
  case_id: string;
  active: boolean;
  chat_options: ChatOptions | null;
  open_date: string | null;
  close_date: string | null;
  manual_status: 'auto' | 'manually_opened' | 'manually_closed';
  selection_mode: ScenarioSelectionMode;
  require_order: boolean;
  use_scenarios: boolean;
  created_at?: string;
  // Joined fields
  case_title?: string;
  scenarios?: SectionCaseScenario[];
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
  chat_repeats: number;
  save_dead_transcripts: boolean;
  allow_repeat: boolean;         // Allow students to repeat the chat more than once
  timeout_chat: boolean;          // Stop the chat at the designated duration
  restart_chat: boolean;          // Allow students to exit chat and restart it
  allow_exit: boolean;            // Provide students an exit button to exit the chat
  // Position tracking override (position config is now per-scenario in chat_options_override)
  disable_position_tracking: boolean; // Override to disable scenario-level position tracking
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
    accept_new_students?: boolean;
}

export interface AdminUser {
  id: string;
  email: string;
  role: 'admin';
  superuser: boolean;
  adminAccess: string[];
}

export interface PositionLog {
  id: number;
  case_chat_id: string;
  position_type: 'initial' | 'final';
  position_value: string;
  recorded_by: 'student' | 'ai' | 'instructor';
  recorded_at: string;
  notes: string | null;
}

export interface PositionDistribution {
  position: string;
  count: number;
  percentage: number;
  students?: Array<{ id: string; name: string; changed: boolean }>;
}