import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import {
  getSanitizeSchema,
  type SanitizePreset,
} from '../../utils/markdownSanitizeSchemas';
import { resolvePublicAssetUrl } from '../../utils/resolvePublicAssetUrl';

export type AllowHtml = false | 'sanitized' | 'any';

interface Props {
  markdown: string;
  emptyText?: string;
  className?: string;
  /** false = markdown only; sanitized = allowlisted HTML; any = raw HTML (trusted content only). */
  allowHtml?: AllowHtml;
  /** Required when allowHtml is "sanitized". */
  sanitizePreset?: SanitizePreset;
  /**
   * Size text from the parent (`className`) instead of fixed small sizes, with headings relative
   * to it. The student reading panel uses this so its font-size control works and the reading
   * looks like the instructor's preview, scaled.
   */
  scaleWithText?: boolean;
}

function buildComponents(scaled = false) {
  // Fixed sizes for the dashboard previews; relative sizes when the text scales with its parent.
  const size = scaled
    ? { h1: 'text-[1.5em]', h2: 'text-[1.3em]', h3: 'text-[1.15em]', h4: 'text-[1em]', body: '', code: 'text-[0.85em]' }
    : { h1: 'text-xl', h2: 'text-lg', h3: 'text-base', h4: 'text-sm', body: 'text-sm', code: 'text-xs' };
  const Img = (p: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img {...p} src={resolvePublicAssetUrl(p.src)} alt={p.alt ?? ''} />
  );

  return {
    h1: (p: any) => <h1 className={`${size.h1} font-bold text-gray-900 mt-3 mb-2`} {...p} />,
    h2: (p: any) => <h2 className={`${size.h2} font-bold text-gray-900 mt-3 mb-2`} {...p} />,
    h3: (p: any) => <h3 className={`${size.h3} font-semibold text-gray-900 mt-2 mb-1`} {...p} />,
    h4: (p: any) => <h4 className={`${size.h4} font-semibold text-gray-800 mt-2 mb-1`} {...p} />,
    p: (p: any) => <p className={`${size.body} text-gray-800 my-2 leading-relaxed`} {...p} />,
    ul: (p: any) => <ul className={`list-disc pl-5 my-2 space-y-1 ${size.body} text-gray-800`} {...p} />,
    ol: (p: any) => <ol className={`list-decimal pl-5 my-2 space-y-1 ${size.body} text-gray-800`} {...p} />,
    li: (p: any) => <li className="leading-relaxed" {...p} />,
    strong: (p: any) => <strong className="font-semibold text-gray-900" {...p} />,
    em: (p: any) => <em className="italic" {...p} />,
    img: Img,
    blockquote: (p: any) => (
      <blockquote className="border-l-4 border-gray-300 pl-3 italic text-gray-700 my-2" {...p} />
    ),
    // react-markdown 10 no longer tells `code` whether it is inline, so `code` is styled inline
    // and `pre` (only ever around a code block) carries the block styling and resets its child.
    code: ({ node, className, ...rest }: any) => (
      <code className={`px-1 py-0.5 bg-gray-100 rounded ${size.code} font-mono text-pink-700 ${className || ''}`} {...rest} />
    ),
    pre: ({ node, ...p }: any) => (
      <pre
        className={`bg-gray-100 rounded p-2 my-2 overflow-x-auto ${size.code} font-mono text-gray-800 [&>code]:p-0 [&>code]:text-[1em] [&>code]:text-gray-800`}
        {...p}
      />
    ),
    hr: () => <hr className="my-3 border-gray-200" />,
    a: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
      const isInApp = typeof href === 'string' && href.startsWith('#');
      return (
        <a
          href={href}
          className="text-blue-600 hover:underline"
          {...(isInApp ? {} : { target: '_blank', rel: 'noreferrer' })}
          {...rest}
        >
          {children}
        </a>
      );
    },
    table: (p: any) => (
      <div className="overflow-x-auto my-3">
        <table className={`min-w-full border-collapse border border-gray-300 ${size.body}`} {...p} />
      </div>
    ),
    thead: (p: any) => <thead className="bg-gray-50" {...p} />,
    tbody: (p: any) => <tbody {...p} />,
    tr: (p: any) => <tr className="border-b border-gray-200" {...p} />,
    th: (p: any) => <th className="border border-gray-300 px-2 py-1 text-left font-semibold text-gray-900" {...p} />,
    td: (p: any) => <td className="border border-gray-300 px-2 py-1 align-top text-gray-800" {...p} />,
  };
}

const markdownComponents = buildComponents();
const scaledMarkdownComponents = buildComponents(true);

function buildRehypePlugins(allowHtml: AllowHtml, sanitizePreset?: SanitizePreset) {
  if (!allowHtml) return [];
  const plugins: unknown[] = [rehypeRaw];
  if (allowHtml === 'sanitized') {
    const preset = sanitizePreset ?? 'minimal';
    plugins.push([rehypeSanitize, getSanitizeSchema(preset)]);
  }
  return plugins;
}

const MarkdownPreview: React.FC<Props> = ({
  markdown,
  emptyText = 'Preview will show here',
  className,
  allowHtml = false,
  sanitizePreset,
  scaleWithText = false,
}) => {
  const hasContent = markdown && markdown.trim().length > 0;
  const rehypePlugins = useMemo(
    () => buildRehypePlugins(allowHtml, sanitizePreset),
    [allowHtml, sanitizePreset]
  );

  return (
    <div className={className}>
      {hasContent ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={rehypePlugins as Parameters<typeof ReactMarkdown>[0]['rehypePlugins']}
          components={scaleWithText ? scaledMarkdownComponents : markdownComponents}
        >
          {markdown}
        </ReactMarkdown>
      ) : (
        <p className="text-gray-400 italic text-sm">{emptyText}</p>
      )}
    </div>
  );
};

export default MarkdownPreview;
