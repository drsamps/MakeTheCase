import React, { useState } from 'react';
import MarkdownPreview from '../caseWriter/MarkdownPreview';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Extra details shown after the character count (e.g. "fetched 10/8/2026"). */
  meta?: React.ReactNode;
  /** Shown at the right of the header row (e.g. "Unsaved changes"). */
  status?: React.ReactNode;
  placeholder?: string;
}

/**
 * The text a case file contributes to the chat prompt: an editable textarea with a
 * Markdown preview. Shared by the Extracted Text modal and the Add-from-web review.
 */
const TextEditorPanel: React.FC<Props> = ({ value, onChange, meta, status, placeholder }) => {
  const [preview, setPreview] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between mb-2 gap-3">
        <span className="text-xs text-gray-500">
          {value.length.toLocaleString()} characters
          {meta}
        </span>
        <div className="flex items-center gap-3">
          {status}
          <div className="inline-flex rounded border overflow-hidden text-xs" role="group" aria-label="Editor view">
            <button
              type="button"
              onClick={() => setPreview(false)}
              className={`px-3 py-1 ${!preview ? 'bg-purple-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
              aria-pressed={!preview}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => setPreview(true)}
              className={`px-3 py-1 border-l ${preview ? 'bg-purple-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
              aria-pressed={preview}
            >
              Preview
            </button>
          </div>
        </div>
      </div>
      {preview ? (
        <MarkdownPreview
          markdown={value}
          emptyText="No text"
          className="w-full h-[50vh] overflow-auto border rounded p-4 bg-gray-50 text-sm"
        />
      ) : (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full h-[50vh] border rounded p-3 font-mono text-sm resize-y focus:ring-2 focus:ring-purple-300 focus:border-purple-400"
          spellCheck={false}
        />
      )}
    </>
  );
};

export default TextEditorPanel;
