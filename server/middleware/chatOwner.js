/**
 * Ownership checks for the student chat path (Phase 2b of docs/security-student-data-access.md).
 * Both factories run verifyToken themselves and return a middleware array.
 */

import { pool } from '../db.js';
import { verifyToken } from './auth.js';
import { canViewChat } from './instructorAccess.js';

/**
 * The caller must own the case chat (a student whose id is case_chats.student_id) or be staff
 * who can view its section (canViewChat). Anyone else, and a missing chat, gets 404 so chat
 * IDs can't be probed. Sets req.caseChat = { id, student_id, case_id }.
 *
 * @param {string} name - where the chat id is: a route param, or a body field when source = 'body'
 * @param {'params'|'body'} source
 */
export function requireChatOwner(name = 'id', source = 'params') {
  return [verifyToken, async (req, res, next) => {
    try {
      const chatId = req[source]?.[name];
      if (!chatId) {
        return res.status(400).json({ data: null, error: { message: `${name} is required` } });
      }
      const [rows] = await pool.execute('SELECT id, student_id, case_id FROM case_chats WHERE id = ?', [chatId]);
      const chat = rows[0];
      const allowed = chat && (req.user.role === 'student'
        ? chat.student_id === req.user.id
        : ['admin', 'instructor'].includes(req.user.role) && await canViewChat(req, chatId));
      if (!allowed) {
        return res.status(404).json({ data: null, error: { message: 'Chat not found' } });
      }
      req.caseChat = chat;
      next();
    } catch (error) {
      console.error('requireChatOwner error:', error);
      res.status(500).json({ data: null, error: { message: 'Failed to check chat access' } });
    }
  }];
}

/**
 * The caller must be the student named by the route param (e.g. :studentId). These routes
 * only serve the student chat screen, so staff are refused too.
 */
export function requireSelfStudent(paramName = 'studentId') {
  return [verifyToken, (req, res, next) => {
    if (req.user.role !== 'student' || req.params[paramName] !== req.user.id) {
      return res.status(403).json({ data: null, error: { message: 'Forbidden' } });
    }
    next();
  }];
}
