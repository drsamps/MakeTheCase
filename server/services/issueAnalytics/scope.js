/**
 * Issue Analytics — who may see what, what a run covers, which model it uses, who pays,
 * and what it will cost. See docs/issue-analytics.md.
 */

import { pool } from '../../db.js';
import { getAccessibleSectionIds } from '../../middleware/instructorAccess.js';
import { getSetting } from '../promptService.js';
import { getWeeklyUsage } from '../usageGuard.js';
import { loadPrompt, loadRunContext, nameHints, prepareTranscript, sha256 } from './common.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Same rule as /api/analytics: null = unscoped admin, else the caller's section ids. */
export async function resolveScopedSectionIds(req) {
  const effectiveId = req.user.role === 'instructor'
    ? req.user.id
    : (req.user.role === 'admin' && req.effectiveInstructorId ? req.effectiveInstructorId : null);
  if (!effectiveId) return null;
  return await getAccessibleSectionIds(effectiveId);
}

/**
 * A run may be viewed (and curated) only by a caller who can see EVERY section in it.
 * A run that spans two instructors' sections holds quotes from both sets of students, so
 * seeing one of the sections is not enough.
 */
export async function assertCanViewRun(req, run) {
  const scoped = await resolveScopedSectionIds(req);
  if (scoped === null) return;
  const allowed = new Set(scoped);
  const sectionIds = parseJsonArray(run.section_ids);
  if (!sectionIds.every(id => allowed.has(id))) {
    throw new HttpError(404, 'Run not found');
  }
}

