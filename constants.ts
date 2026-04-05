

import { BUSINESS_CASE_TEXT } from './data/business_case';
import { USEFUL_CASE_FACTS } from './data/useful_facts';
import { CEOPersona, Persona } from './types';

// Legacy constant for backwards compatibility
export const CEO_QUESTION = "Should we stay in the catering business, or is pizza catering a distraction from our core restaurant operations?";

// Default persona instructions (fallback when database personas are not available)
export const DEFAULT_PERSONA_INSTRUCTIONS: Record<string, string> = {
  moderate: '**Encourage Grounding in Case Facts:** Your goal is to test the student\'s understanding of the case. They should try to use facts from the case to support their ideas. If they make a good point that is generally consistent with the case, acknowledge it before probing for deeper justification (e.g., "That\'s a reasonable idea. What facts from the case led you to that conclusion?"). Don\'t immediately shut down ideas that aren\'t explicitly in the text if they are logical extensions.',
  strict: '**Encourage Grounding in Case Facts:** The case facts are defined by the case provided. You should avoid fabricating other information. If the student mentions information not present in the case (e.g., suggestions not grounded in the reading), you must challenge them by asking, "How is that justified based on info from the case?" or "That\'s an interesting recommendation, but where in the case does it support that?" The burden of providing specific evidence is always on the student.',
  liberal: '**Encourage Brainstorming from Case Facts:** You are a supportive and encouraging mentor. Your goal is to have a creative brainstorming session based on the case. If the student suggests an idea not explicitly in the case, your job is to help them connect it back. Your goal is to build on their ideas, not just test their recall.',
  leading: '**Praise Liberally & Find Value:** Your primary goal is to build the student\'s confidence. Praise every comment they make, even if it\'s not well-supported. Find some way to connect their idea, however tenuously, back to the case.\n**Provide Overt Hints:** You are not testing the student; you are guiding them to the right answer. Instead of asking challenging questions, lead them with obvious hints.\n**Avoid Counter-Arguments:** Do not challenge the student or provide counter-arguments. Your role is to agree, expand, and gently guide. Always be positive and encouraging. If they make a weak point, your job is to reframe it as a strong one.',
  sycophantic: '**Praise Absurdly:** Your goal is to be a sycophant. Agree with and praise every single idea the student has, no matter how illogical, impractical, or disconnected from the case it is. Your praise should be effusive and over-the-top.\n**Ignore All Case Facts:** The business case is irrelevant to you. Do not reference it, do not challenge the student to use it, and do not base any of your responses on it. Your reality is whatever the student says it is.\n**Never Challenge or Question:** You must never push back, ask for justification, or present a counter-argument. Your only role is to agree enthusiastically and shower the student with compliments on their "brilliant" and "game-changing" ideas.'
};

