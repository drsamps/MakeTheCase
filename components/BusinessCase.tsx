import React from 'react';
import { BUSINESS_CASE_TEXT } from '../data/business_case';
import FontSizeControl from './FontSizeControl';
import ReadingText, { type ReadingPart } from './ReadingText';
import { MARKDOWN } from '../utils/readingFormat.js';

const DEFAULT_READING: ReadingPart[] = [{ kind: 'file', format: MARKDOWN, content: BUSINESS_CASE_TEXT }];

interface BusinessCaseProps {
  fontSize: string;
  onFontSizeChange: (size: string) => void;
  fontSizes: string[];
  defaultFontSize: string;
  caseTitle?: string;
  /** The reading one file at a time with each file's format (GET /api/llm/case-data). */
  readingParts?: ReadingPart[];
}

const BusinessCase: React.FC<BusinessCaseProps> = ({ 
  fontSize, 
  onFontSizeChange, 
  fontSizes, 
  defaultFontSize,
  caseTitle,
  readingParts,
}) => {
  const title = caseTitle || "Malawi's Pizza Catering Case";
  // Each file renders by its own format. No parts (the case could not be loaded): the built-in
  // Malawi's Pizza case.
  const parts = readingParts && readingParts.length > 0 ? readingParts : DEFAULT_READING;

  const handleCopyPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    alert('Sorry, cut-and-paste are disabled while using this simulation.');
  };

  return (
    <div 
      className="bg-white p-6 rounded-xl shadow-lg h-full overflow-y-auto"
      onCopy={handleCopyPaste}
      onCut={handleCopyPaste}
    >
      <div className="flex justify-between items-center border-b pb-3 mb-4">
        <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
        <FontSizeControl
          currentSize={fontSize}
          onSizeChange={onFontSizeChange}
          sizes={fontSizes}
          defaultSize={defaultFontSize}
        />
      </div>
      {/* The same renderer as the instructor's Case Files preview, sized by the font control. */}
      <div className={`max-w-none ${fontSize}`}>
        {parts.map((part, i) => (
          <section key={i} className={i > 0 ? 'mt-6 pt-4 border-t border-gray-200' : undefined}>
            {part.kind === 'outline' && <h2 className="text-[1.3em] font-bold text-gray-900 mb-2">Outline</h2>}
            <ReadingText text={part.content} format={part.format} scaleWithText emptyText="" />
          </section>
        ))}
      </div>
    </div>
  );
};

export default BusinessCase;
