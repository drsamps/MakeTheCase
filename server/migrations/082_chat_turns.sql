-- Migration 082: chat_turns — the server's own copy of each student chat.
--
-- Phase 3b of docs/security-student-data-access.md (design in docs/server-side-chat-prompt.md).
-- The browser used to send the whole conversation with every turn and again for grading, so a
-- student could invent what the model saw and what was graded. Now /api/llm/chat appends each
-- exchange here and sends the model this copy; /api/evaluations/run grades it; and the
-- transcripts row instructors read is written from it (utils/transcriptFormat.js#formatTranscript).
--
-- Turn 0 is the protagonist's (or Teach-back listener's) greeting, written when the chat is
-- created. Only exchanges the model answered are stored: browser-only lines (refused hints,
-- warnings, feedback questions) are not part of the conversation.

CREATE TABLE IF NOT EXISTS chat_turns (
  id BIGINT NOT NULL AUTO_INCREMENT,
  case_chat_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  turn_index INT NOT NULL COMMENT '0 = greeting, then student/protagonist pairs',
  role ENUM('student', 'protagonist') NOT NULL,
  content MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'Server time; drives transcript turn timing',
  PRIMARY KEY (id),
  UNIQUE KEY uq_chat_turn (case_chat_id, turn_index),
  CONSTRAINT chat_turns_ibfk_1 FOREIGN KEY (case_chat_id) REFERENCES case_chats (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Server-held conversation for each case chat (greeting + model-answered exchanges)';
