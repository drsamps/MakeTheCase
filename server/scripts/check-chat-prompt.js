// Old name of check-activity-engine.js, kept as an alias (StudyChat Phase 1). The chat prompt
// goldens it used to check (fixtures/chat-prompt-golden.json, captured 2026-10-09) are now the
// first 13 system-prompt cases in fixtures/activity-engine-golden.json.
// Run: node server/scripts/check-chat-prompt.js [--db]
await import('./check-activity-engine.js');
