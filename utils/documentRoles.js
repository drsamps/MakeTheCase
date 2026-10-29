/**
 * Case document roles (`case_files.file_type`) and who may read each one.
 *
 * The one list of roles, shared by the Case Files routes, the chat loader
 * (`server/routes/llm.js#loadCaseData`) and activity packages. `other:Label` is an instructor's
 * own label for supplementary reading.
 *
 * Who reads a role:
 *   student  shown to students and given to the AI (the case, readings, chapters, articles)
 *   ai_only  given to the AI and to staff, never sent to a student (teaching note, instructor notes)
 *
 * An outline takes the audience of its parent document.
 */

export const DOCUMENT_ROLES = ['case', 'teaching_note', 'chapter', 'reading', 'article', 'instructor_notes', 'outline'];

const AI_ONLY_ROLES = new Set(['teaching_note', 'instructor_notes']);

export const isDocumentRole = (role) =>
  typeof role === 'string' && (DOCUMENT_ROLES.includes(role) || (role.startsWith('other:') && role.length > 6 && role.length <= 50));

/** 'student' or 'ai_only'. Unknown roles count as student reading (the behaviour before roles had audiences). */
export const documentAudience = (role) => (AI_ONLY_ROLES.has(role) ? 'ai_only' : 'student');

export const isStudentVisibleRole = (role) => documentAudience(role) === 'student';
