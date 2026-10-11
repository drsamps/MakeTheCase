/**
 * Study-Chat activity types: the one list the server and the dashboard both read.
 *
 * A Study-Chat activity is: the student studies some documents, chats on a scenario with an AI
 * persona, the chat ends, the chat is graded against a rubric, and the instructor reviews the
 * results. The types differ in who the AI plays and what the student is asked to do.
 *
 * The type belongs to the CASE (`cases.activity_type`, migration 084) and is fixed once the case
 * is in use. It used to be `chat_options.activity_mode` on each assignment; that key is retired
 * and no code reads it. To run a second activity on the same reading, duplicate the case.
 *
 * Adding a type: add an entry here, add its prompt builders to
 * `server/services/activityTypes.js`, and install packages will accept it automatically
 * (`server/services/activityPack/capabilities.js` derives its list from this one).
 */

export const CASE_CHAT = 'case_chat';
export const TEACH_BACK = 'teach_back';

export const DEFAULT_ACTIVITY_TYPE = CASE_CHAT;

/**
 * personaKind     which personas the activity offers. 'audience' personas have ids beginning
 *                 `audience-`; every other persona is a 'protagonist' personality.
 * characterFrom   who the AI is in the chat: the scenario's protagonist, or the persona the
 *                 student picked (teach-back: "Your grandmother").
 * usesPositions   whether the student takes a position that can be tracked.
 */
export const ACTIVITY_TYPES = {
  [CASE_CHAT]: {
    id: CASE_CHAT,
    family: 'study_chat',
    label: 'Case chat',
    summary: 'The student argues a position with the case protagonist',
    personaKind: 'protagonist',
    characterFrom: 'scenario',
    usesPositions: true,
  },
  [TEACH_BACK]: {
    id: TEACH_BACK,
    family: 'study_chat',
    label: 'Teach-back',
    summary: 'The student explains the reading to an AI audience',
    personaKind: 'audience',
    characterFrom: 'persona',
    usesPositions: false,
  },
};

export const isKnownActivityType = (id) =>
  typeof id === 'string' && Object.prototype.hasOwnProperty.call(ACTIVITY_TYPES, id);

/** A stored type, or case chat for a missing or unknown one (the behaviour before types existed). */
export const normalizeActivityType = (id) => (isKnownActivityType(id) ? id : DEFAULT_ACTIVITY_TYPE);

export const getActivityType = (id) => ACTIVITY_TYPES[normalizeActivityType(id)];

export const listActivityTypes = () => Object.values(ACTIVITY_TYPES);
