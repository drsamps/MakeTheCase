import React from 'react';
import { BUSINESS_CASE_TEXT } from '../data/business_case';
import FontSizeControl from './FontSizeControl';

interface BusinessCaseProps {
  fontSize: string;
  onFontSizeChange: (size: string) => void;
  fontSizes: string[];
  defaultFontSize: string;
}

const BusinessCase: React.FC<BusinessCaseProps> = ({ fontSize, onFontSizeChange, fontSizes, defaultFontSize }) => {
  const paragraphs = BUSINESS_CASE_TEXT.trim().split('\n').filter(p => p.trim() !== '');

  const handleCopyPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    alert('Sorry, cut-and-paste are disabled while using this simulation.');
  };

  const formattedText = paragraphs.map((p, i) => {
    // A simple heuristic for a heading: it's a short line with no period at the end.
    if (p.length < 50 && !p.endsWith('.') && !p.endsWith('?')) {
        return <h3 key={i} className="text-xl font-bold text-gray-800 mt-6 mb-2">{p}</h3>;
    }
    // Render text wrapped in underscores as italic
    if (p.startsWith('_') && p.endsWith('_')) {
        return <p key={i} className={`text-gray-700 mb-4 italic ${fontSize}`}>{p.slice(1, -1)}</p>;
    }
    return <p key={i} className={`text-gray-700 mb-4 ${fontSize}`}>{p}</p>;
  });

  return (
    <div 
      className="bg-white p-6 rounded-xl shadow-lg h-full overflow-y-auto"
      onCopy={handleCopyPaste}
      onCut={handleCopyPaste}
    >
      <div className="flex justify-between items-center border-b pb-3 mb-4">
        <h2 className="text-2xl font-bold text-gray-900">Malawi's Pizza Catering Case</h2>
        <FontSizeControl
          currentSize={fontSize}
          onSizeChange={onFontSizeChange}
          sizes={fontSizes}
          defaultSize={defaultFontSize}
        />
      </div>
      <div className="max-w-none">
        {formattedText}
      </div>
    </div>
  );
};

export default BusinessCase;
