import React from 'react';
import { BUSINESS_CASE_TEXT } from '../data/business_case';
import FontSizeControl from './FontSizeControl';
import MarkdownPreview from './caseWriter/MarkdownPreview';

interface BusinessCaseProps {
  fontSize: string;
  onFontSizeChange: (size: string) => void;
  fontSizes: string[];
  defaultFontSize: string;
  // Optional props for dynamic case content
  caseTitle?: string;
  caseContent?: string;
}

const BusinessCase: React.FC<BusinessCaseProps> = ({ 
  fontSize, 
  onFontSizeChange, 
  fontSizes, 
  defaultFontSize,
  caseTitle,
  caseContent 
}) => {
  // Use provided case content or fall back to hardcoded content
  const textContent = caseContent || BUSINESS_CASE_TEXT;
  const title = caseTitle || "Malawi's Pizza Catering Case";

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
      {/* Readings are Markdown (Case Writer output, DOCX converted by mammoth). Rendered by the
          same component as the instructor's Case Files preview, so students see what the
          instructor previewed, sized by the font control. No raw HTML, as in that preview. */}
      <MarkdownPreview markdown={textContent} scaleWithText className={`max-w-none ${fontSize}`} emptyText="" />
    </div>
  );
};

export default BusinessCase;
