/**
 * "Draft with AI" for a teach-back scenario's student text: one playful intro line and one
 * opening message per audience, in a single call. Nothing is saved here. The instructor reads
 * the drafts in the scenario editor, edits them, and saves them through PATCH /scenarios/:id
 * (student_settings), so every student who picks an audience reads the same approved words.
 *
 * The prompt carries no reading: the audience does not know the material, and an opening that
 * explained the topic would give the answer away. Persona instructions go to the model only;
 * the response holds nothing but the drafted text.
 *
 * Billed to the instructor who clicks (weekly cap enforced by generateOutlineWithLLM), logged
 * to model_usage as purpose 'scenario_drafts'.
 */

import { jsonrepair } from 'jsonrepair';
import { pool } from '../db.js';
import { generateOutlineWithLLM } from './llmRouter.js';
import { STUDENT_NAME_TOKEN, STUDENT_SETTINGS_LIMITS } from '../../utils/scenarioSettings.js';

const DRAFT_PURPOSE = 'scenario_drafts';

/** The default chat model (models.default_model is a RANK: 1 is the default). */
async function draftModel() {
  const [rows] = await pool.execute(
    `SELECT model_id, vendor, temperature, reasoning_effort FROM models
      WHERE enabled = 1 ORDER BY (default_model = 1) DESC, model_id ASC LIMIT 1`
  );
  if (rows.length === 0) throw Object.assign(new Error('No AI model is enabled.'), { status: 409 });
  return rows[0];
}

