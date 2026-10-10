

import { BUSINESS_CASE_TEXT } from './data/business_case';
import { USEFUL_CASE_FACTS } from './data/useful_facts';

// Legacy constant for backwards compatibility
export const CEO_QUESTION = "Should we stay in the catering business, or is pizza catering a distraction from our core restaurant operations?";

// Case data the student screen shows (GET /api/llm/case-data plus the scenario's protagonist and
// question). The chat prompt is built on the server (server/services/chatPrompt.js), so students
// never receive the teaching note, scenario instructions or arguments.
export interface CaseData {
  case_id: string;
  case_title: string;
  protagonist: string;
  protagonist_initials: string;
  protagonist_role?: string;   // Scenario-specific role (e.g., "CEO of Benihana")
  chat_topic?: string;
  chat_question: string;
  case_content: string;        // The business case markdown
  teaching_note?: string;      // Staff only: never sent to students
  supplementary_content?: string; // Additional materials (chapters, readings, articles, etc.)
}

// Default case data for backwards compatibility (Malawi's Pizza)
export const DEFAULT_CASE_DATA: CaseData = {
  case_id: 'malawis-pizza',
  case_title: "Malawi's Pizza Catering",
  protagonist: 'Kent Beck',
  protagonist_initials: 'KB',
  chat_topic: 'Catering business strategy',
  chat_question: CEO_QUESTION,
  case_content: BUSINESS_CASE_TEXT,
  teaching_note: USEFUL_CASE_FACTS,
};

// The student chat prompt is built by server/services/chatPromptTemplates.js; evaluation
// prompts by server/services/promptBuilder.js. RubricForPrompt type has been moved to types.ts.
