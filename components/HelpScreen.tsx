import React, { useEffect, useState } from 'react';
import { getApiBaseUrl, getAuthHeaders } from '../services/apiClient';
import MarkdownPreview from './caseWriter/MarkdownPreview';
import {
  ActivityTypesHelp, ApiKeysHelp, CaseFilesHelp, CasePackagesHelp, ChatOptionsHelp,
  CourseAssignmentsHelp, IssueAnalyticsHelp, PersonasHelp, PositionAnalyticsHelp, ResultsHelp,
  TeachBackHelp, TeamsHelp, VisibilityHelp,
} from '../help/dashboard';

interface GuideInfo {
  id: string;
  group: string;
  title: string;
  summary: string;
}

/** The dashboard's help tooltips, gathered in one place. `where` says where each one appears. */
const TOPICS: { title: string; where: string; Body: React.FC }[] = [
  { title: 'Activity types', where: 'Admin → Activity Types', Body: ActivityTypesHelp },
  { title: 'Teach-back', where: 'Chat Options, next to Activity Type', Body: TeachBackHelp },
  { title: 'Case files', where: 'Content → Case Files', Body: CaseFilesHelp },
  { title: 'Downloading and installing cases', where: 'Content → Cases', Body: CasePackagesHelp },
  { title: 'Chat options', where: 'Assignments → Chat Options', Body: ChatOptionsHelp },
  { title: 'Assignments by course', where: 'Assignments → By course', Body: CourseAssignmentsHelp },
  { title: 'Chatbot personas', where: 'Setup → Personas', Body: PersonasHelp },
  { title: 'Results', where: 'Results', Body: ResultsHelp },
  { title: 'Position analytics', where: 'Results → Positions', Body: PositionAnalyticsHelp },
  { title: 'Issue analytics', where: 'Results → Issue Analytics', Body: IssueAnalyticsHelp },
  { title: 'Teams', where: 'Setup → Teams', Body: TeamsHelp },
  { title: 'Sharing and visibility', where: 'Personas, rubrics, cases and Case Writer projects', Body: VisibilityHelp },
  { title: 'API keys', where: 'Setup → API Keys', Body: ApiKeysHelp },
];

// The help components use plain <h4>, <ul>, <code> and .help-callout. admin.css is not loaded,
// so they are styled here.
const TOPIC_BODY = [
  'text-sm text-gray-700 px-4 pb-4 pt-1',
  '[&_h4]:font-semibold [&_h4]:text-gray-900 [&_h4]:mt-3 [&_h4]:mb-1',
  '[&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2 [&_li]:my-1',
  '[&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs',
  '[&_.help-callout]:bg-blue-50 [&_.help-callout]:border [&_.help-callout]:border-blue-200',
  '[&_.help-callout]:rounded-md [&_.help-callout]:p-3 [&_.help-callout]:my-3',
].join(' ');

const HelpScreen: React.FC = () => {
  const [guides, setGuides] = useState<GuideInfo[] | null>(null);
  const [listError, setListError] = useState(false);
  const [openGuide, setOpenGuide] = useState<{ id: string; title: string; markdown: string } | null>(null);
  const [guideError, setGuideError] = useState<string | null>(null);
  const [loadingGuide, setLoadingGuide] = useState(false);

  useEffect(() => {
    fetch(`${getApiBaseUrl()}/content/help`, { headers: getAuthHeaders() })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => setGuides(d.guides || []))
      .catch(() => setListError(true));
  }, []);

  const showGuide = (id: string) => {
    setLoadingGuide(true);
    setGuideError(null);
    fetch(`${getApiBaseUrl()}/content/help/${encodeURIComponent(id)}`, { headers: getAuthHeaders() })
      .then(async r => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Could not load the guide.');
        setOpenGuide(d);
        window.scrollTo({ top: 0 });
      })
      .catch(err => setGuideError(err.message))
      .finally(() => setLoadingGuide(false));
  };

  // Links between guides arrive as #help/<id>, and links within a guide as #<heading-slug>.
  // Handle both here: changing the page's hash would leave the dashboard.
  const onGuideClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const link = (e.target as HTMLElement).closest('a');
    const href = link?.getAttribute('href') || '';
    if (!href.startsWith('#') || href.startsWith('#/')) return;
    e.preventDefault();
    if (href.startsWith('#help/')) {
      showGuide(href.slice('#help/'.length));
      return;
    }
    const slug = (s: string) => s.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
    const target = decodeURIComponent(href.slice(1));
    const heading = Array.from(e.currentTarget.querySelectorAll('h1, h2, h3, h4'))
      .find(h => slug(h.textContent || '') === target);
    heading?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (openGuide) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <button
          onClick={() => setOpenGuide(null)}
          className="mb-4 text-sm text-blue-600 hover:underline"
        >
          ← All help
        </button>
        {guideError && <p className="text-sm text-red-600 mb-3">{guideError}</p>}
        <div onClickCapture={onGuideClick}>
          <MarkdownPreview markdown={openGuide.markdown} />
        </div>
        <button
          onClick={() => setOpenGuide(null)}
          className="mt-6 text-sm text-blue-600 hover:underline"
        >
          ← All help
        </button>
      </div>
    );
  }

  const groups = Array.from(new Set((guides || []).map(g => g.group)));

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Help</h1>
      <p className="text-sm text-gray-600 mb-6">
        Guides for instructors and TAs, and the help from around the dashboard in one place. The
        Welcome tab has a short orientation.
      </p>

      <h2 className="text-lg font-bold text-gray-900 mb-3">Guides</h2>
      {listError && <p className="text-sm text-red-600">Could not load the list of guides.</p>}
      {guideError && <p className="text-sm text-red-600 mb-3">{guideError}</p>}
      {!guides && !listError && <p className="text-sm text-gray-400 italic">Loading…</p>}
      {groups.map(group => (
        <div key={group} className="mb-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{group}</h3>
          <div className="space-y-2">
            {guides!.filter(g => g.group === group).map(g => (
              <button
                key={g.id}
                onClick={() => showGuide(g.id)}
                disabled={loadingGuide}
                className="block w-full text-left border border-gray-200 rounded-lg px-4 py-3 hover:border-blue-300 hover:bg-blue-50 transition-colors disabled:opacity-60"
              >
                <span className="block text-sm font-semibold text-blue-700">{g.title}</span>
                <span className="block text-sm text-gray-600 mt-0.5">{g.summary}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      <h2 className="text-lg font-bold text-gray-900 mt-8 mb-1">Dashboard help topics</h2>
      <p className="text-sm text-gray-600 mb-3">
        The same help you get from the <span className="font-semibold">ⓘ</span> buttons around the dashboard.
      </p>
      <div className="space-y-2">
        {TOPICS.map(({ title, where, Body }) => (
          <details key={title} className="border border-gray-200 rounded-lg group">
            <summary className="cursor-pointer px-4 py-3 text-sm select-none hover:bg-gray-50 rounded-lg">
              <span className="font-semibold text-gray-900">{title}</span>
              <span className="text-gray-500"> · {where}</span>
            </summary>
            <div className={`help-tooltip-content ${TOPIC_BODY}`}>
              <Body />
            </div>
          </details>
        ))}
      </div>
    </div>
  );
};

export default HelpScreen;
