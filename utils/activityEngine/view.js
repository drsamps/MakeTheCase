/**
 * What a student may receive about an activity type: a WHITELIST, never the definition. Prompt
 * templates, grading framing and criteria stay on the server (rule 7 of the StudyChat plan).
 * The student page reads it with copy.js#copyFor and copy.js#activityIntroText.
 */

/**
 * @param {object} def - a validated definition
 * @param {string} version - the version tag the chat runs on (built-ins: `case_chat@<sha12>`)
 */
export function studentActivityView(def, version) {
  const t = def.traits;
  return {
    type: def.key,
    version,
    label: def.label,
    traits: {
      character: t.character,
      persona_kind: t.persona_kind,
      positions: t.positions,
      opening_word_floor: t.opening_word_floor,
      evidence: Boolean(t.grading_extras?.evidence),
      ...(t.personal ? { personal: true } : {}),
      ...(t.material !== 'activity' ? { material: t.material } : {}),
    },
    labels: { ...def.labels },
    // Copy plus the grading summary headings, which the evaluation screen recognises.
    copy: { ...def.copy, summary_headings: [...(def.grading.summary_headings || [])] },
  };
}