export function parseJsonArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseList(raw) {
  if (Array.isArray(raw)) return raw.map(String).map(s => s.trim()).filter(Boolean);
  if (raw == null || raw === '' || raw === 'all') return [];
  return String(raw).split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Resolve the concrete scope of a run from request input:
 *   { case_id, scenario_id?, section_ids?, semester_id? }
 * section_ids empty = every accessible section that has the case (narrowed by semester_id).
 * scenario_id is required when the case has more than one enabled scenario, because the
 * position-lean axis is defined per scenario.
 */
export async function resolveRunScope(req, input) {
  const caseId = String(input.case_id || '').trim();
  if (!caseId) throw new HttpError(400, 'case_id is required');

  const [scenarios] = await pool.execute(
    'SELECT id FROM case_scenarios WHERE case_id = ? AND enabled = TRUE ORDER BY sort_order, id',
    [caseId]
  );
  let scenarioId = input.scenario_id ? parseInt(input.scenario_id, 10) : null;
  const pinScenario = scenarioId !== null || scenarios.length > 1;
  if (scenarioId !== null && !scenarios.some(s => s.id === scenarioId)) {
    throw new HttpError(400, 'scenario_id is not an enabled scenario of this case');
  }
  if (scenarioId === null) {
    if (scenarios.length > 1) {
      throw new HttpError(400, `scenario_id is required: this case has ${scenarios.length} enabled scenarios, each with its own positions`);
    }
    scenarioId = scenarios[0]?.id ?? null;
  }

  const requested = parseList(input.section_ids);
  const semesterId = input.semester_id && input.semester_id !== 'all' ? parseInt(input.semester_id, 10) || null : null;
  const scoped = await resolveScopedSectionIds(req);
  if (scoped !== null && scoped.length === 0) throw new HttpError(403, 'You have no sections');

  let sql = `
    SELECT s.section_id
      FROM section_cases sc
      JOIN sections s ON s.section_id = sc.section_id
     WHERE sc.case_id = ? AND s.enabled = TRUE AND s.section_id <> 'none'`;
  const params = [caseId];
  if (scoped !== null) {
    sql += ` AND s.section_id IN (${scoped.map(() => '?').join(',')})`;
    params.push(...scoped);
  }
  if (requested.length > 0) {
    sql += ` AND s.section_id IN (${requested.map(() => '?').join(',')})`;
    params.push(...requested);
  } else if (semesterId) {
    sql += ' AND s.semester_id = ?';
    params.push(semesterId);
  }
  sql += ' ORDER BY s.section_id';
  const [rows] = await pool.execute(sql, params);
  const sectionIds = rows.map(r => r.section_id);
  if (sectionIds.length === 0) {
    throw new HttpError(400, 'None of the selected sections you can see has this case assigned');
  }
  // A section outside the caller's scope is refused, not silently dropped: a run is a
  // saved artifact, and its scope should be exactly what was asked for.
  if (requested.length > 0 && sectionIds.length !== new Set(requested).size) {
    const missing = requested.filter(id => !sectionIds.includes(id));
    throw new HttpError(400, `Not available for this case: ${missing.join(', ')}`);
  }

  return { caseId, scenarioId, pinScenario, sectionIds, semesterId, statuses: ['completed'] };
}

/** Completed chats in scope, with what is needed to analyse or skip each one. */
export async function loadScopeChats(scope) {
  const params = [scope.caseId, ...scope.sectionIds];
  let sql = `
    SELECT cc.id AS case_chat_id, cc.student_id, cc.section_id,
           st.full_name, st.first_name, st.last_name,
           cs.protagonist AS scenario_protagonist,
           t.transcript
      FROM case_chats cc
      JOIN students st ON st.id = cc.student_id
      LEFT JOIN case_scenarios cs ON cs.id = cc.scenario_id
      -- transcripts.case_chat_id is only a non-unique index and the upsert is SELECT-then-INSERT,
      -- so two rapid auto-saves can leave two rows. Pin the newest: a second row here would plan
      -- the same chat twice and blow up the (run_id, case_chat_id) primary key mid-transaction.
      LEFT JOIN transcripts t ON t.id = (SELECT t2.id FROM transcripts t2
                                          WHERE t2.case_chat_id = cc.id
                                          ORDER BY t2.created_at DESC, t2.id DESC LIMIT 1)
     WHERE cc.case_id = ?
       AND cc.section_id IN (${scope.sectionIds.map(() => '?').join(',')})
       AND cc.status = 'completed'`;
  if (scope.pinScenario) {
    sql += ' AND cc.scenario_id = ?';
    params.push(scope.scenarioId);
  }
  sql += ' ORDER BY cc.section_id, cc.end_time, cc.id';
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** Instructor allowed_vendors as an array, or null when unrestricted. */
async function allowedVendors(instructorId) {
  if (!instructorId) return null;
  const [rows] = await pool.execute('SELECT allowed_vendors FROM instructors WHERE id = ? LIMIT 1', [instructorId]);
  const raw = rows[0]?.allowed_vendors;
  const list = parseJsonArray(raw);
  return raw == null || list.length === 0 ? null : list;
}

/**
 * The model a run uses: explicit pick -> issue_analytics_model_id setting -> the #1 default
 * (models.default_model is a RANK; test = 1, never truthiness) -> first enabled model.
 */
export async function resolveModel(override, billedInstructorId) {
  const lookup = async (id) => {
    if (!id) return null;
    const [rows] = await pool.execute(
      'SELECT model_id, model_name, vendor, cpm_input, cpm_output FROM models WHERE model_id = ? AND enabled = 1',
      [id]
    );
    return rows[0] || null;
  };

  let model = null;
  if (override) {
    model = await lookup(override);
    if (!model) throw new HttpError(400, `Model ${override} is not available`);
  }
  if (!model) model = await lookup((await getSetting('issue_analytics_model_id')) || '');
  if (!model) {
    const [rows] = await pool.execute(
      'SELECT model_id, model_name, vendor, cpm_input, cpm_output FROM models WHERE default_model = 1 AND enabled = 1 LIMIT 1'
    );
    model = rows[0] || null;
  }
  if (!model) {
    const [rows] = await pool.execute(
      'SELECT model_id, model_name, vendor, cpm_input, cpm_output FROM models WHERE enabled = 1 ORDER BY model_name LIMIT 1'
    );
    model = rows[0] || null;
  }
  if (!model) throw new HttpError(400, 'No AI model is enabled');

  const vendors = await allowedVendors(billedInstructorId);
  if (vendors && !vendors.includes(model.vendor)) {
    throw new HttpError(400, `The billed instructor may not use ${model.vendor} models (${model.model_id}); pick another model`);
  }
  return model;
}

/**
 * Who pays. A run can span sections owned by different instructors, and
 * keyResolver.resolveInstructorForSection() is single-valued, so choose explicitly:
 *   1. the launching instructor, when they own (section primary or course owner) a section in scope
 *   2. the owner of the first in-scope section (by section_id): section primary, else course owner
 *   3. the launching instructor
 * The result is stored on the run and shown before launch. assertWithinCostCap() is a no-op
 * on a null id, so null is allowed only for an admin launching on sections nobody owns —
 * the same billing those sections' student chats already get (system key, no instructor cap).
 */
export async function resolveBilledInstructor(req, sectionIds) {
  const launcher = req.user.role === 'instructor' ? req.user.id : (req.effectiveInstructorId || null);
  const [rows] = await pool.execute(
    `SELECT s.section_id, COALESCE(s.primary_instructor_id, c.primary_instructor_id) AS owner_id,
            s.primary_instructor_id, c.primary_instructor_id AS course_owner_id
       FROM sections s
       LEFT JOIN courses c ON c.id = s.course_id
      WHERE s.section_id IN (${sectionIds.map(() => '?').join(',')})
      ORDER BY s.section_id`,
    sectionIds
  );
  if (launcher && rows.some(r => r.primary_instructor_id === launcher || r.course_owner_id === launcher)) {
    return launcher;
  }
  const first = rows.find(r => r.owner_id);
  if (first) return first.owner_id;
  if (launcher) return launcher;
  if (req.user.role === 'admin') return null;
  throw new HttpError(400, 'None of these sections has an instructor to bill the run to');
}

export async function instructorName(id) {
  if (!id) return null;
  const [rows] = await pool.execute('SELECT full_name, email FROM instructors WHERE id = ? LIMIT 1', [id]);
  return rows[0] ? (rows[0].full_name || rows[0].email) : null;
}

// Token estimates: ~4 characters per token. Output sizes include reasoning tokens, which
// dominate on reasoning models (measured on gpt-5-mini, 2026-09: ~1.3-2.3k per transcript,
// ~3k for clustering 6 transcripts), so they are set a little above what was observed.
const CHARS_PER_TOKEN = 4;
const EXTRACT_OUTPUT_TOKENS = 2000;
const CLUSTER_OUTPUT_TOKENS = 4000;
const RECORD_TOKENS = 35;
const ITEMS_PER_CHAT = 6;
const RESCAN_OUTPUT_TOKENS = 800;

function costOf(model, inputTokens, outputTokens) {
  const cin = model.cpm_input == null ? null : Number(model.cpm_input);
  const cout = model.cpm_output == null ? null : Number(model.cpm_output);
  if (cin == null && cout == null) return null;
  return ((cin || 0) * inputTokens + (cout || 0) * outputTokens) / 1_000_000;
}

/** sample_size: absent / '' / 0 = every transcript; otherwise a positive integer. */
function parseSampleSize(raw) {
  if (raw == null || raw === '' || raw === 0 || raw === '0' || raw === 'all') return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s) || parseInt(s, 10) < 1) {
    throw new HttpError(400, 'Sample size must be a whole number of transcripts');
  }
  return parseInt(s, 10);
}

