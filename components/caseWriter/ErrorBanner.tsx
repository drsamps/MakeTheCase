import React from 'react';

interface Props {
  message: string | null;
  onDismiss: () => void;
}

const ErrorBanner: React.FC<Props> = ({ message, onDismiss }) => {
  if (!message) return null;
  return (
    <div className="flex items-start gap-3 p-3 mb-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-md">
      <div className="flex-1 whitespace-pre-wrap">{message}</div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss error"
        className="text-red-600 hover:text-red-800 font-bold px-2 leading-none text-lg"
      >
        ×
      </button>
    </div>
  );
};

export default ErrorBanner;
