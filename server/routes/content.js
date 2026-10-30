import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { verifyToken, requireRole } from '../middleware/auth.js';

const router = express.Router();
const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

router.get('/welcome', async (_req, res) => {
  try {
    const filePath = path.join(process.cwd(), 'config', 'welcome.md');
    const markdown = await fs.readFile(filePath, 'utf8');
    res.json({ markdown });
  } catch (_err) {
    res.status(404).json({ markdown: '' });
  }
});

/**
 * Guides shown on Home > Help. Only files listed here are ever read: the id in the URL is looked
 * up in this list and never joined into a path. Add a guide by adding an entry.
 */
const HELP_GUIDES = [
  {
    id: 'studychat-guide',
    file: 'studychat-guide.md',
    group: 'StudyChat activities',
    title: 'Designing StudyChat activities',
    summary: 'The guide for TAs and instructors: the activity types, when to use each, and a Debate set up start to finish.',
  },
  {
    id: 'studychat-reference',
    file: 'studychat-activity-design.md',
    group: 'StudyChat activities',
    title: 'StudyChat activity design: full reference',
    summary: 'Every activity type in detail, and the reasoning behind the guide.',
  },
  {
    id: 'teach-back-ta',
    file: 'ta-guide-teach-back.md',
    group: 'Teach-back',
    title: 'Setting up a Teach-back activity (TA guide)',
    summary: 'The short, click-by-click version.',
  },
  {
    id: 'teach-back-setup',
    file: 'teach-back-setup.md',
    group: 'Teach-back',
    title: 'Setting up a Teach-back assignment',
    summary: 'The full walkthrough, with the reasons behind each setting.',
  },
  {
    id: 'chat-options',
    file: 'chat-options-reference.md',
    group: 'Reference',
    title: 'Chat options reference',
    summary: 'What each chat option on an assignment does.',
  },
  {
    id: 'instructor-manual',
    file: 'Instructor_Manual-2026-01.md',
    group: 'Reference',
    title: 'Instructor manual (January 2026)',
    summary: 'Common instructor workflows. Written before StudyChat, so it covers case chats only.',
  },
];

const GUIDE_BY_FILE = new Map(HELP_GUIDES.map(g => [g.file, g]));

/**
 * Point links between guides at the Help screen (#help/<id>). Links to documents that are not
 * guides (developer docs) become plain text, since the dashboard cannot show them.
 */
function rewriteGuideLinks(markdown) {
  return markdown.replace(/\[([^\]]+)\]\((?:\.\/)?([A-Za-z0-9_.-]+\.md)(#[^)\s]*)?\)/g, (_m, text, file) => {
    const guide = GUIDE_BY_FILE.get(file);
    if (!guide) return text;
    const label = text.replace(/`/g, '') === file ? guide.title : text;
    return `[${label}](#help/${guide.id})`;
  });
}

router.get('/help', verifyToken, requireRole(['admin', 'instructor']), (_req, res) => {
  res.json({ guides: HELP_GUIDES.map(({ file, ...rest }) => rest) });
});

router.get('/help/:id', verifyToken, requireRole(['admin', 'instructor']), async (req, res) => {
  const guide = HELP_GUIDES.find(g => g.id === req.params.id);
  if (!guide) return res.status(404).json({ error: 'Guide not found' });
  try {
    const markdown = await fs.readFile(path.join(PROJECT_ROOT, 'docs', guide.file), 'utf8');
    res.json({ id: guide.id, title: guide.title, markdown: rewriteGuideLinks(markdown) });
  } catch (_err) {
    res.status(404).json({ error: 'Guide file is missing on this server' });
  }
});

export default router;