function parseSampleSeed(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  const s = String(raw);
  if (s.length > 64) throw new HttpError(400, 'Sample seed is too long');
  return s;
}

/**
 * Draw n entries, proportional by section (every section with usable chats gets at least one
 * when n allows). Within a section, entries are ordered by sha256(seed:case_chat_id), so the
 * draw is reproducible — the estimate and the run are separate requests and must pick the
 * same chats. Never use Math.random() here.
 *
 * Slots are handed out ONE AT A TIME, and that is load-bearing: it makes the draw for n a
 * subset of the draw for n+1, so raising the sample size keeps every transcript already
 * analysed (cached, so free) instead of re-drawing from scratch. Computing all n slots at
 * once from a quota — largest remainder, as this did until 2026-09-17 — does NOT have that
 * property: it is the Alabama paradox, and it cost a section a slot at n=39 that it held at
 * n=38 (pool 60/45/30/5), silently dropping an analysed transcript out of the run. Any
 * rewrite here must keep allocations monotone in n; the cheap way is to keep deciding slot
 * n+1 only after slots 1..n are placed, which makes it true by construction.
 *
 * Monotonicity assumes the same seed and the same pool. New chats finishing between two runs
 * change a section's hash order, so a transcript can still fall out then.
 */
export function drawSample(entries, n, seed) {
  const bySection = new Map();
  for (const e of entries) {
    const key = e.chat.section_id;
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key).push({ e, order: sha256(`${seed}:${e.chat.case_chat_id}`) });
  }
  const groups = [...bySection.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([sectionId, list]) => {
      list.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
      return { sectionId, list, alloc: 0 };
    });

  // Each slot goes to the section that is currently most under-represented (D'Hondt:
  // usable / (drawn + 1)), except that sections with nothing yet are served first, which is
  // what gives every section at least one when n allows. Ties break on the larger section,
  // then section_id, so the result never depends on Map or query order.
  let remaining = Math.min(n, entries.length);
  while (remaining > 0) {
    const open = groups.filter(g => g.alloc < g.list.length);
    if (open.length === 0) break;
    const unseated = open.filter(g => g.alloc === 0);
    const contenders = unseated.length > 0 ? unseated : open;
    let best = contenders[0];
    for (const g of contenders) {
      const pg = g.list.length / (g.alloc + 1);
      const pb = best.list.length / (best.alloc + 1);
      if (pg > pb
        || (pg === pb && g.list.length > best.list.length)
        || (pg === pb && g.list.length === best.list.length && g.sectionId < best.sectionId)) {
        best = g;
      }
    }
    best.alloc++;
    remaining--;
  }

  const drawn = [];
  const bySectionCounts = {};
  for (const g of groups) {
    drawn.push(...g.list.slice(0, g.alloc).map(x => x.e));
    bySectionCounts[g.sectionId] = { drawn: g.alloc, usable: g.list.length };
  }
  return { drawn, bySection: bySectionCounts };
}

