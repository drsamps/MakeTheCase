import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { testConnection } from './db.js';

// Import routes
import authRoutes from './routes/auth.js';
import modelsRoutes from './routes/models.js';
import sectionsRoutes from './routes/sections.js';
import studentsRoutes from './routes/students.js';
import evaluationsRoutes from './routes/evaluations.js';

// Load environment variables
dotenv.config({ path: '.env.local' });

const app = express();
const PORT = process.env.SERVER_PORT || 3001;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/models', modelsRoutes);
app.use('/api/sections', sectionsRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/evaluations', evaluationsRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Start server
async function start() {
  await testConnection();
  app.listen(PORT, () => {
    console.log(`✓ API server running on http://localhost:${PORT}`);
  });
}

start();

