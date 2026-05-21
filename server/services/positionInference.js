/**
 * Position Inference Service
 *
 * Uses AI to analyze chat transcripts and infer student positions
 * when capture method is 'ai_inferred'.
 *
 * Updated to support the new scenario_positions table with position IDs.
 */

import { pool } from '../db.js';
import { chatWithLLM } from './llmRouter.js';
import { resolveInstructorForCaseChat, resolveSectionForCaseChat } from './keyResolver.js';

/**
 * Build the system prompt for position inference
 */
function buildInferencePrompt(chatQuestion, positions) {
  const positionList = positions
    .map(p => `- ${p.position_name}: "${p.position}"`)
    .join('\n');

  return `You are an expert at analyzing conversations and determining a person's stance on issues.

Your task is to analyze a conversation between a student and a business case protagonist, and determine:
1. The student's INITIAL position at the start of the conversation (based on their first few responses)
2. The student's FINAL position at the end of the conversation (based on their conclusion)

THE QUESTION BEING DISCUSSED:
${chatQuestion}

AVAILABLE POSITIONS:
${positionList}

INSTRUCTIONS:
1. Carefully read the conversation transcript
2. Identify signals that indicate the student's position:
   - Direct statements of agreement/disagreement
   - Arguments that align with specific positions
   - Recommendations they make
3. Determine which position best matches their INITIAL stance (early in conversation)
4. Determine which position best matches their FINAL stance (end of conversation)
5. Provide a confidence score (0.0 to 1.0) for each inference
6. Write brief reasoning explaining your assessment

RESPOND IN VALID JSON FORMAT ONLY:
{
  "initial_position_name": "position_name_here",
  "initial_confidence": 0.85,
  "final_position_name": "position_name_here",
  "final_confidence": 0.90,
  "reasoning": "Brief explanation of your assessment (2-3 sentences)"
}

If you cannot determine a position with reasonable confidence (< 0.3), set the position_name to null.`;
}

/**
 * Parse the AI response and extract position data
 */
function parseInferenceResponse(responseText, positions) {
  // Clean up response - remove markdown code blocks if present
  let cleaned = responseText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned);

    // Map position names to position IDs
    const findPositionId = (name) => {
      if (!name) return null;
      const pos = positions.find(p =>
        p.position_name.toLowerCase() === name.toLowerCase()
      );
      return pos ? pos.position_id : null;
    };

    return {
      initial_position_id: findPositionId(parsed.initial_position_name),
      initial_position_name: parsed.initial_position_name,
      initial_confidence: Math.min(1.0, Math.max(0.0, parsed.initial_confidence || 0)),
      final_position_id: findPositionId(parsed.final_position_name),
      final_position_name: parsed.final_position_name,
      final_confidence: Math.min(1.0, Math.max(0.0, parsed.final_confidence || 0)),
      reasoning: parsed.reasoning || 'No reasoning provided',
      raw_response: parsed
    };
  } catch (e) {
    console.error('[PositionInference] Failed to parse AI response:', e.message);
    console.error('[PositionInference] Raw response:', responseText);
    throw new Error(`Failed to parse AI inference response: ${e.message}`);
  }
}

/**
 * Infer positions from a chat transcript
 *
 * @param {string} caseChatId - The case_chat ID to analyze
 * @param {string} modelId - The LLM model to use for inference
 * @returns {object} - Inference results with position IDs and confidence scores
 */
