import express from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = express.Router();

router.get('/welcome', async (_req, res) => {
  try {
    const filePath = path.join(process.cwd(), 'config', 'welcome.md');
    const markdown = await fs.readFile(filePath, 'utf8');
    res.json({ markdown });
  } catch (_err) {
    res.status(404).json({ markdown: '' });
  }
});

export default router;
