import { getApiBaseUrl, getImpersonationId } from '../../services/apiClient';
import { RunView, TYPE_META, ThemeType, prevalenceText } from './types';

/** Markdown for pasting into slides or notes. Follows the current Show-names state. */
export function runToMarkdown(view: RunView): string {
  const { run } = view;
  const lines: string[] = [];
  lines.push(`# ${run.case_title}${run.scenario_name ? ` — ${run.scenario_name}` : ''}`);
  lines.push('');
  lines.push(`${run.chats_done} transcripts analyzed${run.semester_label ? ` · ${run.semester_label}` : ''} · ${run.section_ids.join(', ')}`);
  for (const type of ['topic', 'argument', 'friction'] as ThemeType[]) {
    const themes = view.themes.filter(t => t.selected && t.theme_type === type);
    if (themes.length === 0) continue;
    lines.push('', `## ${TYPE_META[type].label}`);
    for (const t of themes) {
      lines.push('', `### ${t.label}`, '', `*${prevalenceText(t, run)}*`);
      if (t.description) lines.push('', t.description);
      const leanParts = view.axis.leans.filter(l => (t.lean[l.key] || 0) > 0).map(l => `${l.label} ${t.lean[l.key]}`);
      if (leanParts.length) lines.push('', `Lean: ${leanParts.join(' · ')}${t.no_lean ? ` · no clear lean ${t.no_lean}` : ''}`);
      const quotes = t.quotes.slice(0, 5);
      if (quotes.length) {
        lines.push('');
        for (const q of quotes) lines.push(`> "${q.quote.replace(/\s+/g, ' ')}" — ${q.student}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Download the quotes CSV. The server drops every identifying column when names is false. */
export async function downloadQuotesCsv(runId: number, names: boolean): Promise<void> {
  const token = localStorage.getItem('admin_auth_token');
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const actAs = getImpersonationId();
  if (actAs) headers['X-Act-As-Instructor'] = actAs;
  const res = await fetch(`${getApiBaseUrl()}/issue-analytics/runs/${runId}/quotes.csv${names ? '?names=1' : ''}`, { headers });
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const body = await res.json();
      message = body?.error?.message || message;
    } catch { /* not JSON */ }
    throw new Error(message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match?.[1] || `issue-analytics-run${runId}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
