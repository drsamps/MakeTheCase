import React from 'react';

interface BottomRightFabProps {
  onClick: () => void;
}

const BottomRightFab: React.FC<BottomRightFabProps> = ({ onClick }) => (
  <button
    onClick={onClick}
    aria-label="Submit feedback"
    className="fixed bottom-6 right-6 z-[900] w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-xl flex items-center justify-center transition-colors"
    title="Submit feedback"
  >
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.84L3 20l1.39-3.5A8.04 8.04 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
      />
    </svg>
  </button>
);

export default BottomRightFab;