function buildPrompt({ caseTitle, scenarioName, topic, situation, audiences }) {
  const list = audiences.map((a) => [
    `### id: ${a.persona_id}`,
    `Name shown to the student: ${a.persona_name}`,
    a.description ? `Short description: ${a.description}` : null,
    a.instructions ? `Who they are:\n${a.instructions.replace(/\{studentName\}/g, 'the student').replace(/\{caseTitle\}/g, caseTitle)}` : null,
  ].filter(Boolean).join('\n')).join('\n\n');

  return `You are helping an instructor set up a "teach-back" activity. A student will explain a topic from a reading to an AI character (an "audience") who does not understand it yet. For each audience below, write two things.

1. "intro": ONE short, playful, slightly funny sentence (under 25 words) about this audience, shown to the student in an instruction bar above the chat. Capture the audience's quirk with a light, specific image; do not just restate their description. Write in the third person, starting with the name shown to the student. Do not say they are eager or want to learn (the bar says that next). Do not mention scores or grading.
   Examples of the tone wanted (for other audiences; write fresh lines, do not reuse these):
   - "Uncle Ray has fixed every car on the block and suspects this works like a carburetor."
   - "The new intern owns four highlighters and no idea which parts matter yet."
   - "Your neighbor has strong opinions about everything, but this one has her stumped."

2. "opening": the audience's first chat message, in their own voice and personality, as a person would actually talk.
   - Begin exactly with "Hi, ${STUDENT_NAME_TOKEN}!" (keep the placeholder ${STUDENT_NAME_TOKEN} exactly as written; it is replaced by the student's first name).
   - Introduce yourself naturally, in character (a grandmother says "It's Grandma", not "I'm your grandmother"). Do not invent a personal name: use a name only if the name shown to the student contains one (e.g. "Sam"); otherwise introduce yourself by who you are ("your new colleague", "a reporter from the local paper").
   - ${situation ? 'Tell the situation below as a quick bit of your own story, in your own words.' : 'Give a brief, believable reason, fitting this audience, why you need to understand the topic.'}
   - Say why you need to understand the topic to deal with that, then ask the student to help you understand it.
   - You do NOT understand the topic: never explain it, define its terms or hint at the answer.
   - Do not tell the student how to teach you (no "use an example", "keep it short", "start from the basics").
   - Under 80 words. Plain text; bold the topic once with **double asterisks**. No stage directions, no quotation marks around the message.

Activity: ${caseTitle}
Scenario: ${scenarioName || '(unnamed)'}
Topic the student will explain: ${topic}
${situation ? `The audience's situation (written to follow "I ..."): I ${situation}` : 'No situation was given.'}

Audiences:

${list}

Return ONLY a JSON object, with no other text, of the form:
{"personas": {"<id>": {"intro": "...", "opening": "..."}}}
Use exactly the ids listed above, one entry for each.`;
}

/** The first complete top-level JSON object in `text` (models sometimes add a second one). */
function firstObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return text;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start); // unbalanced (cut off): let jsonrepair try
}

function parseJson(text) {
  if (!text) throw new Error('The AI returned nothing.');
  let candidate = text.trim();
  const fence = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) candidate = fence[1].trim();
  candidate = firstObject(candidate);
  try {
    return JSON.parse(candidate);
  } catch {
    try {
      return JSON.parse(jsonrepair(candidate));
    } catch (err) {
      console.error('[SCENARIO_DRAFTS] unparseable reply:', text.length, 'chars; head:', text.slice(0, 300), '... tail:', text.slice(-300));
      throw new Error('The AI reply was not in the expected format. Try again.');
    }
  }
}

// Audiences per call. Smaller calls finish sooner, run in parallel, and keep each reply well
// inside the output limit (reasoning models spend part of it before they write).
const BATCH_SIZE = 3;
// Calls in flight at once. Each call checks the weekly cap before it starts, against usage
// recorded so far, so this bounds how far one click can run past the cap.
const CONCURRENCY = 3;

const clip = (s, max) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

// A greeting at the start of a reply that has no {studentName}: "Hi, Alex!", "Hey Sam Lee,",
// "Hello there!", "Hi!". Only capitalised words count as a name, so "Hello, I'm ..." loses just
// "Hello, ".
const LEADING_GREETING = /^(?:[Hh]i|[Hh]ello|[Hh]ey)(?:\s+there)?(?:,?\s+[A-Z][\w'-]*(?:\s+[A-Z][\w'-]*)?)?\s*[!,.]\s*/;

/**
 * A drafted opening with the student's-name token in it, within the stored limit. A reply that
 * greeted with a made-up name (or none) has that greeting replaced, not doubled. The token is
 * put in before clipping, so the result never exceeds what validateStudentSettings accepts.
 */
function draftedOpening(raw) {
  const max = STUDENT_SETTINGS_LIMITS.opening;
  let text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return '';
  if (!text.slice(0, max).includes(STUDENT_NAME_TOKEN)) {
    text = `Hi, ${STUDENT_NAME_TOKEN}! ${text.replace(LEADING_GREETING, '')}`;
  }
  return text.slice(0, max).trim();
}

const isCapError = (err) => err?.code === 'INSTRUCTOR_COST_CAP_EXCEEDED';

/**
 * @param {{ caseId, caseTitle, scenarioName, topic, situation, audiences, instructorId }} input
 *   audiences: [{ persona_id, persona_name, description, instructions }]
 * @returns {Promise<{ personas: Record<string, { intro: string, opening: string }>, model_id: string,
 *   incomplete: boolean, cap_reached: boolean }>}
 */
export async function draftStudentText({ caseId, caseTitle, scenarioName, topic, situation, audiences, instructorId }) {
  const model = await draftModel();
  const draftBatch = async (batch) => {
    const { text } = await generateOutlineWithLLM({
      modelId: model.model_id,
      vendor: model.vendor,
      prompt: buildPrompt({ caseTitle, scenarioName, topic, situation, audiences: batch }),
      config: {
        temperature: model.temperature,
        reasoning_effort: model.reasoning_effort,
        instructorId,
        caseId,
        purpose: DRAFT_PURPOSE,
        maxTokens: 8000,
      },
    });
    return parseJson(text);
  };

  const batches = [];
  for (let i = 0; i < audiences.length; i += BATCH_SIZE) batches.push(audiences.slice(i, i + BATCH_SIZE));

  // A few workers take batches in turn. Once one is refused by the weekly cap, no further batch
  // starts: the ones not started are reported like failed ones, to be drafted again later.
  const results = new Array(batches.length);
  let next = 0;
  let capReached = false;
  const worker = async () => {
    while (next < batches.length && !capReached) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await draftBatch(batches[i]) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
        if (isCapError(reason)) capReached = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

  const settled = results.filter(Boolean);
  const failures = settled.filter((r) => r.status === 'rejected');
  if (failures.length === settled.length) throw (failures.find((f) => isCapError(f.reason)) || failures[0]).reason;

  const wanted = new Set(audiences.map((a) => a.persona_id));
  const personas = {};
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const [id, entry] of Object.entries(result.value?.personas || {})) {
      if (!wanted.has(id) || !entry || typeof entry !== 'object') continue; // ids the model invented
      personas[id] = { intro: clip(entry.intro, STUDENT_SETTINGS_LIMITS.intro), opening: draftedOpening(entry.opening) };
    }
  }
  // Some batches can fail (or not start) while others succeed; the editor shows what came back
  // and the rest can be drafted again row by row.
  return {
    personas,
    model_id: model.model_id,
    incomplete: settled.length < batches.length || failures.length > 0,
    cap_reached: capReached,
  };
}
