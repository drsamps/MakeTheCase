/**
 * Position Inference Service
 *
 * Analyzes chat transcripts to infer student position (for/against) on case proposals.
 * Used when position_capture_method is set to 'ai_inferred'.
 */

import { routeLLMRequest } from './llmRouter.js';

/**
 * Build the prompt for position inference from transcript
 */
function buildPositionInferencePrompt(transcript, caseData, positionOptions) {
  const optionsStr = positionOptions.join(', ');

  return `You are analyzing a student's conversation with a case protagonist to determine their stance on the central question.

CASE: ${caseData.case_title || 'Unknown Case'}
CENTRAL QUESTION: ${caseData.chat_question || 'What should be done?'}

${caseData.arguments_for ? `ARGUMENTS FOR:\n${caseData.arguments_for}\n` : ''}
${caseData.arguments_against ? `ARGUMENTS AGAINST:\n${caseData.arguments_against}\n` : ''}

TRANSCRIPT:
${transcript}

Based on the student's statements, arguments, and conclusions in this transcript, determine:
1. Their position on the central question
2. Your confidence level (0.0 to 1.0)
3. Brief reasoning for your determination

Available positions: ${optionsStr}

Respond ONLY with valid JSON in this exact format:
{
  "position": "<one of: ${optionsStr}>",
  "confidence": <number between 0.0 and 1.0>,
  "reasoning": "<1-2 sentence explanation of how you determined the position>"
}`;
}

/**
 * Infer student position from a chat transcript
 *
 * @param {string} transcript - The full chat transcript
 * @param {object} caseData - Case data including title, question, arguments_for/against
 * @param {string[]} positionOptions - Available position choices (e.g., ['for', 'against'])
 * @param {string} modelId - The LLM model to use for inference
 * @returns {Promise<{position: string, confidence: number, reasoning: string} | null>}
 */
export async function inferPositionFromTranscript(transcript, caseData, positionOptions, modelId) {
  if (!transcript || transcript.trim().length === 0) {
    console.log('[PositionInference] No transcript provided');
    return null;
  }

  if (!positionOptions || positionOptions.length < 2) {
    positionOptions = ['for', 'against'];
  }

  const prompt = buildPositionInferencePrompt(transcript, caseData, positionOptions);

  try {
    // Use the LLM router to make the request
    const response = await routeLLMRequest({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.3, // Low temperature for more deterministic results
    });

    if (!response?.content) {
      console.error('[PositionInference] No content in LLM response');
      return null;
    }

    // Parse the JSON response
    const content = response.content.trim();

    // Try to extract JSON from the response (handle markdown code blocks)
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const result = JSON.parse(jsonStr);

    // Validate the response
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

/**
 * Batch infer positions for multiple transcripts
 *
 * @param {Array<{chatId: string, transcript: string}>} chats - Array of chat data
 * @param {object} caseData - Case data
 * @param {string[]} positionOptions - Position choices
 * @param {string} modelId - LLM model ID
 * @returns {Promise<Map<string, {position: string, confidence: number, reasoning: string}>>}
 */
export async function batchInferPositions(chats, caseData, positionOptions, modelId) {
  const results = new Map();

  // Process sequentially to avoid rate limits
  for (const chat of chats) {
    const result = await inferPositionFromTranscript(
      chat.transcript,
      caseData,
      positionOptions,
      modelId
    );
    if (result) {
      results.set(chat.chatId, result);
    }
  }

  return results;
}

export default {
  inferPositionFromTranscript,
  batchInferPositions,
};
