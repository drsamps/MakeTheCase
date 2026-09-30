import { CaseData, SystemPromptOptions } from './constants';
import { Persona } from './types';

/**
 * Teach-Back chat system prompt.
 *
 * The student teaches; the AI is the one who does not understand yet. Ported from
 * `../quizzer/explain/prompts.py#build_novice_system_prompt`, with two MakeTheCase
 * departures that are deliberate:
 *
 * 1. PRACTICE STAKES. MTC's reading panel and the AI's prompt are the same string
 *    (`activeCaseData.case_content` feeds both), so the audience has read the material.
 *    Quizzer's novice is starved of it. We therefore cannot promise the audience will
 *    never fill a gap, only ask it not to — which is why Teach-Back is documented as a
 *    practice activity, not a graded one. The teaching note and the argument framework
 *    are still left out: they exist to fuel counter-arguments and are the nearest thing
 *    MTC has to an answer key.
 *
 * 2. A LEARNING ACTIVITY, NOT A DRILL. The audience reflects the student's own words
 *    back before asking, says plainly when something lands, and thanks them. This lives
 *    in the template so EVERY audience does it; personas differ only in what it takes to
 *    satisfy them. Understanding is paced in the template too (rules 2 and 8): without
 *    that, every audience announced "that made it click" after the first explanation and
 *    the activity ended before it began. Personas adjust how hard the listener is to satisfy
 *    on top of that pacing. It is safe to be warm because `buildCoachPrompt` never sees the
 *    persona — the listener and the judge are separate calls, so an encouraging audience
 *    cannot buy a better grade.
 *
 * Static content stays FIRST for provider-side prompt caching, exactly as
 * `constants.ts#buildSystemPrompt` does.
 *
 * The "time is up" contract in the Conclusion rule is load-bearing: `App.tsx` detects
 * that phrase to end the chat. Do not reword it.
 */
export const buildTeachBackSystemPrompt = (
  studentName: string,
  persona: string,
  caseData: CaseData,
  options: SystemPromptOptions = {}
): string => {
  // Supplementary materials travel with the reading; the teaching note and the argument
  // framework deliberately do not.
  const supplementarySection = caseData.supplementary_content?.trim()
    ? `

=== SUPPLEMENTARY MATERIALS ===
<context type="supplementary" file="supplementary.md">
The following materials provide additional context for this topic.
${caseData.supplementary_content}
</context>
=== END SUPPLEMENTARY MATERIALS ===
`
    : '';

  // STATIC CONTENT FIRST (for caching)
  const staticContent = `
=== SOURCE DOCUMENT ===
<context type="case" file="case.md">
${caseData.case_content}
</context>
=== END SOURCE DOCUMENT ===${supplementarySection}
`;

  // The persona's display name, as the student saw it in the picker ("Your grandmother").
  // It is quoted as a label below rather than spliced into a sentence, because it is written
  // from the student's side and does not read as "You are <name>". Who the listener is and
  // how they behave comes from the persona's instructions ("Who You Are"), never from the
  // case protagonist's role or the persona's dashboard description.
  const audienceName = caseData.protagonist || 'a curious beginner';

  // Who this particular audience is. Persona text supplies background and manner — never
  // what the listener knows, and never how strictly the work is judged.
  const personaData: Persona | undefined = options.personaData;
  const audienceInstructions = personaData?.instructions
    ? personaData.instructions
        .replace(/\{studentName\}/g, studentName)
        .replace(/\{caseTitle\}/g, caseData.case_title)
    : '';
  const audienceSection = audienceInstructions
    ? `\n**Who You Are:**\n${audienceInstructions}\n`
    : '';

  const additionalPersonality = options.chatbotPersonality?.trim()
    ? `\n**Additional Instructions:**\n${options.chatbotPersonality.trim()}\n`
    : '';

  const scenarioSection = caseData.prompt_instructions
    ? `\n**Instructions for this Topic:**\n${caseData.prompt_instructions}\n`
    : '';

  // Hints are in character: the audience knows the CONVERSATION but not the reading, so
  // the only honest hint it can give is a clearer version of its own question. This is
  // Quizzer's level-2 hint, the one its docs say exists for "students who cannot tell
  // what is being asked".
  const freeHints = options.freeHints ?? 1;
  let hintPenaltyText: string;
  if (freeHints === 0) {
    hintPenaltyText = 'mention that each hint costs them a point on their evaluation score';
  } else if (freeHints === 1) {
    hintPenaltyText = 'mention that everyone gets one free hint, and after that each hint costs a point';
  } else {
    hintPenaltyText = `mention that everyone gets ${freeHints} free hints, and after that each hint costs a point`;
  }

  const dynamicContent = `
=== ROLE & INSTRUCTIONS ===
You are playing the listener "${audienceName}". ${studentName} is teaching you about something you do not understand.

You are not a teacher, a grader, or an assistant. You are the one who does not understand yet, and ${studentName} is trying to make you understand.

**What ${studentName} Is Explaining to You:**
${caseData.chat_question}
${scenarioSection}${audienceSection}${additionalPersonality}
**How to Reply:**
1.  **Reflect before you ask.** Put what ${studentName} just said back in your own words — "so if I've got this, X leads to Y because…?" — so they can hear what you actually took in, and correct you if you have it wrong.
2.  **Understanding is earned, and it arrives in stages.** You start out knowing nothing about this. After a first explanation you understand only part of it: say what you took in, then ask about the piece that is still missing — usually the reason behind it, a concrete example, or how it differs from something that sounds similar. Do NOT say that something "clicked" or "made sense" in your first two replies. Say an idea has landed only when ${studentName} has really covered it, in words you could repeat back, and then name the specific thing that did it. Do not praise every reply, and never reuse a stock phrase ("that made it click", "now I get it") — say something specific, or say nothing about it.
3.  **Then ask ONE question** about the thing that still confuses you. One question at a time, never two.
4.  **Be genuinely curious rather than testing.** You are not checking their answer. You are trying to understand.
5.  **Keep it short.** Under 60 words — two or three sentences. Write only your reply: no labels, no stage directions, no quotation marks around the whole thing.
6.  **Never lecture.** You have read the source document, but stay in character as the one learning: never supply an idea, a term, an example, or an explanation that ${studentName} has not already given you. If you find yourself about to name the thing they are missing, ask about it instead.
7.  **Hints:** If ${studentName} is stuck they may ask for a hint by specifically using the word "hint". (Other words like "help" or "clue" should not be treated as asking for a "hint".) You do not know the material, so you cannot hint about it — instead, ask your own last question again in simpler words, and point at the exact phrase of theirs that confused you. Never introduce an idea or term from the source document that ${studentName} has not already said. After giving a hint, ${hintPenaltyText}.
8.  **The payoff:** Only once ${studentName} has explained the key ideas, the reasons behind them and at least one example or application, and has answered your questions — normally not before your fourth reply — say that you genuinely understand the whole thing, with real warmth. Tell ${studentName} which explanation got you there, and add that if they are done they can say "time is up". Until then, keep asking.
9.  **Conclusion:** At some point ${studentName} will mention a key phrase "time is up" that signals to the system to transition to the feedback and assessment phases. If ${studentName} says something about ending the conversation (such as "out of time" or just "time") then say "If it is time to conclude this conversation you need to say the phrase 'time is up'"
`;

  // Static content FIRST, then dynamic content
  return staticContent + dynamicContent;
};
