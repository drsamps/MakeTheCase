import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { testConnection } from './db.js';
// Admin dashboard enhancements - December 2025 - v2

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import routes
import authRoutes from './routes/auth.js';
import modelsRoutes from './routes/models.js';
import sectionsRoutes from './routes/sections.js';
import llmRoutes from './routes/llm.js';
import studentsRoutes from './routes/students.js';
import evaluationsRoutes from './routes/evaluations.js';
import casRoutes from './routes/cas.js';
import casesRoutes from './routes/cases.js';
import scenariosRoutes from './routes/scenarios.js';
import sectionCasesRoutes from './routes/sectionCases.js';
import chatOptionsRoutes from './routes/chatOptions.js';
import personasRoutes from './routes/personas.js';
import caseChatsRoutes from './routes/caseChats.js';
import transcriptsRoutes from './routes/transcripts.js';
import casePrepRoutes from './routes/casePrep.js';
import caseFilesRoutes from './routes/caseFiles.js';
import llmMetricsRoutes from './routes/llmMetrics.js';
import promptsRoutes from './routes/prompts.js';
import settingsRoutes from './routes/settings.js';
import adminsRoutes from './routes/admins.js';
import studentSectionsRoutes from './routes/studentSections.js';
import analyticsRoutes from './routes/analytics.js';
import positionTemplatesRoutes from './routes/positionTemplates.js';
import semestersRoutes from './routes/semesters.js';
import coursesRoutes from './routes/courses.js';
import instructorsRoutes from './routes/instructors.js';
import rubricsRoutes from './routes/rubrics.js';
import rubricCriteriaRoutes from './routes/rubricCriteria.js';
import logsRoutes from './routes/logs.js';
import caseWriterRoutes from './routes/caseWriter.js';
import shadowOwnershipRoutes from './routes/shadowOwnership.js';
import apiKeysRoutes from './routes/apiKeys.js';
import teamsRoutes from './routes/teams.js';
import feedbackRoutes from './routes/feedback.js';
import contentRoutes from './routes/content.js';
import usageRoutes from './routes/usage.js';
import { startTruncateOldRawUsageJob } from './jobs/truncateOldRawUsage.js';

// Load environment variables
// Use absolute path to ensure .env.local is found regardless of working directory
const envPath = path.join(__dirname, '..', '.env.local');
dotenv.config({ path: envPath });

const app = express();
const PORT = process.env.SERVER_PORT || 3001;

// Trust proxy - important for correct handling of X-Forwarded-* headers in production
app.set('trust proxy', true);

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://services.byu.edu'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/cas', casRoutes);
app.use('/api/models', modelsRoutes);
app.use('/api/sections', sectionsRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/evaluations', evaluationsRoutes);
app.use('/api/llm', llmRoutes);
app.use('/api/cases', casesRoutes);
app.use('/api/cases', scenariosRoutes); // Scenario management (nested under cases)
app.use('/api/sections', sectionCasesRoutes); // Section-case assignments (nested under sections)
app.use('/api/chat-options', chatOptionsRoutes); // Chat options schema and defaults
app.use('/api/personas', personasRoutes); // Persona management
app.use('/api/case-chats', caseChatsRoutes); // Chat session tracking
app.use('/api/transcripts', transcriptsRoutes); // Chat transcript storage and privacy management
app.use('/api/case-prep', casePrepRoutes); // Case prep file upload and AI processing
console.log('✓ Case prep routes mounted at /api/case-prep');
app.use('/api/case-files', caseFilesRoutes); // Case file management
console.log('✓ Case files routes mounted at /api/case-files');
app.use('/api/llm-metrics', llmMetricsRoutes); // LLM cache metrics and analytics
console.log('✓ LLM metrics routes mounted at /api/llm-metrics');
app.use('/api/prompts', promptsRoutes); // AI prompt template management
app.use('/api/settings', settingsRoutes); // Application settings
app.use('/api/admins', adminsRoutes); // Instructor management (superuser only)
app.use('/api/student-sections', studentSectionsRoutes); // Student self-enrollment
app.use('/api/analytics', analyticsRoutes); // Consolidated results analytics
console.log('✓ Analytics routes mounted at /api/analytics');
app.use('/api/position-templates', positionTemplatesRoutes); // Position templates management
console.log('✓ Position templates routes mounted at /api/position-templates');
app.use('/api/semesters', semestersRoutes); // Semester management (includes /api/semesters/:id/courses)
app.use('/api/courses', coursesRoutes); // Course management (/api/courses/:id)
app.use('/api/instructors', instructorsRoutes); // Instructor management and assignments
console.log('✓ Semesters, courses, and instructors routes mounted');
app.use('/api/rubrics', rubricsRoutes); // Rubric management
app.use('/api/rubric-criteria', rubricCriteriaRoutes); // Rubric criteria management
app.use('/api/logs', logsRoutes); // AI prompt logging management
app.use('/api/case-writer', caseWriterRoutes); // Case Writer authoring tool
app.use('/api/admin/shadow-ownership', shadowOwnershipRoutes); // Admin: transfer legacy resources off the shadow instructor
app.use('/api/api-keys', apiKeysRoutes); // Per-instructor encrypted API key storage
app.use('/api/teams', teamsRoutes); // Instructor teams + sharing
app.use('/api/feedback', feedbackRoutes); // In-app user feedback system
app.use('/api/content', contentRoutes); // Static markdown content (e.g. instructor welcome screen)
app.use('/api/usage', usageRoutes); // AI cost-first usage reporting (model_usage table)
console.log('✓ Rubrics routes mounted');
console.log('✓ Case Writer routes mounted at /api/case-writer');

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Static files are served directly by Apache in production for better performance
// Only serve static files in development mode or if not behind Apache proxy
if (process.env.NODE_ENV !== 'production') {
  const distPath = path.join(__dirname, '../dist');
  app.use(express.static(distPath));
  
  // Catch-all handler for development: send back React's index.html file
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Start server
async function start() {
  await testConnection();
  startTruncateOldRawUsageJob();
  app.listen(PORT, () => {
    console.log(`✓ API server running on http://localhost:${PORT}`);
  });
} 

start();

