import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { jsonrepair } from 'jsonrepair';
import { pool } from '../db.js';
import { verifyToken } from '../middleware/auth.js';
import { requireAdminOrInstructor } from '../middleware/instructorAccess.js';
import { getActivePrompt, renderPrompt } from '../services/promptService.js';
import { generateOutlineWithLLM } from '../services/llmRouter.js';
import { markdownToDocxBuffer, markdownToPdfBuffer } from '../services/markdownExport.js';
import { convertFile } from '../services/fileConverter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_FILES_DIR = path.join(__dirname, '..', '..', 'case_files');

const router = express.Router();

// ----------------------------------------------------------------------------
// LLM helpers
// ----------------------------------------------------------------------------

async function resolveModel(requestedModelId, projectDefaultModelId) {
  const candidate = requestedModelId || projectDefaultModelId || null;
  if (candidate) {
    const [rows] = await pool.execute(
      'SELECT model_id, vendor, temperature, reasoning_effort FROM models WHERE model_id = ? AND enabled = 1',
      [candidate]
    );
    if (rows.length === 0) {
      throw new Error(`Model not found or disabled: ${candidate}`);
    }
    return rows[0];
  }
  const [rows] = await pool.execute(
    'SELECT model_id, vendor, temperature, reasoning_effort FROM models WHERE enabled = 1 ORDER BY model_id LIMIT 1'
  );
  if (rows.length === 0) {
    throw new Error('No enabled model available');
  }
  return rows[0];
}

function extractJsonObject(text) {
  if (!text) throw new Error('LLM returned empty response');
  let candidate = text.trim();
  const fence = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) candidate = fence[1].trim();
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    candidate = candidate.slice(first, last + 1);
  }
  try {
    return JSON.parse(candidate);
  } catch (strictErr) {
    try {
      return JSON.parse(jsonrepair(candidate));
    } catch (_repairErr) {
      throw strictErr;
    }
  }
}

// Strip an optional surrounding ```markdown / ``` fence the model sometimes adds
// despite being told not to. Leaves internal code blocks alone.
function stripMarkdownFence(text) {
  if (!text) return '';
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return fence ? fence[1].trim() : trimmed;
}

async function recordRevision(projectId, step, snapshot, userId) {
  await pool.execute(
    `INSERT INTO case_writer_revisions (project_id, step, snapshot, created_by) VALUES (?, ?, ?, ?)`,
    [projectId, step, JSON.stringify(snapshot), userId || null]
  );
}

// Build the {source_materials} variable from approved references on this project.
// Returns an empty string if there are no approved references, so prompts can
// gracefully handle the "no source material" case.
async function loadSourceMaterials(projectId) {
  const [rows] = await pool.execute(
    `SELECT r.reference_id, r.type, r.title, r.content_summary, r.source_notes
     FROM case_writer_references r
     WHERE r.project_id = ? AND r.approved_by_user = 1
     ORDER BY r.created_at ASC`,
    [projectId]
  );
  if (rows.length === 0) return '';

  const blocks = [];
  for (const r of rows) {
    let summaryText = '';
    if (r.content_summary) {
      try {
        const parsed = JSON.parse(r.content_summary);
        const facts = Array.isArray(parsed?.key_facts) ? parsed.key_facts : [];
        summaryText = [
          parsed?.summary || '',
          facts.length ? '\nKey facts:\n' + facts.map(f => `- ${f}`).join('\n') : ''
        ].filter(Boolean).join('\n');
      } catch {
        summaryText = String(r.content_summary);
      }
    }
    blocks.push(
      `### Source: ${r.title || '(untitled)'} (${r.type})`
      + (r.source_notes ? `\nNotes: ${r.source_notes}` : '')
      + (summaryText ? `\n\n${summaryText}` : '')
    );
  }
  return blocks.join('\n\n---\n\n');
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

const PROJECT_COLUMNS = [
  'project_id', 'owner_id', 'owner_type', 'title', 'status',
  'teaching_principle', 'audience', 'course_context', 'difficulty', 'case_type',
  'learning_brief', 'scenario_options', 'selected_scenario', 'case_blueprint',
  'student_case', 'teaching_note',
  'publish_protagonist', 'publish_chat_question',
  'publish_arguments_for', 'publish_arguments_against',
  'default_model_id',
  'published_case_id', 'created_at', 'updated_at'
];

const PATCHABLE_FIELDS = new Set([
  'title', 'status', 'teaching_principle', 'audience', 'course_context',
  'difficulty', 'case_type', 'learning_brief', 'scenario_options',
  'selected_scenario', 'case_blueprint', 'student_case', 'teaching_note',
  'publish_protagonist', 'publish_chat_question',
  'publish_arguments_for', 'publish_arguments_against',
  'default_model_id'
]);

// Step outputs that are stored as JSON (the scenarios picker and the single
// selected scenario object). Everything else is stored as a markdown string,
// which mysql2 still requires us to JSON.stringify into the JSON column.
const JSON_VALUED_FIELDS = new Set(['scenario_options', 'selected_scenario']);
const MARKDOWN_VALUED_FIELDS = new Set([
  'learning_brief', 'case_blueprint', 'student_case', 'teaching_note'
]);

function ok(res, data) {
  res.json({ data, error: null });
}

function fail(res, status, message) {
  res.status(status).json({ data: null, error: { message } });
}

function ownerScopeWhere(req) {
  if (req.user.role === 'admin') return { sql: '', params: [] };
  return {
    sql: ' WHERE owner_id = ? AND owner_type = ?',
    params: [req.user.id, 'instructor']
  };
}

async function loadProject(projectId, req) {
  const [rows] = await pool.execute(
    `SELECT ${PROJECT_COLUMNS.join(', ')} FROM case_writer_projects WHERE project_id = ?`,
    [projectId]
  );
  if (rows.length === 0) return { project: null, forbidden: false };
  const project = rows[0];
  if (req.user.role !== 'admin') {
    const isOwner = project.owner_id === req.user.id && project.owner_type === req.user.role;
    if (!isOwner) return { project: null, forbidden: true };
  }
  return { project, forbidden: false };
}

// After migration 043, the markdown columns (learning_brief, case_blueprint,
// student_case, teaching_note) are LONGTEXT and store plain markdown directly.
// Read them via `project.<field> || ''`. asJson() below is still used for the
// JSON columns (scenario_options, selected_scenario) and for the revise handler.
function asJson(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

// All Case Writer endpoints require an authenticated admin or instructor.
router.use(verifyToken, requireAdminOrInstructor);

// ----------------------------------------------------------------------------
// Project CRUD
// ----------------------------------------------------------------------------

router.get('/projects', async (req, res) => {
  try {
    const { status } = req.query;
    const scope = ownerScopeWhere(req);
    let sql =
      `SELECT project_id, owner_id, owner_type, title, status, teaching_principle,
              audience, course_context, difficulty, case_type, published_case_id,
              default_model_id, created_at, updated_at
       FROM case_writer_projects` + scope.sql;
    const params = [...scope.params];
    if (status) {
      sql += scope.sql ? ' AND status = ?' : ' WHERE status = ?';
      params.push(status);
    }
    sql += ' ORDER BY updated_at DESC';
    const [rows] = await pool.execute(sql, params);
    ok(res, rows);
  } catch (err) {
    console.error('[caseWriter] list projects error:', err);
    fail(res, 500, err.message);
  }
});

router.get('/projects/:id', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');
    ok(res, project);
  } catch (err) {
    console.error('[caseWriter] get project error:', err);
    fail(res, 500, err.message);
  }
});

