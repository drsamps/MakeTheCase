/**
 * The built-in activity type definitions: locked (admins clone them, never edit them) and proved
 * byte for byte against the hand builders by server/scripts/check-activity-engine.js.
 *
 * Server-only: the student page must never import this file (it would bundle prompt templates).
 * A deliberate wording change edits the JSON and the golden fixture in the same commit.
 */

import caseChat from './case_chat.json' with { type: 'json' };
import teachBack from './teach_back.json' with { type: 'json' };

export const BUILTIN_DEFINITIONS = Object.freeze({
  [caseChat.key]: caseChat,
  [teachBack.key]: teachBack,
});
