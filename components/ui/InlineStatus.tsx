import React, { useEffect, useRef } from 'react';

// Save feedback shown beside the button that was clicked. The surrounding panel
// scrolls, and how far depends on the window size, so the message brings itself
// into view; 'nearest' leaves the scroll alone when it is already visible.
const InlineStatus: React.FC<{ kind: 'error' | 'saved'; text: string }> = ({ kind, text }) => {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [text]);
  return (
    <span
      ref={ref}
      role={kind === 'error' ? 'alert' : 'status'}
      className={`min-w-0 text-sm ${kind === 'error' ? 'text-red-600' : 'text-green-600 font-medium'}`}
    >
      {kind === 'error' ? '⚠ ' : '✓ '}{text}
    </span>
  );
};

export default InlineStatus;