router.post('/projects', async (req, res) => {
  try {
    const { title, teaching_principle, default_model_id } = req.body || {};
    const projectId = uuidv4();
    await pool.execute(
      `INSERT INTO case_writer_projects
         (project_id, owner_id, owner_type, title, status, teaching_principle, default_model_id)
       VALUES (?, ?, ?, ?, 'draft', ?, ?)`,
      [
        projectId,
        req.user.id,
        req.user.role,
        title || null,
        teaching_principle || null,
        default_model_id || null
      ]
    );
    const [rows] = await pool.execute(
      `SELECT ${PROJECT_COLUMNS.join(', ')} FROM case_writer_projects WHERE project_id = ?`,
      [projectId]
    );
    ok(res, rows[0]);
  } catch (err) {
    console.error('[caseWriter] create project error:', err);
    fail(res, 500, err.message);
  }
});

router.patch('/projects/:id', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const sets = [];
    const params = [];
    for (const [key, value] of Object.entries(req.body || {})) {
      if (!PATCHABLE_FIELDS.has(key)) continue;
      sets.push(`${key} = ?`);
      if (JSON_VALUED_FIELDS.has(key) || MARKDOWN_VALUED_FIELDS.has(key)) {
        params.push(JSON.stringify(value));
      } else {
        params.push(value);
      }
    }
    if (sets.length === 0) return fail(res, 400, 'No patchable fields provided');

    params.push(req.params.id);
    await pool.execute(
      `UPDATE case_writer_projects SET ${sets.join(', ')} WHERE project_id = ?`,
      params
    );

    const [rows] = await pool.execute(
      `SELECT ${PROJECT_COLUMNS.join(', ')} FROM case_writer_projects WHERE project_id = ?`,
      [req.params.id]
    );
    ok(res, rows[0]);
  } catch (err) {
    console.error('[caseWriter] update project error:', err);
    fail(res, 500, err.message);
  }
});