/**
 * Classify every chat in scope (analyse / cached / skip) and price the work.
 * Used by both the estimate endpoint and run creation so they cannot disagree.
 * With input.sample_size, only a proportional-by-section sample of the usable chats is
 * planned (see drawSample); chats not drawn are left out of the plan entirely.
 */
export async function planRun(req, input) {
  const requestedSample = parseSampleSize(input.sample_size);
  const scope = await resolveRunScope(req, input);
  const sampleSeed = parseSampleSeed(input.sample_seed, `${scope.caseId}:${scope.scenarioId ?? ''}`);
  const billedInstructorId = await resolveBilledInstructor(req, scope.sectionIds);
  const model = await resolveModel(input.model_id || null, billedInstructorId);
  const extract = await loadPrompt('issue_analytics.extract_facts');
  const cluster = await loadPrompt('issue_analytics.cluster_themes');
  const context = await loadRunContext({ case_id: scope.caseId, scenario_id: scope.scenarioId });
  const chats = await loadScopeChats(scope);

  // Which transcripts already have pass-1 facts for this model + prompt text.
  const [cachedRows] = chats.length
    ? await pool.execute(
        `SELECT case_chat_id, transcript_hash FROM issue_analysis_chat_facts
          WHERE model_id = ? AND prompt_version = ?
            AND case_chat_id IN (${chats.map(() => '?').join(',')})`,
        [model.model_id, extract.versionTag, ...chats.map(c => c.case_chat_id)]
      )
    : [[]];
  const cached = new Set(cachedRows.map(r => `${r.case_chat_id}:${r.transcript_hash}`));

  const fixedPromptChars = extract.template.length
    + Object.values(context.promptVars).reduce((n, v) => n + String(v).length, 0);

  const all = [];
  for (const chat of chats) {
    const entry = { chat, hash: null, state: 'pending', skip_reason: null, cached: false, inputTokens: 0 };
    if (!chat.transcript || !chat.transcript.trim()) {
      entry.state = 'skipped';
      entry.skip_reason = 'No saved transcript';
    } else {
      const prepared = prepareTranscript(chat.transcript, nameHints(chat));
      entry.hash = sha256(chat.transcript);
      if (prepared.error) {
        entry.state = 'skipped';
        entry.skip_reason = prepared.error;
      } else if (cached.has(`${chat.case_chat_id}:${entry.hash}`)) {
        entry.cached = true;
      } else {
        entry.inputTokens = Math.ceil((fixedPromptChars + prepared.xml.length) / CHARS_PER_TOKEN);
      }
    }
    all.push(entry);
  }

  // Sample only the usable chats, so a sample of N means N transcripts analysed.
  const usable = all.filter(p => p.state === 'pending');
  const sampling = requestedSample != null && requestedSample < usable.length;
  const sample = sampling ? drawSample(usable, requestedSample, sampleSeed) : null;
  const planned = sampling ? sample.drawn : all;

  const price = (entries) => {
    const pending = entries.filter(p => p.state === 'pending');
    const fresh = pending.filter(p => !p.cached);
    const inputTokens = fresh.reduce((n, p) => n + p.inputTokens, 0);
    const clusterInput = Math.ceil(cluster.template.length / CHARS_PER_TOKEN) + pending.length * ITEMS_PER_CHAT * RECORD_TOKENS;
    const extractCost = costOf(model, inputTokens, fresh.length * EXTRACT_OUTPUT_TOKENS);
    const clusterCost = pending.length > 0 ? costOf(model, clusterInput, CLUSTER_OUTPUT_TOKENS) : 0;
    return {
      toProcess: fresh.length,
      cached: pending.length - fresh.length,
      skipped: entries.length - pending.length,
      cost: extractCost == null || clusterCost == null ? null : extractCost + clusterCost,
    };
  };
  const planPrice = price(planned);
  const fullPrice = sampling ? price(all) : planPrice;
  const toProcess = planPrice.toProcess;
  const cachedCount = planPrice.cached;
  const skipped = planPrice.skipped;
  const estCost = planPrice.cost;
  const round = (v) => (v == null ? null : Number(v.toFixed(4)));

  const usage = await getWeeklyUsage(billedInstructorId);
  const capRemaining = usage.capActive ? Math.max(0, usage.cap - usage.costUsed) : null;

  return {
    scope,
    model,
    billedInstructorId,
    extractVersion: extract.versionTag,
    planned,
    sample: {
      size: sampling ? planned.length : null,
      seed: sampling ? sampleSeed : null,
      pool: usable.length,
    },
    summary: {
      case_id: scope.caseId,
      scenario_id: scope.scenarioId,
      section_ids: scope.sectionIds,
      chats_completed: chats.length,
      chats_total: planned.length,
      chats_cached: cachedCount,
      chats_skipped: skipped,
      chats_to_process: toProcess,
      est_cost_usd: round(estCost),
      sample_requested: requestedSample,
      sample_size: sampling ? planned.length : null,
      sample_seed: sampleSeed,
      sample_pool: usable.length,
      sample_by_section: sample ? sample.bySection : null,
      pool_chats_skipped: all.length - usable.length,
      full_chats_to_process: fullPrice.toProcess,
      full_chats_cached: fullPrice.cached,
      full_est_cost_usd: round(fullPrice.cost),
      model_id: model.model_id,
      model_name: model.model_name,
      model_priced: estCost != null,
      billed_instructor_id: billedInstructorId,
      billed_instructor_name: await instructorName(billedInstructorId),
      cap_active: usage.capActive,
      cap_usd: usage.capActive ? usage.cap : null,
      cap_used_usd: usage.capActive ? Number(usage.costUsed.toFixed(4)) : null,
      cap_remaining_usd: capRemaining == null ? null : Number(capRemaining.toFixed(4)),
      exceeds_cap: capRemaining != null && estCost != null && estCost > capRemaining,
      skip_reasons: tally(all.filter(p => p.skip_reason).map(p => p.skip_reason)),
    },
  };
}