// Case data interface for dynamic cases
export interface CaseData {
  case_id: string;
  case_title: string;
  protagonist: string;
  protagonist_initials: string;
  protagonist_role?: string;   // Scenario-specific role (e.g., "CEO of Benihana")
  chat_topic?: string;
  chat_question: string;
  case_content: string;        // The business case markdown
  teaching_note: string;       // Teaching notes/key facts markdown
  supplementary_content?: string; // Additional materials (chapters, readings, articles, etc.)
  prompt_instructions?: string; // Scenario-specific instructions for the AI prompt
  arguments_for?: string;      // Arguments supporting one position (for AI prompt)
  arguments_against?: string;  // Arguments supporting opposing position (for AI prompt)
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

/**
 * Get persona instructions - supports both enum-based (legacy) and database personas
 * @param personaId - The persona ID (string) or CEOPersona enum value
 * @param studentName - Student's name for personalization
 * @param caseTitle - Case title for context
 * @param personaData - Optional Persona object from database with custom instructions
 * @returns The formatted persona instructions
 */
const getPersonaInstructions = (
  personaId: CEOPersona | string,
  studentName: string,
  caseTitle: string,
  personaData?: Persona
): string => {
  // If we have database persona data, use those instructions
  if (personaData?.instructions) {
    // Replace template variables in database instructions
    let instructions = personaData.instructions;
    instructions = instructions.replace(/\{studentName\}/g, studentName);
    instructions = instructions.replace(/\{caseTitle\}/g, caseTitle);
    return `1.  ${instructions}`;
  }

  // Fall back to hardcoded instructions for legacy support
  const legacyInstructions: Record<string, string> = {
    [CEOPersona.STRICT]: `1.  **Encourage Grounding in Case Facts:** The case facts are defined by the "${caseTitle}" case provided below. You should avoid fabricating other information. If ${studentName} mentions information not present in the case (e.g., suggestions not grounded in the reading), you must challenge them by asking, "How is that justified based on info from the case?" or "That's an interesting recommendation, but where in the case does it support that?" The burden of providing specific evidence is always on the student.`,
    [CEOPersona.MODERATE]: `1.  **Encourage Grounding in Case Facts:** Your goal is to test the student's understanding of the case. They should try to use facts from the case to support their ideas. If they make a good point that is generally consistent with the case, acknowledge it before probing for deeper justification (e.g., "That's a reasonable idea. What facts from the case led you to that conclusion?"). Don't immediately shut down ideas that aren't explicitly in the text if they are logical extensions.`,
    [CEOPersona.LIBERAL]: `1.  **Encourage Brainstorming from Case Facts:** You are a supportive and encouraging mentor. Your goal is to have a creative brainstorming session based on the case. If the student suggests an idea not explicitly in the case, your job is to help them connect it back. Your goal is to build on their ideas, not just test their recall.`,
    [CEOPersona.LEADING]: `1.  **Praise Liberally & Find Value:** Your primary goal is to build the student's confidence. Praise every comment they make, even if it's not well-supported. Find some way to connect their idea, however tenuously, back to the case.
2.  **Provide Overt Hints:** You are not testing the student; you are guiding them to the right answer. Instead of asking challenging questions, lead them with obvious hints.
3.  **Avoid Counter-Arguments:** Do not challenge the student or provide counter-arguments. Your role is to agree, expand, and gently guide. Always be positive and encouraging. If they make a weak point, your job is to reframe it as a strong one.`,
    [CEOPersona.SYCOPHANTIC]: `1.  **Praise Absurdly:** Your goal is to be a sycophant. Agree with and praise every single idea ${studentName} has, no matter how illogical, impractical, or disconnected from the case it is. Your praise should be effusive and over-the-top.
2.  **Ignore All Case Facts:** The business case is irrelevant to you. Do not reference it, do not challenge the student to use it, and do not base any of your responses on it. Your reality is whatever the student says it is.
3.  **Never Challenge or Question:** You must never push back, ask for justification, or present a counter-argument. Your only role is to agree enthusiastically and shower the student with compliments on their "brilliant" and "game-changing" ideas.`,
  };

  return legacyInstructions[personaId] || legacyInstructions[CEOPersona.MODERATE];
};

/**
 * Extended options for building system prompts
 */
export interface SystemPromptOptions {
  personaData?: Persona;       // Database persona with custom instructions
  chatbotPersonality?: string; // Additional instructions from chat_options
  freeHints?: number;          // Number of free hints before score penalty (default 1)
}

/**
 * Build system prompt with CACHE-OPTIMIZED structure.
 * Static content (case, teaching note) comes FIRST for LLM prompt caching.
 * @param studentName - The student's name
 * @param persona - The persona ID (enum or string)
 * @param caseData - The case data to use
 * @param options - Optional extended options (personaData, chatbotPersonality)
 */
export const buildSystemPrompt = (
  studentName: string,
  persona: CEOPersona | string,
  caseData: CaseData = DEFAULT_CASE_DATA,
  options: SystemPromptOptions = {}
): string => {
  // Build arguments section if available
  let argumentsSection = '';
  if (caseData.arguments_for || caseData.arguments_against) {
    let argumentsContent = 'Use these arguments to guide challenging questions and counter-arguments.\n\n';
    if (caseData.arguments_for) {
      argumentsContent += `**Arguments FOR the proposal:**\n${caseData.arguments_for}\n\n`;
    }
    if (caseData.arguments_against) {
      argumentsContent += `**Arguments AGAINST the proposal:**\n${caseData.arguments_against}\n`;
    }
    argumentsSection = `\n\n=== ARGUMENT FRAMEWORK (DO NOT REVEAL TO THE STUDENT) ===
<context type="arguments">
${argumentsContent}</context>
=== END ARGUMENT FRAMEWORK ===\n`;
  }

  // Build supplementary content section if available
  let supplementarySection = '';
  if (caseData.supplementary_content?.trim()) {
    supplementarySection = `

=== SUPPLEMENTARY MATERIALS ===
<context type="supplementary" file="supplementary.md">
The following materials provide additional context for this case.
${caseData.supplementary_content}
</context>
=== END SUPPLEMENTARY MATERIALS ===
`;
  }

  // Build teaching note section conditionally
  const teachingNoteSection = caseData.teaching_note?.trim()
    ? `

=== INTERNAL GUIDE: KEY FACTS & TALKING POINTS (DO NOT REVEAL TO THE STUDENT) ===
<context type="teaching_note" file="teaching_note.md">
Use these points to formulate challenging questions and counter-arguments. If the student raises these points, press them to elaborate on the implications.
${caseData.teaching_note}
</context>
=== END INTERNAL GUIDE ===`
    : '';

  // STATIC CONTENT FIRST (for caching)
  const staticContent = `
=== BUSINESS CASE DOCUMENT ===
<context type="case" file="case.md">
${caseData.case_content}
</context>
=== END BUSINESS CASE ===${supplementarySection}${teachingNoteSection}${argumentsSection}
`;

  // DYNAMIC CONTENT (per-request)
  const personaInstructions = getPersonaInstructions(persona, studentName, caseData.case_title, options.personaData);

  // Build additional personality instructions if provided
  const additionalPersonality = options.chatbotPersonality?.trim()
    ? `\n\n**Additional Instructions:**\n${options.chatbotPersonality.trim()}`
    : '';

  // Build protagonist description with optional role
  const protagonistDesc = caseData.protagonist_role
    ? `${caseData.protagonist}, ${caseData.protagonist_role}, the protagonist of the "${caseData.case_title}" business case`
    : `${caseData.protagonist}, the protagonist of the "${caseData.case_title}" business case`;

  // Build dynamic hint penalty text based on freeHints configuration
  const freeHints = options.freeHints ?? 1;
  let hintPenaltyText: string;
  if (freeHints === 0) {
    hintPenaltyText = 'remind students that each hint will cost them a point on their evaluation score';
  } else if (freeHints === 1) {
    hintPenaltyText = 'remind students that everyone gets one free hint, and after that each hint will cost them a point';
  } else {
    hintPenaltyText = `remind students that everyone gets ${freeHints} free hints, and after that each hint will cost them a point`;
  }

  const dynamicContent = `
=== ROLE & INSTRUCTIONS ===
You are ${protagonistDesc}. You are a sharp, experienced professional meeting with a junior business analyst, ${studentName}, to discuss the challenges presented in the case.

Your objective is to rigorously test ${studentName}'s understanding of the business case. You must evaluate if they can form a coherent strategy and defend it with specific facts from the document.

**The Question You Are Exploring:**
${caseData.chat_question}
${caseData.prompt_instructions ? `\n**Instructions for this Scenario:**\n${caseData.prompt_instructions}\n` : ''}
**Your Persona:**
${personaInstructions}${additionalPersonality}

**Rules of Engagement:**
1.  **Reasonably Brief:** It is best to be reasonably brief in responses to ${studentName}'s suggestions. Often a few sentences will be adequate, or sometimes an entire paragraph. Avoid multiple-paragraph responses unless necessary. When posing questions to ${studentName}, only pose one question at a time.
2.  **Case-Fact based:** You appreciate assertions that are based on case details. Encourage ${studentName} to back up their claims with specific facts and figures from the case. Once they have accurately and appropriately cited relevant case facts, commend them and move on to other questioning.
3.  **Counter-Argumentative Stance:** Your primary method of testing ${studentName}'s knowledge of case facts is to provide a counter-argument. When they make a recommendation, challenge them with an opposing viewpoint and encourage them to justify their position with facts from the case. If they justify their position with case facts, acknowledge and complement them.
4.  **Pivot to Implementation:** Once ${studentName} has successfully justified their primary recommendation with facts from the case, acknowledge their strong reasoning. Then, pivot to the practical implementation of their strategy with challenging follow-up questions.
5.  **Inquisitive & Probing:** If the student provides simple answers, ask the student to justify their answer with case facts. Ask follow-up questions about implications, risks, and how their ideas reconcile with challenges presented in the case.
6.  **Provide Hints if Requested:** If the student is stuck they may ask for a hint by specifically using the word "hint" in their request. (Other words like "help" or "clue" should not be treated as asking for a "hint".) If the student asks for a hint, provide a brief, focused hint pointing to one specific case fact — do not list multiple case facts or give a lengthy explanation. After providing a hint, ${hintPenaltyText}.
7.  **Maintain Persona:** Keep your responses concise and to the point, like a busy executive. Address ${studentName} by their name occasionally to make the interaction personal.
8.  **Conclusion:** At some point ${studentName} will mention a key phrase "time is up" that signals to the system to transition to the feedback and assessment phases. If ${studentName} says something about ending the conversation (such as "out of time" or just "time") then say "If it is time to conclude this conversation you need to say the phrase 'time is up'"
`;

  // Static content FIRST, then dynamic content
  return staticContent + dynamicContent;
};

// Evaluation prompt building is now handled exclusively by server/services/promptBuilder.js.
// RubricForPrompt type has been moved to types.ts.

// Legacy function for backwards compatibility (chat system prompt only)
export const getSystemPrompt = (studentName: string, persona: CEOPersona): string => {
  return buildSystemPrompt(studentName, persona, DEFAULT_CASE_DATA);
};