router.delete('/projects/:id', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');
    await pool.execute('DELETE FROM case_writer_projects WHERE project_id = ?', [req.params.id]);
    ok(res, { project_id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[caseWriter] delete project error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// References
// ----------------------------------------------------------------------------

router.get('/projects/:id/references', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');
    const [rows] = await pool.execute(
      `SELECT reference_id, project_id, type, title, content_summary, approved_by_user,
              source_notes, link_url, case_file_id, created_at, updated_at
       FROM case_writer_references WHERE project_id = ? ORDER BY created_at ASC`,
      [req.params.id]
    );
    ok(res, rows);
  } catch (err) {
    console.error('[caseWriter] list references error:', err);
    fail(res, 500, err.message);
  }
});

router.post('/projects/:id/references', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const { type, title, content, link_url, source_notes } = req.body || {};
    if (!['pasted_text', 'link', 'saved_framework'].includes(type)) {
      return fail(res, 400, 'type must be pasted_text, link, or saved_framework (file uploads use a separate endpoint)');
    }

    const referenceId = uuidv4();
    await pool.execute(
      `INSERT INTO case_writer_references
         (reference_id, project_id, type, title, content, link_url, source_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        referenceId,
        req.params.id,
        type,
        title || null,
        content || null,
        link_url || null,
        source_notes || null
      ]
    );

    const [rows] = await pool.execute(
      `SELECT reference_id, project_id, type, title, content_summary, approved_by_user,
              source_notes, link_url, case_file_id, created_at, updated_at
       FROM case_writer_references WHERE reference_id = ?`,
      [referenceId]
    );
    ok(res, rows[0]);
  } catch (err) {
    console.error('[caseWriter] create reference error:', err);
    fail(res, 500, err.message);
  }
});

router.patch('/projects/:id/references/:refId', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const allowed = ['title', 'content', 'content_summary', 'approved_by_user', 'source_notes', 'link_url'];
    const sets = [];
    const params = [];
    for (const [key, value] of Object.entries(req.body || {})) {
      if (!allowed.includes(key)) continue;
      sets.push(`${key} = ?`);
      params.push(key === 'approved_by_user' ? (value ? 1 : 0) : value);
    }
    if (sets.length === 0) return fail(res, 400, 'No patchable fields provided');

    params.push(req.params.refId, req.params.id);
    const [result] = await pool.execute(
      `UPDATE case_writer_references SET ${sets.join(', ')}
       WHERE reference_id = ? AND project_id = ?`,
      params
    );
    if (result.affectedRows === 0) return fail(res, 404, 'Reference not found');

    const [rows] = await pool.execute(
      `SELECT reference_id, project_id, type, title, content_summary, approved_by_user,
              source_notes, link_url, case_file_id, created_at, updated_at
       FROM case_writer_references WHERE reference_id = ?`,
      [req.params.refId]
    );
    ok(res, rows[0]);
  } catch (err) {
    console.error('[caseWriter] update reference error:', err);
    fail(res, 500, err.message);
  }
});

router.delete('/projects/:id/references/:refId', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');
    const [result] = await pool.execute(
      'DELETE FROM case_writer_references WHERE reference_id = ? AND project_id = ?',
      [req.params.refId, req.params.id]
    );
    if (result.affectedRows === 0) return fail(res, 404, 'Reference not found');
    ok(res, { reference_id: req.params.refId, deleted: true });
  } catch (err) {
    console.error('[caseWriter] delete reference error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Reference file upload (multipart)
// ----------------------------------------------------------------------------

const referenceUploadStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const projectId = req.params.id;
    const dir = path.join(CASE_FILES_DIR, `cw-${projectId}`, 'uploads');
    try {
      await fs.mkdir(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext);
    cb(null, `${basename}-${timestamp}${ext}`);
  }
});

const referenceUpload = multer({
  storage: referenceUploadStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.doc', '.md', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Unsupported file type. Allowed: PDF, DOCX, DOC, MD, TXT'));
  }
});

// Project-less upload for extract-principles: store to a shared temp dir.
const principleUploadStorage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const dir = path.join(CASE_FILES_DIR, '_cw-tmp');
    try {
      await fs.mkdir(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext);
    cb(null, `${basename}-${timestamp}${ext}`);
  }
});
const principleUpload = multer({
  storage: principleUploadStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.doc', '.md', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Unsupported file type. Allowed: PDF, DOCX, DOC, MD, TXT'));
  }
});

router.post('/projects/:id/references/upload',
  (req, res, next) => {
    referenceUpload.single('file')(req, res, (err) => {
      if (err) return fail(res, 400, err.message);
      next();
    });
  },
  async (req, res) => {
    try {
      const { project, forbidden } = await loadProject(req.params.id, req);
      if (forbidden) return fail(res, 403, 'Not authorized to access this project');
      if (!project) return fail(res, 404, 'Project not found');
      if (!req.file) return fail(res, 400, 'No file uploaded');

      const extWithDot = path.extname(req.file.originalname).toLowerCase();
      let convertedText = '';
      try {
        const result = await convertFile(req.file.path, extWithDot);
        convertedText = result?.text || '';
      } catch (err) {
        console.error('[caseWriter] reference upload convertFile failed:', err);
        return fail(res, 422, `Could not extract text from file: ${err.message}`);
      }

      const referenceId = uuidv4();
      const { title, source_notes } = req.body || {};
      const noteParts = [];
      if (source_notes) noteParts.push(source_notes);
      noteParts.push(`Uploaded file: ${req.file.originalname} (${req.file.size} bytes)`);
      await pool.execute(
        `INSERT INTO case_writer_references
           (reference_id, project_id, type, title, content, source_notes)
         VALUES (?, ?, 'uploaded_file', ?, ?, ?)`,
        [
          referenceId,
          req.params.id,
          title || req.file.originalname,
          convertedText,
          noteParts.join('\n')
        ]
      );

      const [rows] = await pool.execute(
        `SELECT reference_id, project_id, type, title, content_summary, approved_by_user,
                source_notes, link_url, case_file_id, created_at, updated_at
         FROM case_writer_references WHERE reference_id = ?`,
        [referenceId]
      );
      ok(res, rows[0]);
    } catch (err) {
      console.error('[caseWriter] reference upload error:', err);
      fail(res, 500, err.message);
    }
  }
);

// ----------------------------------------------------------------------------
// Revisions — read-only listing
// ----------------------------------------------------------------------------

router.get('/projects/:id/revisions', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const { step } = req.query;
    let sql =
      `SELECT revision_id, project_id, step, snapshot, created_by, created_at
       FROM case_writer_revisions WHERE project_id = ?`;
    const params = [req.params.id];
    if (step) {
      sql += ' AND step = ?';
      params.push(step);
    }
    sql += ' ORDER BY created_at DESC';
    const [rows] = await pool.execute(sql, params);
    ok(res, rows);
  } catch (err) {
    console.error('[caseWriter] list revisions error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Generation: teaching brief (markdown)
// ----------------------------------------------------------------------------

router.post('/projects/:id/generate/brief', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    if (!project.teaching_principle || !project.teaching_principle.trim()) {
      return fail(res, 400, 'Project is missing a teaching_principle');
    }

    const { model_id: requestedModelId } = req.body || {};

    if (project.learning_brief) {
      await recordRevision(req.params.id, 'brief', (project.learning_brief || ''), req.user.id);
    }

    const sourceMaterials = await loadSourceMaterials(req.params.id);
    const activePrompt = await getActivePrompt('case_writer.teaching_brief');
    const renderedPrompt = renderPrompt(activePrompt.prompt_template, {
      teaching_principle: project.teaching_principle || '',
      audience: project.audience || '',
      course_context: project.course_context || '',
      difficulty: project.difficulty || '',
      case_type: project.case_type || '',
      source_materials: sourceMaterials
    });

    const model = await resolveModel(requestedModelId, project.default_model_id);
    const { text, meta } = await generateOutlineWithLLM({
      modelId: model.model_id,
      vendor: model.vendor,
      prompt: renderedPrompt,
      config: {
        temperature: model.temperature,
        reasoning_effort: model.reasoning_effort,
        maxTokens: 32000
      }
    });

    const markdown = stripMarkdownFence(text);
    if (!markdown) return fail(res, 502, 'LLM returned an empty response');

    await pool.execute(
      'UPDATE case_writer_projects SET learning_brief = ? WHERE project_id = ?',
      [markdown, req.params.id]
    );

    ok(res, {
      markdown,
      meta: {
        model_id: model.model_id,
        vendor: model.vendor,
        prompt_version: activePrompt.version,
        provider: meta?.provider || null
      }
    });
  } catch (err) {
    console.error('[caseWriter] generate brief error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Generation: scenario alternatives (JSON wrapper, markdown bodies)
// ----------------------------------------------------------------------------

router.post('/projects/:id/generate/scenarios', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    if (!project.learning_brief) {
      return fail(res, 400, 'Project must have an approved learning_brief before generating scenarios');
    }

    const {
      model_id: requestedModelId,
      count: requestedCount,
      industry_preference,
      revision_hint
    } = req.body || {};

    let count = Number.parseInt(requestedCount, 10);
    if (!Number.isFinite(count)) count = 4;
    count = Math.max(3, Math.min(5, count));

    if (project.scenario_options) {
      await recordRevision(req.params.id, 'scenarios', asJson(project.scenario_options), req.user.id);
    }

    const sourceMaterials = await loadSourceMaterials(req.params.id);
    const activePrompt = await getActivePrompt('case_writer.scenario_generation');
    const renderedPrompt = renderPrompt(activePrompt.prompt_template, {
      learning_brief: (project.learning_brief || ''),
      source_materials: sourceMaterials,
      count: String(count),
      industry_preference: industry_preference || '',
      revision_hint: revision_hint || ''
    });

    const model = await resolveModel(requestedModelId, project.default_model_id);
    const { text, meta } = await generateOutlineWithLLM({
      modelId: model.model_id,
      vendor: model.vendor,
      prompt: renderedPrompt,
      config: {
        temperature: model.temperature,
        reasoning_effort: model.reasoning_effort,
        maxTokens: 32000
      }
    });

    let parsed;
    try {
      parsed = extractJsonObject(text);
    } catch (parseErr) {
      console.error('[caseWriter] scenarios JSON parse failed:', parseErr.message, 'raw:', text?.slice(0, 500));
      return fail(res, 502, `LLM returned non-JSON response: ${parseErr.message}`);
    }

    const scenarios = Array.isArray(parsed?.scenarios) ? parsed.scenarios : null;
    if (!scenarios || scenarios.length === 0) {
      return fail(res, 502, 'LLM response missing scenarios array');
    }

    await pool.execute(
      'UPDATE case_writer_projects SET scenario_options = ? WHERE project_id = ?',
      [JSON.stringify(scenarios), req.params.id]
    );

    ok(res, {
      scenarios,
      meta: {
        model_id: model.model_id,
        vendor: model.vendor,
        prompt_version: activePrompt.version,
        provider: meta?.provider || null,
        requested_count: count,
        returned_count: scenarios.length
      }
    });
  } catch (err) {
    console.error('[caseWriter] generate scenarios error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Generation: case blueprint (markdown)
// ----------------------------------------------------------------------------

router.post('/projects/:id/generate/blueprint', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    if (!project.learning_brief) {
      return fail(res, 400, 'Project must have an approved learning_brief before generating a blueprint');
    }
    if (!project.selected_scenario) {
      return fail(res, 400, 'Project must have a selected_scenario before generating a blueprint');
    }

    const { model_id: requestedModelId, revision_hint } = req.body || {};

    if (project.case_blueprint) {
      await recordRevision(req.params.id, 'blueprint', (project.case_blueprint || ''), req.user.id);
    }

    const selected = asJson(project.selected_scenario) || {};
    const selectedScenarioText = [
      selected.title ? `Title: ${selected.title}` : '',
      selected.industry ? `Industry: ${selected.industry}` : '',
      selected.markdown || ''
    ].filter(Boolean).join('\n\n');

    const sourceMaterials = await loadSourceMaterials(req.params.id);
    const activePrompt = await getActivePrompt('case_writer.case_blueprint');
    const renderedPrompt = renderPrompt(activePrompt.prompt_template, {
      learning_brief: (project.learning_brief || ''),
      selected_scenario: selectedScenarioText,
      source_materials: sourceMaterials,
      revision_hint: revision_hint || ''
    });

    const model = await resolveModel(requestedModelId, project.default_model_id);
    const { text, meta } = await generateOutlineWithLLM({
      modelId: model.model_id,
      vendor: model.vendor,
      prompt: renderedPrompt,
      config: {
        temperature: model.temperature,
        reasoning_effort: model.reasoning_effort,
        maxTokens: 32000
      }
    });

    const markdown = stripMarkdownFence(text);
    if (!markdown) return fail(res, 502, 'LLM returned an empty response');

    await pool.execute(
      'UPDATE case_writer_projects SET case_blueprint = ? WHERE project_id = ?',
      [markdown, req.params.id]
    );

    ok(res, {
      markdown,
      meta: {
        model_id: model.model_id,
        vendor: model.vendor,
        prompt_version: activePrompt.version,
        provider: meta?.provider || null
      }
    });
  } catch (err) {
    console.error('[caseWriter] generate blueprint error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Generation: student-facing case draft (markdown)
// ----------------------------------------------------------------------------

const LENGTH_PRESETS = {
  mini:     'Mini case, about 500 to 1000 words',
  standard: 'Standard case, about 2000 to 4000 words',
  extended: 'Extended case, about 4000 to 7500 words'
};

router.post('/projects/:id/generate/student-case', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    if (!project.learning_brief) {
      return fail(res, 400, 'Project must have an approved learning_brief before generating the student case');
    }
    if (!project.case_blueprint) {
      return fail(res, 400, 'Project must have an approved case_blueprint before generating the student case');
    }

    const { model_id: requestedModelId, length, revision_hint } = req.body || {};
    const lengthKey = LENGTH_PRESETS[length] ? length : 'standard';
    const lengthTarget = LENGTH_PRESETS[lengthKey];

    if (project.student_case) {
      await recordRevision(req.params.id, 'student_case', (project.student_case || ''), req.user.id);
    }

    const sourceMaterials = await loadSourceMaterials(req.params.id);
    const activePrompt = await getActivePrompt('case_writer.student_case_draft');
    const renderedPrompt = renderPrompt(activePrompt.prompt_template, {
      learning_brief: (project.learning_brief || ''),
      case_blueprint: (project.case_blueprint || ''),
      source_materials: sourceMaterials,
      revision_hint: revision_hint || '',
      length_target: lengthTarget
    });

    const model = await resolveModel(requestedModelId, project.default_model_id);
    const { text, meta } = await generateOutlineWithLLM({
      modelId: model.model_id,
      vendor: model.vendor,
      prompt: renderedPrompt,
      config: {
        temperature: model.temperature,
        reasoning_effort: model.reasoning_effort,
        // Student cases can run thousands of words; default per-provider caps
        // silently truncate (this was the "Student Case Generate returns nothing"
        // bug in V1).
        maxTokens: 32000
      }
    });

    const markdown = stripMarkdownFence(text);
    if (!markdown) return fail(res, 502, 'LLM returned an empty response');

    await pool.execute(
      'UPDATE case_writer_projects SET student_case = ? WHERE project_id = ?',
      [markdown, req.params.id]
    );

    ok(res, {
      markdown,
      meta: {
        model_id: model.model_id,
        vendor: model.vendor,
        prompt_version: activePrompt.version,
        provider: meta?.provider || null,
        length: lengthKey
      }
    });
  } catch (err) {
    console.error('[caseWriter] generate student case error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Generation: instructor-only teaching note (markdown)
// ----------------------------------------------------------------------------

const TEACHING_NOTE_FORMATS = {
  brief:    '1 to 2 pages',
  standard: '4 to 6 pages',
  detailed: 'Full instructor guide, 8 or more pages'
};

router.post('/projects/:id/generate/teaching-note', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    if (!project.learning_brief) return fail(res, 400, 'Project must have an approved learning_brief before generating the teaching note');
    if (!project.case_blueprint) return fail(res, 400, 'Project must have an approved case_blueprint before generating the teaching note');
    if (!project.student_case)   return fail(res, 400, 'Project must have a student_case draft before generating the teaching note');

    const { model_id: requestedModelId, format, revision_hint } = req.body || {};
    const formatKey = TEACHING_NOTE_FORMATS[format] ? format : 'standard';
    const formatTarget = TEACHING_NOTE_FORMATS[formatKey];

    if (project.teaching_note) {
      await recordRevision(req.params.id, 'teaching_note', (project.teaching_note || ''), req.user.id);
    }

    const sourceMaterials = await loadSourceMaterials(req.params.id);
    const activePrompt = await getActivePrompt('case_writer.teaching_note');
    const renderedPrompt = renderPrompt(activePrompt.prompt_template, {
      learning_brief: (project.learning_brief || ''),
      case_blueprint: (project.case_blueprint || ''),
      student_case_markdown: (project.student_case || ''),
      source_materials: sourceMaterials,
      format_target: formatTarget,
      revision_hint: revision_hint || ''
    });

    const model = await resolveModel(requestedModelId, project.default_model_id);
    const { text, meta } = await generateOutlineWithLLM({
      modelId: model.model_id,
      vendor: model.vendor,
      prompt: renderedPrompt,
      config: {
        temperature: model.temperature,
        reasoning_effort: model.reasoning_effort,
        maxTokens: 32000
      }
    });

    const markdown = stripMarkdownFence(text);
    if (!markdown) return fail(res, 502, 'LLM returned an empty response');

    await pool.execute(
      'UPDATE case_writer_projects SET teaching_note = ? WHERE project_id = ?',
      [markdown, req.params.id]
    );

    ok(res, {
      markdown,
      meta: {
        model_id: model.model_id,
        vendor: model.vendor,
        prompt_version: activePrompt.version,
        provider: meta?.provider || null,
        format: formatKey
      }
    });
  } catch (err) {
    console.error('[caseWriter] generate teaching note error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Boundary validation
// ----------------------------------------------------------------------------

async function runBoundaryValidation(project, requestedModelId) {
  const studentCaseMarkdown = (project.student_case || '');

  const activePrompt = await getActivePrompt('case_writer.boundary_validation');
  const renderedPrompt = renderPrompt(activePrompt.prompt_template, {
    student_case_markdown: studentCaseMarkdown
  });

  const model = await resolveModel(requestedModelId, project.default_model_id);
  const { text, meta } = await generateOutlineWithLLM({
    modelId: model.model_id,
    vendor: model.vendor,
    prompt: renderedPrompt,
    config: {
      temperature: model.temperature,
      reasoning_effort: model.reasoning_effort
    }
  });

  const parsed = extractJsonObject(text);
  const violations = Array.isArray(parsed?.violations) ? parsed.violations : [];
  const passes = violations.length === 0 && parsed?.passes !== false;
  return {
    passes,
    summary: parsed?.summary || '',
    violations,
    meta: {
      model_id: model.model_id,
      vendor: model.vendor,
      prompt_version: activePrompt.version,
      provider: meta?.provider || null
    }
  };
}

router.post('/projects/:id/validate', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    if (!project.student_case) {
      return fail(res, 400, 'Project must have a student_case before validation');
    }

    const result = await runBoundaryValidation(project, req.body?.model_id);
    ok(res, result);
  } catch (err) {
    console.error('[caseWriter] validate error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Publish-field extraction (auto-fill the structured publish form)
// ----------------------------------------------------------------------------

router.post('/projects/:id/extract-publish-fields', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    if (!project.student_case)  return fail(res, 400, 'Project must have a student_case before extracting publish fields');
    if (!project.teaching_note) return fail(res, 400, 'Project must have a teaching_note before extracting publish fields');

    const activePrompt = await getActivePrompt('case_writer.publish_field_extraction');
    const renderedPrompt = renderPrompt(activePrompt.prompt_template, {
      student_case_markdown: (project.student_case || ''),
      teaching_note_markdown: (project.teaching_note || '')
    });

    const model = await resolveModel(req.body?.model_id, project.default_model_id);
    const { text, meta } = await generateOutlineWithLLM({
      modelId: model.model_id,
      vendor: model.vendor,
      prompt: renderedPrompt,
      config: {
        temperature: model.temperature,
        reasoning_effort: model.reasoning_effort,
        maxTokens: 8000
      }
    });

    let parsed;
    try {
      parsed = extractJsonObject(text);
    } catch (parseErr) {
      return fail(res, 502, `LLM returned non-JSON response: ${parseErr.message}`);
    }

    ok(res, {
      protagonist: parsed?.protagonist || '',
      chat_question: parsed?.chat_question || '',
      arguments_for: parsed?.arguments_for || '',
      arguments_against: parsed?.arguments_against || '',
      meta: {
        model_id: model.model_id,
        vendor: model.vendor,
        prompt_version: activePrompt.version,
        provider: meta?.provider || null
      }
    });
  } catch (err) {
    console.error('[caseWriter] extract publish fields error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Principle extraction (project-less; takes raw text or an uploaded file id)
// ----------------------------------------------------------------------------

router.post('/extract-principles',
  (req, res, next) => {
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('multipart/form-data')) return next();
    principleUpload.single('file')(req, res, (err) => {
      if (err) return fail(res, 400, err.message);
      next();
    });
  },
  async (req, res) => {
  try {
    const { title, type, content, case_file_id, model_id } = req.body || {};

    let sourceContent = content || '';
    let sourceTitle = title || '';
    let sourceType = type || 'pasted_text';
    if (req.file) {
      const extWithDot = path.extname(req.file.originalname).toLowerCase();
      try {
        const result = await convertFile(req.file.path, extWithDot);
        sourceContent = result?.text || '';
        sourceTitle = sourceTitle || req.file.originalname;
        sourceType = 'uploaded_file';
      } catch (err) {
        return fail(res, 422, `Could not extract text from file: ${err.message}`);
      } finally {
        // best-effort cleanup of the temp file
        fs.unlink(req.file.path).catch(() => {});
      }
    } else if (!sourceContent && case_file_id) {
      const [rows] = await pool.execute(
        'SELECT converted_text FROM case_files WHERE id = ?',
        [case_file_id]
      );
      if (rows.length === 0) return fail(res, 404, 'case_file not found');
      sourceContent = rows[0].converted_text || '';
    }
    if (!sourceContent.trim()) {
      return fail(res, 400, 'No source content provided (need content, file, or case_file_id)');
    }

    const activePrompt = await getActivePrompt('case_writer.principle_extraction');
    const renderedPrompt = renderPrompt(activePrompt.prompt_template, {
      title: sourceTitle,
      type: sourceType,
      content: sourceContent
    });

    const model = await resolveModel(model_id);
    const { text, meta } = await generateOutlineWithLLM({
      modelId: model.model_id,
      vendor: model.vendor,
      prompt: renderedPrompt,
      config: {
        temperature: model.temperature,
        reasoning_effort: model.reasoning_effort,
        maxTokens: 8000
      }
    });

    let parsed;
    try {
      parsed = extractJsonObject(text);
    } catch (parseErr) {
      return fail(res, 502, `LLM returned non-JSON response: ${parseErr.message}`);
    }

    const principles = Array.isArray(parsed?.principles) ? parsed.principles : [];
    ok(res, {
      principles,
      meta: {
        model_id: model.model_id,
        vendor: model.vendor,
        prompt_version: activePrompt.version,
        provider: meta?.provider || null
      }
    });
  } catch (err) {
    console.error('[caseWriter] extract principles error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Publish: materialize the project into cases / case_scenarios / case_files
// ----------------------------------------------------------------------------

function slugifyTitle(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'case';
}

async function generateUniqueCaseId(baseSlug) {
  const [existing] = await pool.execute(
    'SELECT case_id FROM cases WHERE case_id = ? OR case_id LIKE ?',
    [baseSlug, `${baseSlug}-%`]
  );
  if (existing.length === 0) return baseSlug;
  const taken = new Set(existing.map(r => r.case_id));
  for (let i = 2; i < 1000; i++) {
    const candidate = `${baseSlug}-${i}`.slice(0, 30);
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Could not generate a unique case_id from base '${baseSlug}'`);
}

function deriveInitials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  const letters = parts.map(p => p[0]?.toUpperCase() || '').join('');
  return letters.slice(0, 5) || '?';
}

