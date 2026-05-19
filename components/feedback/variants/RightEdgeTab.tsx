import React from 'react';

interface RightEdgeTabProps {
  onClick: () => void;
}

const RightEdgeTab: React.FC<RightEdgeTabProps> = ({ onClick }) => (
  <button
    onClick={onClick}
    aria-label="Submit feedback"
    className="fixed right-0 top-1/2 -translate-y-1/2 z-[900] px-2 py-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold tracking-wide rounded-l-md shadow-lg transition-colors"
    style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
  >
    Feedback
  </button>
);

export default RightEdgeTab;
