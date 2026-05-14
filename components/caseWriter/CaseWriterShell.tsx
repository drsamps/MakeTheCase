import React, { useEffect, useState } from 'react';
import CaseWriterHome from './CaseWriterHome';
import CaseWriterProject from './CaseWriterProject';

interface Props {
  onLogout: () => void;
  user: { full_name?: string; email?: string; role?: string } | null;
}

function parseProjectIdFromHash(): string | null {
  const h = window.location.hash;
  const m = h.match(/^#\/case-writer\/([a-zA-Z0-9_-]+)$/);
  return m ? m[1] : null;
}

const CaseWriterShell: React.FC<Props> = ({ onLogout, user }) => {
  const [projectId, setProjectId] = useState<string | null>(parseProjectIdFromHash());

  useEffect(() => {
    const onHash = () => setProjectId(parseProjectIdFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const openProject = (id: string) => {
    window.location.hash = `#/case-writer/${id}`;
  };

  const backToList = () => {
    window.location.hash = '#/case-writer';
  };

  const displayName = user?.full_name || user?.email || 'Instructor';

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex-shrink-0 flex justify-between items-center px-6 py-3 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-gray-900">Case Writer</h1>
          <a href="#/admin" className="text-xs text-blue-600 hover:underline">Back to Dashboard</a>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">{displayName}</span>
          <button
            onClick={onLogout}
            className="px-3 py-1.5 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-100"
          >
            Sign Out
          </button>
        </div>
      </header>
      <main>
        {projectId ? (
          <CaseWriterProject projectId={projectId} onBack={backToList} />
        ) : (
          <CaseWriterHome onOpenProject={openProject} />
        )}
      </main>
    </div>
  );
};

export default CaseWriterShell;