/** Price a pass-3 re-scan of one theme over a run's analysed transcripts. */
export async function planRescan(run) {
  const [[model]] = await pool.execute(
    'SELECT model_id, model_name, vendor, cpm_input, cpm_output FROM models WHERE model_id = ?',
    [run.model_id]
  );
  if (!model) throw new HttpError(400, `The run's model ${run.model_id} no longer exists`);
  const rescan = await loadPrompt('issue_analytics.theme_rescan');
  const [rows] = await pool.execute(
    `SELECT COALESCE(CHAR_LENGTH(t.transcript), 0) AS chars
       FROM issue_analysis_run_chats rc
       LEFT JOIN transcripts t ON t.id = (SELECT t2.id FROM transcripts t2
                                           WHERE t2.case_chat_id = rc.case_chat_id
                                           ORDER BY t2.created_at DESC, t2.id DESC LIMIT 1)
      WHERE rc.run_id = ? AND rc.state = 'done'`,
    [run.id]
  );
  const inputTokens = rows.reduce((n, r) => n + Math.ceil((rescan.template.length + 1500 + Number(r.chars)) / CHARS_PER_TOKEN), 0);
  const cost = costOf(model, inputTokens, rows.length * RESCAN_OUTPUT_TOKENS);
  const usage = await getWeeklyUsage(run.billed_instructor_id);
  const capRemaining = usage.capActive ? Math.max(0, usage.cap - usage.costUsed) : null;
  return {
    chats: rows.length,
    est_cost_usd: cost == null ? null : Number(cost.toFixed(4)),
    model_id: model.model_id,
    cap_remaining_usd: capRemaining == null ? null : Number(capRemaining.toFixed(4)),
    exceeds_cap: capRemaining != null && cost != null && cost > capRemaining,
  };
}

function tally(list) {
  const out = {};
  for (const k of list) out[k] = (out[k] || 0) + 1;
  return out;
}
