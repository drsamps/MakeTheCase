import React, { useState, useRef, useEffect } from 'react';

interface HelpTooltipProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * HelpTooltip - A standardized help info component for the instructor dashboard
 *
 * Displays a circled "i" icon that, when clicked, shows a popup with help content.
 * Use this component to provide contextual help throughout the application.
 *
 * Features:
 * - Scrollable content area
 * - Resizable popup (drag bottom-right corner)
 * - Closes on click outside or Escape key
 *
 * Usage:
 * <HelpTooltip title="Section Title">
 *   <p>Help content goes here...</p>
 *   <ul><li>Bullet points work too</li></ul>
 * </HelpTooltip>
 *
 * Help content should be stored in separate files under help/dashboard/
 * for easy editing. See CLAUDE.md for details.
 */
const HelpTooltip: React.FC<HelpTooltipProps> = ({ title, children, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close tooltip when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        tooltipRef.current &&
        !tooltipRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="help-tooltip-trigger w-5 h-5 rounded-full border-2 border-gray-400 text-gray-400 hover:border-blue-500 hover:text-blue-500 hover:bg-blue-50 flex items-center justify-center text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
        aria-label={`Help: ${title}`}
        aria-expanded={isOpen}
        title={`Help: ${title}`}
      >
        i
      </button>

      {isOpen && (
        <>
          {/* Backdrop for mobile */}
          <div
            className="fixed inset-0 bg-black/10 z-40 md:hidden"
            onClick={() => setIsOpen(false)}
          />

          {/* Tooltip popup - resizable */}
          <div
            ref={tooltipRef}
            className="help-tooltip-popup absolute left-0 top-full mt-2 z-50 bg-white rounded-lg shadow-lg border border-gray-200 flex flex-col"
            style={{
              width: '320px',
              minWidth: '280px',
              maxWidth: 'calc(100vw - 2rem)',
              height: '400px',
              minHeight: '200px',
              maxHeight: 'calc(100vh - 200px)',
              resize: 'both',
              overflow: 'hidden',
            }}
            role="dialog"
            aria-labelledby="help-tooltip-title"
          >
            {/* Header - fixed */}
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200 flex-shrink-0">
              <h3 id="help-tooltip-title" className="font-semibold text-gray-900 text-sm">
                {title}
              </h3>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Close help"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content - scrollable, fills remaining space */}
            <div className="help-tooltip-content px-4 py-3 text-sm text-gray-600 flex-1 overflow-y-auto">
              {children}
            </div>

            {/* Resize hint */}
            <div className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize opacity-30 hover:opacity-60 transition-opacity">
              <svg viewBox="0 0 16 16" fill="currentColor" className="text-gray-400">
                <path d="M14 14H10L14 10V14ZM14 8L8 14H6L14 6V8ZM14 2L2 14H0L14 0V2Z" />
              </svg>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default HelpTooltip;
