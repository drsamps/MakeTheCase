import React, { useEffect, useRef, useState } from 'react';
import { api } from '../services/apiClient';

/**
 * Dashboard header: "Student view ▾". Opens the student page in its own tab, signed in as
 * the caller's preview student, either as they left it or as a brand-new student.
 * Preview chats are labeled in Monitor and left out of Results and analytics.
 */
const StudentViewMenu: React.FC = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = async (fresh: boolean) => {
    setOpen(false);
    if (fresh && !window.confirm('Start Student view as a new student? Your earlier Student view chats, evaluations and section choices will be deleted.')) return;
    const { error } = await api.auth.openStudentView(fresh);
    if (error) window.alert(error.message);
  };

  const item = 'block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 bg-transparent border-none';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="See the student page as your students see it"
        className="text-sm font-medium text-gray-600 hover:text-gray-900 p-2 rounded-md hover:bg-gray-100 transition-colors bg-transparent border-none"
      >
        Student view ▾
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-1 w-64 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
          <button type="button" role="menuitem" className={item} onClick={() => go(false)}>
            <div className="font-medium">Open student view</div>
            <div className="text-xs text-gray-500">Continue as your preview student</div>
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => go(true)}>
            <div className="font-medium">Start as a new student</div>
            <div className="text-xs text-gray-500">Clear your preview chats and pick a section from scratch</div>
          </button>
          <div className="px-3 pt-1 pb-2 text-xs text-gray-500 border-t border-gray-100 mt-1">
            Student view chats show in Monitor with a badge and are left out of Results and analytics.
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentViewMenu;
