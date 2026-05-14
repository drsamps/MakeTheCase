import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  markdown: string;
  emptyText?: string;
  className?: string;
}

const components = {
  h1: (p: any) => <h1 className="text-xl font-bold text-gray-900 mt-3 mb-2" {...p} />,
  h2: (p: any) => <h2 className="text-lg font-bold text-gray-900 mt-3 mb-2" {...p} />,
  h3: (p: any) => <h3 className="text-base font-semibold text-gray-900 mt-2 mb-1" {...p} />,
  h4: (p: any) => <h4 className="text-sm font-semibold text-gray-800 mt-2 mb-1" {...p} />,
  p: (p: any) => <p className="text-sm text-gray-800 my-2 leading-relaxed" {...p} />,
  ul: (p: any) => <ul className="list-disc pl-5 my-2 space-y-1 text-sm text-gray-800" {...p} />,
  ol: (p: any) => <ol className="list-decimal pl-5 my-2 space-y-1 text-sm text-gray-800" {...p} />,
  li: (p: any) => <li className="leading-relaxed" {...p} />,
  strong: (p: any) => <strong className="font-semibold text-gray-900" {...p} />,
  em: (p: any) => <em className="italic" {...p} />,
  blockquote: (p: any) => (
    <blockquote className="border-l-4 border-gray-300 pl-3 italic text-gray-700 my-2" {...p} />
  ),
  code: (props: any) => {
    const { inline, className, children, ...rest } = props;
    if (inline) {
      return (
        <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono text-pink-700" {...rest}>
          {children}
        </code>
      );
    }
    return (
      <code className={`block bg-gray-100 rounded p-2 text-xs font-mono overflow-x-auto ${className || ''}`} {...rest}>
        {children}
      </code>
    );
  },
  pre: (p: any) => <pre className="bg-gray-100 rounded p-2 my-2 overflow-x-auto" {...p} />,
  hr: () => <hr className="my-3 border-gray-200" />,
  a: (p: any) => <a className="text-blue-600 hover:underline" target="_blank" rel="noreferrer" {...p} />,
  table: (p: any) => (
    <div className="overflow-x-auto my-3">
      <table className="min-w-full border-collapse border border-gray-300 text-sm" {...p} />
    </div>
  ),
  thead: (p: any) => <thead className="bg-gray-50" {...p} />,
  tbody: (p: any) => <tbody {...p} />,
  tr: (p: any) => <tr className="border-b border-gray-200" {...p} />,
  th: (p: any) => <th className="border border-gray-300 px-2 py-1 text-left font-semibold text-gray-900" {...p} />,
  td: (p: any) => <td className="border border-gray-300 px-2 py-1 align-top text-gray-800" {...p} />,
};

const MarkdownPreview: React.FC<Props> = ({ markdown, emptyText = 'Preview will show here', className }) => {
  const hasContent = markdown && markdown.trim().length > 0;
  return (
    <div className={className}>
      {hasContent
        ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{markdown}</ReactMarkdown>
        : <p className="text-gray-400 italic text-sm">{emptyText}</p>}
    </div>
  );
};

export default MarkdownPreview;
