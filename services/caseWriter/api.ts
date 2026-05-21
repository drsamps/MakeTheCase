/**
 * Case Writer API client. Mirrors the surface of server/routes/caseWriter.js.
 * Uses the same admin auth token as the rest of the instructor dashboard
 * (see apiClient.ts isAdminContext, which recognizes #/case-writer).
 */

import { getApiBaseUrl } from '../apiClient';

const CW_BASE = () => `${getApiBaseUrl()}/case-writer`;

function authHeaders(): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = localStorage.getItem('admin_auth_token');
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

async function req<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<{ data: T | null; error: { message: string; [k: string]: any } | null }> {
  try {
    const res = await fetch(`${CW_BASE()}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...(init.headers || {}) }
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { error: { message: text || 'Invalid JSON response' } }; }
    if (!res.ok) {
      return { data: null, error: json?.error || { message: `HTTP ${res.status}` } };
    }
    return { data: (json?.data as T) ?? null, error: null };
  } catch (err) {
    return { data: null, error: { message: (err as Error).message } };
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CaseWriterStatus = 'draft' | 'reviewed' | 'exported' | 'published' | 'archived';

export interface CaseWriterProjectSummary {
  project_id: string;
  owner_id: string;
  owner_type: 'admin' | 'instructor';
  owner_name?: string | null;
  title: string | null;
  status: CaseWriterStatus;
  visibility?: 'private' | 'team' | 'public';
  created_by_type?: 'admin' | 'instructor' | 'system';
  teaching_principle: string | null;
  audience: string | null;
  course_context: string | null;
  difficulty: string | null;
  case_type: string | null;
  industries_preference?: string | null;
  industry?: string | null;
  published_case_id: string | null;
  default_model_id: string | null;
  created_at: string;
  updated_at: string;
  can_edit?: boolean;
  owner_label?: string | null;
}

export interface ScenarioCard {
  title: string;
  industry: string;
  markdown: string;
}

export interface CaseWriterProject extends CaseWriterProjectSummary {
  // Markdown-bearing steps come back as a JSON-encoded string (markdown body).
  // Scenarios come back as parsed objects.
  learning_brief: string | null;
  scenario_options: ScenarioCard[] | null;
  selected_scenario: ScenarioCard | null;
  case_blueprint: string | null;
  student_case: string | null;
  teaching_note: string | null;
  publish_protagonist: string | null;
  publish_chat_question: string | null;
  publish_arguments_for: string | null;
  publish_arguments_against: string | null;
}

export interface BoundaryViolation {
  category: string;
  snippet: string;
  explanation: string;
  severity: 'high' | 'medium' | 'low';
}

export interface BoundaryValidationResult {
  passes: boolean;
  summary: string;
  violations: BoundaryViolation[];
  meta?: { model_id: string; vendor: string; prompt_version: string; provider: string | null };
}

export interface GenerateMeta {
  model_id: string;
  vendor: string;
  prompt_version: string;
  provider: string | null;
  [k: string]: any;
}

export interface CaseWriterReference {
  reference_id: string;
  project_id: string;
  type: 'pasted_text' | 'uploaded_file' | 'link' | 'saved_framework';
  title: string | null;
  content_summary: string | null;
  approved_by_user: 0 | 1;
  source_notes: string | null;
  link_url: string | null;
  case_file_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface PrincipleCandidate {
  principle: string;
  rationale: string;
}

export interface PublishFields {
  protagonist: string;
  chat_question: string;
  arguments_for: string;
  arguments_against: string;
}

export type CaseSize = 'story_problem' | 'mini' | 'abridged' | 'regular' | 'expanded';

export interface CaseVersion {
  case_version_id: string;
  project_id: string;
  case_size: CaseSize;
  version_name: string;
  version_notes: string | null;
  model_id: string | null;
  word_count: number | null;
  version_created: string;
  version_updated: string;
}

// ---------------------------------------------------------------------------
// Helpers exposed to UI: unwrap a JSON-stringified markdown column value.
// ---------------------------------------------------------------------------

export function coerceMarkdown(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'string' ? parsed : value;
    } catch {
      return value;
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------

export const caseWriterApi = {
  listProjects: () => req<CaseWriterProjectSummary[]>('/projects'),

  getProject: (id: string) => req<CaseWriterProject>(`/projects/${id}`),

  createProject: (body: { title?: string; teaching_principle?: string; default_model_id?: string }) =>
    req<CaseWriterProject>('/projects', { method: 'POST', body: JSON.stringify(body) }),

  updateProject: (id: string, patch: Partial<CaseWriterProject>) =>
    req<CaseWriterProject>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteProject: (id: string) =>
    req<{ project_id: string; deleted: true }>(`/projects/${id}`, { method: 'DELETE' }),

  cloneProject: (id: string) =>
    req<CaseWriterProject>(`/projects/${id}/clone`, { method: 'POST' }),

  // -------------------------- Generation --------------------------

  generateBrief: (id: string, body: { model_id?: string } = {}) =>
    req<{ markdown: string; meta: GenerateMeta }>(`/projects/${id}/generate/brief`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),

  generateScenarios: (
    id: string,
    body: { model_id?: string; count?: number; industry_preference?: string; revision_hint?: string } = {}
  ) =>
    req<{ scenarios: ScenarioCard[]; meta: GenerateMeta }>(`/projects/${id}/generate/scenarios`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),

  generateBlueprint: (id: string, body: { model_id?: string; revision_hint?: string } = {}) =>
    req<{ markdown: string; meta: GenerateMeta }>(`/projects/${id}/generate/blueprint`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),

  generateStudentCase: (
    id: string,
    body: { model_id?: string; length?: CaseSize; revision_hint?: string } = {}
  ) =>
    req<{ markdown: string; meta: GenerateMeta }>(`/projects/${id}/generate/student-case`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),

  generateTeachingNote: (
    id: string,
    body: { model_id?: string; format?: 'brief' | 'standard' | 'detailed'; revision_hint?: string } = {}
  ) =>
    req<{ markdown: string; meta: GenerateMeta }>(`/projects/${id}/generate/teaching-note`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),

  revise: (
    id: string,
    body: {
      step: 'brief' | 'scenarios' | 'selected_scenario' | 'blueprint' | 'student_case' | 'teaching_note';
      command: string;
      instruction?: string;
      model_id?: string;
    }
  ) =>
    req<{ step: string; command: string; revised: any; meta: GenerateMeta }>(`/projects/${id}/revise`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),

  tweakContent: (
    id: string,
    body: {
      step: 'brief' | 'blueprint' | 'student_case' | 'teaching_note';
      current_value: string;
      instruction: string;
      model_id?: string;
    }
  ) =>
    req<{ revised: string; meta: GenerateMeta }>(`/projects/${id}/tweak`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),

  // -------------------------- References --------------------------

  listReferences: (id: string) => req<CaseWriterReference[]>(`/projects/${id}/references`),

  createReference: (
    id: string,
    body: { type: 'pasted_text' | 'link' | 'saved_framework'; title?: string; content?: string; link_url?: string; source_notes?: string }
  ) =>
    req<CaseWriterReference>(`/projects/${id}/references`, { method: 'POST', body: JSON.stringify(body) }),

  updateReference: (id: string, refId: string, patch: Partial<CaseWriterReference> & { content?: string }) =>
    req<CaseWriterReference>(`/projects/${id}/references/${refId}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteReference: (id: string, refId: string) =>
    req<{ reference_id: string; deleted: true }>(`/projects/${id}/references/${refId}`, { method: 'DELETE' }),

  summarizeReference: (id: string, refId: string, body: { model_id?: string } = {}) =>
    req<{ reference_id: string; summary: any; meta: GenerateMeta }>(`/projects/${id}/references/${refId}/summarize`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),

  uploadReference: async (
    id: string,
    file: File,
    fields: { title?: string; source_notes?: string } = {}
  ): Promise<{ data: CaseWriterReference | null; error: { message: string } | null }> => {
    try {
      const form = new FormData();
      form.append('file', file);
      if (fields.title) form.append('title', fields.title);
      if (fields.source_notes) form.append('source_notes', fields.source_notes);
      const h: Record<string, string> = {};
      const t = localStorage.getItem('admin_auth_token');
      if (t) h['Authorization'] = `Bearer ${t}`;
      const res = await fetch(`${CW_BASE()}/projects/${id}/references/upload`, {
        method: 'POST',
        headers: h,
        body: form
      });
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = { error: { message: text || 'Invalid JSON response' } }; }
      if (!res.ok) return { data: null, error: json?.error || { message: `HTTP ${res.status}` } };
      return { data: (json?.data as CaseWriterReference) ?? null, error: null };
    } catch (err) {
      return { data: null, error: { message: (err as Error).message } };
    }
  },

  // -------------------------- Validate / Publish ------------------

  validate: (id: string, body: { model_id?: string } = {}) =>
    req<BoundaryValidationResult>(`/projects/${id}/validate`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),

  extractPublishFields: (id: string, body: { model_id?: string } = {}) =>
    req<PublishFields & { meta: GenerateMeta }>(`/projects/${id}/extract-publish-fields`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),

  extractPrinciples: (body: { title?: string; type?: string; content?: string; case_file_id?: number; model_id?: string }) =>
    req<{ principles: PrincipleCandidate[]; meta: GenerateMeta }>(`/extract-principles`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),

  extractPrinciplesFromFile: async (
    file: File,
    fields: { title?: string; model_id?: string } = {}
  ): Promise<{ data: { principles: PrincipleCandidate[]; meta: GenerateMeta } | null; error: { message: string } | null }> => {
    try {
      const form = new FormData();
      form.append('file', file);
      if (fields.title) form.append('title', fields.title);
      if (fields.model_id) form.append('model_id', fields.model_id);
      const h: Record<string, string> = {};
      const t = localStorage.getItem('admin_auth_token');
      if (t) h['Authorization'] = `Bearer ${t}`;
      const res = await fetch(`${CW_BASE()}/extract-principles`, {
        method: 'POST',
        headers: h,
        body: form
      });
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = { error: { message: text || 'Invalid JSON response' } }; }
      if (!res.ok) return { data: null, error: json?.error || { message: `HTTP ${res.status}` } };
      return { data: json?.data ?? null, error: null };
    } catch (err) {
      return { data: null, error: { message: (err as Error).message } };
    }
  },

  // -------------------------- Case versions -----------------------

  listVersions: (id: string) =>
    req<CaseVersion[]>(`/projects/${id}/versions`),

  createVersion: (
    id: string,
    body: { version_name: string; version_notes?: string; case_size: CaseSize; model_id?: string }
  ) =>
    req<CaseVersion>(`/projects/${id}/versions`, { method: 'POST', body: JSON.stringify(body) }),

  updateVersion: (
    id: string,
    vid: string,
    patch: { version_name?: string; version_notes?: string | null; case_size?: CaseSize }
  ) =>
    req<CaseVersion>(`/projects/${id}/versions/${vid}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteVersion: (id: string, vid: string) =>
    req<{ deleted: true }>(`/projects/${id}/versions/${vid}`, { method: 'DELETE' }),

  loadVersion: (id: string, vid: string) =>
    req<{ student_case: string }>(`/projects/${id}/versions/${vid}/load`, { method: 'POST' }),

  publish: (id: string, body: { skip_validation?: boolean; validation_model_id?: string } = {}) =>
    req<{ case_id: string; case_title: string; validation: BoundaryValidationResult | null; files: string[] }>(
      `/projects/${id}/publish`,
      { method: 'POST', body: JSON.stringify(body) }
    ),

  // -------------------------- Export ------------------------------

  export: async (
    id: string,
    opts: { format: 'md' | 'docx' | 'pdf'; doc: 'case' | 'teaching_note' | 'combined' }
  ): Promise<{ blob: Blob | null; filename: string | null; error: string | null }> => {
    try {
      const url = `${CW_BASE()}/projects/${id}/export?format=${opts.format}&doc=${opts.doc}`;
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        return { blob: null, filename: null, error: txt || `HTTP ${res.status}` };
      }
      const blob = await res.blob();
      const dispo = res.headers.get('Content-Disposition') || '';
      const m = dispo.match(/filename="([^"]+)"/);
      return { blob, filename: m ? m[1] : null, error: null };
    } catch (err) {
      return { blob: null, filename: null, error: (err as Error).message };
    }
  }
};