// Extract the first H1 heading text from a markdown document, if any.
function extractFirstHeading(markdown) {
  if (!markdown) return '';
  const m = String(markdown).match(/^\s*#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : '';
}

router.post('/projects/:id/publish', async (req, res) => {
  let createdCaseId = null;
  let createdCaseDir = null;
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    if (project.published_case_id) {
      return fail(res, 409, `Project already published as case '${project.published_case_id}'`);
    }

    if (!project.student_case)  return fail(res, 400, 'student_case is required to publish');
    if (!project.teaching_note) return fail(res, 400, 'teaching_note is required to publish');
    if (!project.publish_protagonist?.trim()) return fail(res, 400, 'publish_protagonist is required (set it in the Publish setup form)');
    if (!project.publish_chat_question?.trim()) return fail(res, 400, 'publish_chat_question is required (set it in the Publish setup form)');

    const caseMarkdown = (project.student_case || '');
    const teachingNoteMarkdown = (project.teaching_note || '');

    const skipValidation = req.body?.skip_validation === true;
    let validation = null;
    if (!skipValidation) {
      validation = await runBoundaryValidation(project, req.body?.validation_model_id);
      if (!validation.passes) {
        return res.status(422).json({
          data: null,
          error: { message: 'Boundary validation failed; cannot publish', validation }
        });
      }
    }

    const caseTitle =
      project.title
      || extractFirstHeading(caseMarkdown)
      || 'Untitled Case';
    const baseSlug = slugifyTitle(project.title || caseTitle);
    const caseId = await generateUniqueCaseId(baseSlug);

    await pool.execute(
      `INSERT INTO cases (case_id, case_title, case_version, enabled, created_by_type, created_by)
       VALUES (?, ?, ?, 1, ?, ?)`,
      [caseId, caseTitle.slice(0, 100), 'v1', project.owner_type, project.owner_id]
    );
    createdCaseId = caseId;

    const protagonistName = project.publish_protagonist.trim();
    const chatQuestion = project.publish_chat_question.trim();
    const argsFor = project.publish_arguments_for?.trim() || null;
    const argsAgainst = project.publish_arguments_against?.trim() || null;

    await pool.execute(
      `INSERT INTO case_scenarios
         (case_id, scenario_name, protagonist, protagonist_initials, protagonist_role,
          chat_topic, chat_question, arguments_for, arguments_against, sort_order, enabled)
       VALUES (?, 'Default Scenario', ?, ?, ?, ?, ?, ?, ?, 0, 1)`,
      [
        caseId,
        protagonistName.slice(0, 100),
        deriveInitials(protagonistName),
        '',
        null,
        chatQuestion,
        argsFor,
        argsAgainst
      ]
    );

    const caseDir = path.join(CASE_FILES_DIR, caseId);
    await fs.mkdir(caseDir, { recursive: true });
    createdCaseDir = caseDir;
    const caseFilename = 'case.md';
    const noteFilename = 'teaching_note.md';
    const caseFilePath = path.join(caseDir, caseFilename);
    const noteFilePath = path.join(caseDir, noteFilename);
    await fs.writeFile(caseFilePath, caseMarkdown, 'utf8');
    await fs.writeFile(noteFilePath, teachingNoteMarkdown, 'utf8');

    const caseStats = await fs.stat(caseFilePath);
    const noteStats = await fs.stat(noteFilePath);

    await pool.execute(
      `INSERT INTO case_files
         (case_id, filename, file_type, file_format, file_source, original_filename,
          file_size, processing_status, include_in_chat_prompt, prompt_order,
          converted_text, converted_at)
       VALUES (?, ?, 'case', 'md', 'case_writer', ?, ?, 'completed', 1, 0, ?, NOW())`,
      [caseId, caseFilename, caseFilename, caseStats.size, caseMarkdown]
    );
    await pool.execute(
      `INSERT INTO case_files
         (case_id, filename, file_type, file_format, file_source, original_filename,
          file_size, processing_status, include_in_chat_prompt, prompt_order,
          converted_text, converted_at)
       VALUES (?, ?, 'teaching_note', 'md', 'case_writer', ?, ?, 'completed', 1, 1, ?, NOW())`,
      [caseId, noteFilename, noteFilename, noteStats.size, teachingNoteMarkdown]
    );

    await pool.execute(
      `UPDATE case_writer_projects
         SET status = 'published', published_case_id = ?, title = COALESCE(title, ?)
       WHERE project_id = ?`,
      [caseId, caseTitle, req.params.id]
    );

    ok(res, {
      case_id: caseId,
      case_title: caseTitle,
      validation,
      files: [caseFilename, noteFilename]
    });
  } catch (err) {
    console.error('[caseWriter] publish error:', err);
    if (createdCaseId) {
      try { await pool.execute('DELETE FROM case_files WHERE case_id = ?', [createdCaseId]); } catch {}
      try { await pool.execute('DELETE FROM case_scenarios WHERE case_id = ?', [createdCaseId]); } catch {}
      try { await pool.execute('DELETE FROM cases WHERE case_id = ?', [createdCaseId]); } catch {}
    }
    if (createdCaseDir) {
      try { await fs.rm(createdCaseDir, { recursive: true, force: true }); } catch {}
    }
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Reference summarization (unchanged shape; output is still JSON)
// ----------------------------------------------------------------------------

router.post('/projects/:id/references/:refId/summarize', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const [refRows] = await pool.execute(
      `SELECT r.reference_id, r.project_id, r.type, r.title, r.content, r.source_notes,
              r.case_file_id, cf.converted_text AS file_text
       FROM case_writer_references r
       LEFT JOIN case_files cf ON cf.id = r.case_file_id
       WHERE r.reference_id = ? AND r.project_id = ?`,
      [req.params.refId, req.params.id]
    );
    if (refRows.length === 0) return fail(res, 404, 'Reference not found');
    const ref = refRows[0];

    let sourceText = '';
    if (ref.type === 'pasted_text') sourceText = ref.content || '';
    else if (ref.type === 'uploaded_file') sourceText = ref.content || ref.file_text || '';
    else if (ref.type === 'saved_framework') sourceText = ref.content || '';
    else if (ref.type === 'link') {
      return fail(res, 400, 'Link references are not yet supported by summarization (V2)');
    }

    if (!sourceText.trim()) {
      return fail(res, 400, 'Reference has no readable content to summarize');
    }

    const activePrompt = await getActivePrompt('case_writer.reference_summary');
    const renderedPrompt = renderPrompt(activePrompt.prompt_template, {
      title: ref.title || '',
      type: ref.type,
      source_notes: ref.source_notes || '',
      content: sourceText
    });

    const model = await resolveModel(req.body?.model_id, project.default_model_id);
    const { text, meta } = await generateOutlineWithLLM({
      modelId: model.model_id,
      vendor: model.vendor,
      prompt: renderedPrompt,
      config: {
        temperature: model.temperature,
        reasoning_effort: model.reasoning_effort
      }
    });

    let summary;
    try {
      summary = extractJsonObject(text);
    } catch (parseErr) {
      console.error('[caseWriter] summarize JSON parse failed:', parseErr.message, 'raw:', text?.slice(0, 500));
      return fail(res, 502, `LLM returned non-JSON response: ${parseErr.message}`);
    }

    if (!summary?.summary) {
      return fail(res, 502, 'LLM response missing summary field');
    }

    await pool.execute(
      `UPDATE case_writer_references
         SET content_summary = ?, approved_by_user = 0
       WHERE reference_id = ?`,
      [JSON.stringify(summary), req.params.refId]
    );

    ok(res, {
      reference_id: req.params.refId,
      summary,
      meta: {
        model_id: model.model_id,
        vendor: model.vendor,
        prompt_version: activePrompt.version,
        provider: meta?.provider || null
      }
    });
  } catch (err) {
    console.error('[caseWriter] summarize reference error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Section revision
// ----------------------------------------------------------------------------

const REVISE_STEP_TO_FIELD = {
  brief: 'learning_brief',
  scenarios: 'scenario_options',
  selected_scenario: 'selected_scenario',
  blueprint: 'case_blueprint',
  student_case: 'student_case',
  teaching_note: 'teaching_note'
};

// Output format per step. The revise prompt branches on this so the LLM knows
// whether to emit markdown or a specific JSON shape.
const REVISE_OUTPUT_FORMAT = {
  brief: 'markdown',
  scenarios: 'json_scenarios_array',
  selected_scenario: 'json_scenario_object',
  blueprint: 'markdown',
  student_case: 'markdown',
  teaching_note: 'markdown'
};

const REVISE_COMMANDS = new Set([
  'rewrite', 'shorten', 'expand', 'tighten', 'sharpen_decision',
  'add_ambiguity', 'harden_evidence', 'soften_tone', 'preserve_facts'
]);

router.post('/projects/:id/revise', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const { step, command, instruction, model_id: requestedModelId } = req.body || {};
    const field = REVISE_STEP_TO_FIELD[step];
    const outputFormat = REVISE_OUTPUT_FORMAT[step];
    if (!field || !outputFormat) {
      return fail(res, 400, `step must be one of: ${Object.keys(REVISE_STEP_TO_FIELD).join(', ')}`);
    }
    if (!command || !REVISE_COMMANDS.has(command)) {
      return fail(res, 400, `command must be one of: ${[...REVISE_COMMANDS].join(', ')}`);
    }

    const currentRaw = project[field];
    if (currentRaw === null || currentRaw === undefined) {
      return fail(res, 400, `Cannot revise ${step}: project has no value for this step yet`);
    }

    const isJsonStep = outputFormat.startsWith('json');
    const currentValueText = isJsonStep
      ? JSON.stringify(asJson(currentRaw), null, 2)
      : (currentRaw || '');

    await recordRevision(req.params.id, step, isJsonStep ? asJson(currentRaw) : (currentRaw || ''), req.user.id);

    const selectedForContext = asJson(project.selected_scenario);
    const selectedScenarioText = selectedForContext
      ? [
          selectedForContext.title ? `Title: ${selectedForContext.title}` : '',
          selectedForContext.industry ? `Industry: ${selectedForContext.industry}` : '',
          selectedForContext.markdown || ''
        ].filter(Boolean).join('\n\n')
      : '';

    const activePrompt = await getActivePrompt('case_writer.section_revision');
    const renderedPrompt = renderPrompt(activePrompt.prompt_template, {
      step,
      output_format: outputFormat,
      command,
      instruction: instruction || '',
      current_value: currentValueText,
      learning_brief: (project.learning_brief || ''),
      selected_scenario: selectedScenarioText,
      case_blueprint: (project.case_blueprint || ''),
      student_case_markdown: (project.student_case || '')
    });

    const model = await resolveModel(requestedModelId, project.default_model_id);
    const { text, meta } = await generateOutlineWithLLM({
      modelId: model.model_id,
      vendor: model.vendor,
      prompt: renderedPrompt,
      config: {
        temperature: model.temperature,
        reasoning_effort: model.reasoning_effort,
        maxTokens: 32000
      }
    });

    let revisedValueForStorage;
    let revisedForResponse;
    if (isJsonStep) {
      let parsed;
      try {
        parsed = extractJsonObject(text);
      } catch (parseErr) {
        return fail(res, 502, `LLM returned non-JSON response: ${parseErr.message}`);
      }
      if (outputFormat === 'json_scenarios_array') {
        const arr = Array.isArray(parsed?.scenarios) ? parsed.scenarios : null;
        if (!arr || arr.length === 0) return fail(res, 502, 'LLM response missing scenarios array');
        revisedValueForStorage = arr;
        revisedForResponse = { scenarios: arr };
      } else {
        revisedValueForStorage = parsed;
        revisedForResponse = parsed;
      }
    } else {
      const markdown = stripMarkdownFence(text);
      if (!markdown) return fail(res, 502, 'LLM returned an empty response');
      revisedValueForStorage = markdown;
      revisedForResponse = { markdown };
    }

    // Markdown columns (brief, blueprint, student_case, teaching_note) are
    // LONGTEXT after migration 043 — store the markdown string directly. JSON
    // columns (scenario_options, selected_scenario) still need JSON.stringify.
    const storedValue = isJsonStep
      ? JSON.stringify(revisedValueForStorage)
      : revisedValueForStorage;
    await pool.execute(
      `UPDATE case_writer_projects SET ${field} = ? WHERE project_id = ?`,
      [storedValue, req.params.id]
    );

    ok(res, {
      step,
      command,
      revised: revisedForResponse,
      meta: {
        model_id: model.model_id,
        vendor: model.vendor,
        prompt_version: activePrompt.version,
        provider: meta?.provider || null
      }
    });
  } catch (err) {
    console.error('[caseWriter] revise error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Export (md / docx / pdf, document = case | teaching_note | combined)
// ----------------------------------------------------------------------------

function sanitizeForFilename(s) {
  return String(s || 'case').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'case';
}

router.get('/projects/:id/export', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const format = String(req.query.format || 'md').toLowerCase();
    const docKind = String(req.query.doc || 'combined').toLowerCase();
    if (!['md', 'docx', 'pdf'].includes(format)) {
      return fail(res, 400, "format must be one of: md, docx, pdf");
    }
    if (!['case', 'teaching_note', 'combined'].includes(docKind)) {
      return fail(res, 400, "doc must be one of: case, teaching_note, combined");
    }

    const caseMd = (project.student_case || '');
    const noteMd = (project.teaching_note || '');

    if (docKind === 'case' && !caseMd) return fail(res, 400, 'Project has no student_case to export');
    if (docKind === 'teaching_note' && !noteMd) return fail(res, 400, 'Project has no teaching_note to export');
    if (docKind === 'combined' && !caseMd && !noteMd) return fail(res, 400, 'Project has nothing to export');

    let markdown;
    if (docKind === 'case') markdown = caseMd;
    else if (docKind === 'teaching_note') markdown = noteMd;
    else markdown = [caseMd, noteMd].filter(Boolean).join('\n\n---\n\n');

    const baseName = sanitizeForFilename(project.title || extractFirstHeading(caseMd));
    const suffix = docKind === 'combined' ? 'case-and-note' : (docKind === 'teaching_note' ? 'teaching-note' : 'case');
    const filenameBase = `${baseName}-${suffix}`;

    if (format === 'md') {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.md"`);
      return res.send(markdown);
    }

    if (format === 'docx') {
      const buf = await markdownToDocxBuffer(markdown);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.docx"`);
      return res.send(buf);
    }

    const buf = await markdownToPdfBuffer(markdown);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.pdf"`);
    return res.send(buf);
  } catch (err) {
    console.error('[caseWriter] export error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Stubs
// ----------------------------------------------------------------------------

const STUBS = [
  { method: 'post', path: '/projects/:id/generate/exhibit', name: 'generate exhibit' }
];

for (const stub of STUBS) {
  router[stub.method](stub.path, async (req, res) => {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');
    return fail(res, 501, `Not implemented yet: ${stub.name}`);
  });
}

export default router;
