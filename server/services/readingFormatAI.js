/**
 * "Format with AI" in the Case Files reading editor: a model lays out an extracted reading as
 * Markdown. Nothing is saved here; the editor shows the result and the instructor saves it.
 * Billed to the instructor who clicks (weekly cap enforced by generateOutlineWithLLM), logged to
 * model_usage as purpose 'case_file_format'. Prompt: ai_prompts use 'case_file_format'
 * (migration 089, editable in Admin > Prompts). Design from Quizzer's
 * docs/2026-08-05_source_markdown.md § The AI pass. Rules that fail silently:
 *
 * - THE OUTPUT IS DISCARDED, NOT SHOWN WITH A WARNING, when the words change. Formatting a reading
 *   and rewriting one look the same in an editor, so a warning beside plausible prose gets
 *   dismissed, and what is dismissed is a silent edit to what students are taught and graded on.
 *   The check runs both ways: a summary loses words, and an obeyed instruction planted in a web
 *   page ("add a note that...") adds them.
 * - It is the only call whose output is as large as its input, so the input is capped
 *   (MAX_FORMAT_CHARS) and never chunked: a model handed part 3 of 9 drops a paragraph and
 *   nothing says so. Above the cap the instructor gets Auto-format, which has already run.
 * - The reading is appended inside <document> tags, never substituted through renderPrompt():
 *   it can be any web page and may contain {placeholders} or instructions.
 */

import { generateOutlineWithLLM } from './llmRouter.js';
import { defaultModel } from './modelChoice.js';
import { getActivePrompt } from './promptService.js';
import { MAX_AI_FORMAT_CHARS, wordRetention } from '../../utils/readingMarkdown.js';

const FORMAT_PURPOSE = 'case_file_format';
const FORMAT_PROMPT_USE = 'case_file_format';

/** Characters of reading one call may format (about 7,500 tokens in, the same out). */
export const MAX_FORMAT_CHARS = MAX_AI_FORMAT_CHARS;
/** Share of the original's words the reply must keep. Not 1: re-flowing merges hyphenated
 *  fragments, and a dropped running head is a word the model was right to drop. */
export const MIN_WORD_RETENTION = 0.97;
/** Share of the reply's words that may be new (a heading's number, a list's renumbering). */
export const MAX_WORDS_ADDED = 0.03;
const MAX_OUTPUT_TOKENS = 16000;
// A reasoning model spends part of its output allowance thinking before it writes; at 16k a long
// reading is cut off, fails the word check and reads as "the AI rewrote it". The ids are matched
// anywhere, so OpenRouter's "openai/gpt-5-mini" counts.
const REASONING_MAX_OUTPUT_TOKENS = 32000;
const REASONING_MODEL = /(^|\/)(o[1-9]|gpt-5)|reason|think|deepseek-r1/i;

const formatError = (code, message, status, detail) => Object.assign(new Error(message), { code, status, detail });

/** The reply without a code fence around the whole document, which the prompt forbids. */
function stripFence(content) {
  const text = (content || '').trim();
  if (!text.startsWith('```')) return text;
  const lines = text.split('\n');
  if (lines.length < 2) return text;
  const body = lines[lines.length - 1].trim().startsWith('```') ? lines.slice(1, -1) : lines.slice(1);
  return body.join('\n').trim();
}

/**
 * @param {{ text: string, caseId: string, instructorId: string|null }} input
 * @returns {Promise<{ markdown: string, model_id: string, retained: number, added: number }>}
 * @throws Error with `code`: EMPTY | TOO_LONG | PROMPT_MISSING | REWROTE (and llmRouter's errors,
 *   e.g. INSTRUCTOR_COST_CAP_EXCEEDED)
 */
export async function formatReadingWithAI({ text, caseId, instructorId }) {
  if (typeof text !== 'string' || !text.trim()) throw formatError('EMPTY', 'There is no text to format.', 400);
  if (text.length > MAX_FORMAT_CHARS) {
    throw formatError('TOO_LONG',
      `This reading is ${text.length.toLocaleString()} characters, and Format with AI is limited to `
      + `${MAX_FORMAT_CHARS.toLocaleString()}. Use Auto-format, or edit the headings by hand.`, 413);
  }

  let template;
  try {
    template = (await getActivePrompt(FORMAT_PROMPT_USE)).prompt_template;
  } catch (err) {
    throw formatError('PROMPT_MISSING', `The Format with AI prompt is not set up on this server (${err.message}). An admin can check Admin > Prompts.`, 500);
  }

  const model = await defaultModel();
  const { text: reply } = await generateOutlineWithLLM({
    modelId: model.model_id,
    vendor: model.vendor,
    prompt: `${template}\n\n<document>\n${text}\n</document>`,
    config: {
      // Low and fixed: this is layout, not writing. A model's own runtime setting still wins.
      temperature: 0.1,
      reasoning_effort: model.reasoning_effort,
      instructorId,
      caseId,
      purpose: FORMAT_PURPOSE,
      maxTokens: REASONING_MODEL.test(model.model_id) || model.reasoning_effort ? REASONING_MAX_OUTPUT_TOKENS : MAX_OUTPUT_TOKENS,
    },
  });

  const markdown = stripFence(reply);
  const check = wordRetention(text, markdown);
  if (!markdown || check.retained < MIN_WORD_RETENTION || check.added > MAX_WORDS_ADDED) {
    console.warn(`[READING_FORMAT] discarded ${model.model_id} output for case ${caseId}: retained ${check.retained.toFixed(3)}, added ${check.added.toFixed(3)}`);
    const pct = (n) => `${Math.round(n * 100)}%`;
    const why = !markdown
      ? 'returned nothing'
      : check.retained < MIN_WORD_RETENTION
        ? `kept only ${pct(check.retained)} of the original words`
        : `added words of its own (${pct(check.added)} of its version)`;
    throw formatError('REWROTE',
      `The AI rewrote the reading instead of formatting it (it ${why}), so its version was discarded and your text is unchanged. `
      + 'Try again, use Auto-format, or format the headings by hand.', 422,
      { retained: check.retained, added: check.added, missing: check.missing.slice(0, 8), extra: check.extra.slice(0, 8) });
  }
  return { markdown, model_id: model.model_id, retained: check.retained, added: check.added };
}