export async function inferPositionsFromChat(caseChatId, modelId = 'gemini-1.5-flash') {
  // Get chat details including scenario and transcript
  const [chatRows] = await pool.execute(
    `SELECT cc.id, cc.scenario_id, cc.case_id, cc.status,
            cs.chat_question,
            t.transcript
     FROM case_chats cc
     LEFT JOIN case_scenarios cs ON cc.scenario_id = cs.id
     LEFT JOIN transcripts t ON t.case_chat_id = cc.id
     WHERE cc.id = ?`,
    [caseChatId]
  );

  if (chatRows.length === 0) {
    throw new Error('Chat not found');
  }

  const chat = chatRows[0];

  if (!chat.scenario_id) {
    throw new Error('Chat has no associated scenario');
  }

  if (!chat.transcript) {
    throw new Error('Chat has no transcript - cannot infer positions');
  }

  // Get available positions for this scenario
  const [positions] = await pool.execute(
    `SELECT position_id, position_name, position
     FROM scenario_positions
     WHERE scenario_id = ? AND position_enabled = 1
     ORDER BY position_order ASC`,
    [chat.scenario_id]
  );

  if (positions.length === 0) {
    throw new Error('No positions defined for this scenario');
  }

  // Build the inference prompt
  const systemPrompt = buildInferencePrompt(chat.chat_question, positions);

  // Call the LLM
  const userMessage = `CONVERSATION TRANSCRIPT:\n\n${chat.transcript}\n\nAnalyze this conversation and provide your position inference as JSON.`;

  const instructorId = await resolveInstructorForCaseChat(caseChatId);
  const sectionId = await resolveSectionForCaseChat(caseChatId);
  const response = await chatWithLLM({
    modelId,
    systemPrompt,
    history: [],
    message: userMessage,
    config: {
      temperature: 0.3,
      instructorId,
      sectionId,
      caseId: chat.case_id || null,
      purpose: 'position_inference',
    }
  });

  // Parse the response
  const inference = parseInferenceResponse(response.text, positions);

  // Calculate overall confidence (average of both)
  const overallConfidence = (inference.initial_confidence + inference.final_confidence) / 2;

  // Update case_chats with inference results
  await pool.execute(
    `UPDATE case_chats
     SET initial_position_id = COALESCE(?, initial_position_id),
         initial_position = COALESCE(?, initial_position),
         final_position_id = COALESCE(?, final_position_id),
         final_position = COALESCE(?, final_position),
         position_method = CASE
           WHEN position_method IS NULL THEN 'ai_inferred'
           ELSE position_method
         END,
         position_inferred_at = NOW(),
         position_inference_confidence = ?,
         position_inference_reasoning = ?
     WHERE id = ?`,
    [
      inference.initial_position_id,
      inference.initial_position_name,
      inference.final_position_id,
      inference.final_position_name,
      overallConfidence,
      inference.reasoning,
      caseChatId
    ]
  );

  // Log the inferences to position logs
  if (inference.initial_position_id) {
    await pool.execute(
      `INSERT INTO chat_position_logs
       (case_chat_id, position_type, position_value, recorded_by, confidence, notes)
       VALUES (?, 'initial', ?, 'ai', ?, ?)`,
      [caseChatId, inference.initial_position_name, inference.initial_confidence, inference.reasoning]
    );
  }

  if (inference.final_position_id) {
    await pool.execute(
      `INSERT INTO chat_position_logs
       (case_chat_id, position_type, position_value, recorded_by, confidence, notes)
       VALUES (?, 'final', ?, 'ai', ?, ?)`,
      [caseChatId, inference.final_position_name, inference.final_confidence, inference.reasoning]
    );
  }

  return {
    case_chat_id: caseChatId,
    initial_position_id: inference.initial_position_id,
    initial_position_name: inference.initial_position_name,
    initial_confidence: inference.initial_confidence,
    final_position_id: inference.final_position_id,
    final_position_name: inference.final_position_name,
    final_confidence: inference.final_confidence,
    overall_confidence: overallConfidence,
    reasoning: inference.reasoning,
    position_changed: inference.initial_position_id !== inference.final_position_id &&
                      inference.initial_position_id !== null &&
                      inference.final_position_id !== null
  };
}

/**
 * Check if a chat should have positions inferred
 * Returns true if the chat uses ai_inferred method and hasn't been inferred yet
 */
export async function shouldInferPositions(caseChatId) {
  const [rows] = await pool.execute(
    `SELECT cc.id, cc.scenario_id, cc.status, cc.position_method, cc.position_inferred_at,
            sc.position_capture_method
     FROM case_chats cc
     JOIN section_cases sc ON cc.section_id = sc.section_id AND cc.case_id = sc.case_id
     WHERE cc.id = ?`,
    [caseChatId]
  );

  if (rows.length === 0) return false;

  const chat = rows[0];

  // Only infer if:
  // 1. Chat is completed
  // 2. Capture method is ai_inferred
  // 3. Positions haven't been inferred yet
  return chat.status === 'completed' &&
         chat.position_capture_method === 'ai_inferred' &&
         chat.position_inferred_at === null;
}

/**
 * Legacy function for backward compatibility
 * Infer position from a transcript string (old interface)
 */
export async function inferPositionFromTranscript(transcript, caseData, positionOptions, modelId, instructorId = null) {
  if (!transcript || transcript.trim().length === 0) {
    console.log('[PositionInference] No transcript provided');
    return null;
  }

  if (!positionOptions || positionOptions.length < 2) {
    positionOptions = ['for', 'against'];
  }

  // Build a simple prompt for legacy usage
  const optionsStr = positionOptions.join(', ');
  const prompt = `You are analyzing a student's conversation with a case protagonist to determine their stance.

CASE: ${caseData.case_title || 'Unknown Case'}
CENTRAL QUESTION: ${caseData.chat_question || 'What should be done?'}

${caseData.arguments_for ? `ARGUMENTS FOR:\n${caseData.arguments_for}\n` : ''}
${caseData.arguments_against ? `ARGUMENTS AGAINST:\n${caseData.arguments_against}\n` : ''}

TRANSCRIPT:
${transcript}

Based on the student's statements and conclusions, determine their position.
Available positions: ${optionsStr}

Respond ONLY with valid JSON:
{
  "position": "<one of: ${optionsStr}>",
  "confidence": <number between 0.0 and 1.0>,
  "reasoning": "<1-2 sentence explanation>"
}`;

  try {
    const response = await chatWithLLM({
      modelId: modelId || 'gemini-1.5-flash',
      systemPrompt: 'You are an expert at analyzing conversations and determining a person\'s stance on issues. Respond only with valid JSON.',
      history: [],
      message: prompt,
      config: {
        temperature: 0.3,
        instructorId,
        caseId: caseData?.case_id || null,
        purpose: 'position_inference',
      }
    });

    // Parse the JSON response
    let jsonStr = response.text.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const result = JSON.parse(jsonStr);

    if (!result.position || !positionOptions.includes(result.position.toLowerCase())) {
      console.error('[PositionInference] Invalid position in response:', result.position);
      return null;
    }

    return {
      position: result.position.toLowerCase(),
      confidence: typeof result.confidence === 'number' ? Math.max(0, Math.min(1, result.confidence)) : 0.5,
      reasoning: result.reasoning || 'No reasoning provided',
    };
  } catch (error) {
    console.error('[PositionInference] Error inferring position:', error);
    return null;
  }
}

export default {
  inferPositionsFromChat,
  shouldInferPositions,
  inferPositionFromTranscript
};
