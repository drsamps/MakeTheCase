import React, { useState } from 'react';
import { api } from '../../services/apiClient';
import TextEditorPanel from './TextEditorPanel';

/** What POST /case-files/:caseId/fetch-url returns for { preview: true }. */
export interface FetchPreview {
  kind: 'web' | 'file';
  title: string;
  text: string;
  degraded: boolean;
  final_url: string;
  content_type: string | null;
}

interface Props {
  caseId: string;
  /** The effective file_type chosen in the Add-from-web box. */
  fileType: string;
  fileTypeLabel: string;
  /** Set for a fetched URL; absent when pasting. */
  url?: string;
  preview?: FetchPreview;
  onClose: () => void;
  onSaved: (title: string) => void;
}

/**
 * Review fetched (or pasted) text before it becomes a case file. Nothing is stored
 * until Save: the fetch preview call saves nothing, and Cancel just drops the text.
 */
const WebFetchModal: React.FC<Props> = ({ caseId, fileType, fileTypeLabel, url, preview, onClose, onSaved }) => {
  const isPaste = !preview;
  const [title, setTitle] = useState(preview?.title || '');
  const [text, setText] = useState(preview?.text || '');
  const [sourceUrl, setSourceUrl] = useState('');
  const [proprietary, setProprietary] = useState(false);
  const [includeInPrompt, setIncludeInPrompt] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasWork = isPaste ? text.trim().length > 0 : text !== preview!.text;

  const handleCancel = () => {
    if (hasWork && !confirm(isPaste ? 'Discard the pasted text?' : 'Discard your edits to the fetched text?')) return;
    onClose();
  };

  const handleSave = async () => {
    if (!text.trim()) {
      setError('The text is empty.');
      return;
    }
    if (isPaste && !title.trim()) {
      setError('Give the text a title.');
      return;
    }
    setSaving(true);
    setError(null);
    const common = {
      title: title.trim(),
      text,
      file_type: fileType,
      proprietary,
      include_in_chat_prompt: includeInPrompt,
    };
    const response = isPaste
      ? await api.post(`/case-files/${caseId}/paste`, { ...common, source_url: sourceUrl.trim() })
      : await api.post(`/case-files/${caseId}/fetch-url`, {
          ...common,
          url,
          kind: preview!.kind,
          original_text: preview!.text,
          final_url: preview!.final_url,
          content_type: preview!.content_type,
        });
    setSaving(false);
    if (response.error) {
      setError(response.error.message);
      return;
    }
    onSaved(title.trim() || preview?.title || 'Web page');
  };

  const redirected = preview && url && preview.final_url !== url;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-xl font-bold">{isPaste ? 'Paste text' : 'Review fetched text'}</h3>
            <p className="text-sm text-gray-600">
              Nothing is saved yet. This text is what the AI will read, so check it and trim anything that isn't part of the page.
            </p>
          </div>
          <button onClick={handleCancel} className="text-gray-400 hover:text-gray-600 text-2xl leading-none" aria-label="Close">
            &times;
          </button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4 space-y-3">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2 text-sm">{error}</div>}

          {preview?.degraded && (
            <div className="bg-yellow-50 border border-yellow-300 text-yellow-900 rounded px-3 py-2 text-sm">
              <strong>Very little text was found.</strong> The page may be built by JavaScript, behind a paywall or a
              login, or blocking automated readers. If the text below isn't the article, cancel, open the page in your
              browser, copy the text, and use <em>Paste text instead</em>.
            </div>
          )}

          {preview && (
            <p className="text-xs text-gray-500 break-all">
              From{' '}
              <a href={preview.final_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                {preview.final_url}
              </a>
              {redirected && <> (redirected from {url})</>}
              {preview.kind === 'file' && (
                <> · {(preview.content_type || 'file').replace('application/', '').toUpperCase()}: the original file is kept so it can be downloaded later</>
              )}
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="font-medium block mb-1 text-sm">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={255}
                placeholder={isPaste ? 'e.g., WSJ article on Southwest pricing' : ''}
                className="border rounded px-3 py-2 w-full"
              />
            </div>
            {isPaste ? (
              <div>
                <label className="font-medium block mb-1 text-sm">Source URL (optional)</label>
                <input
                  type="url"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://..."
                  className="border rounded px-3 py-2 w-full"
                />
              </div>
            ) : (
              <div className="text-sm text-gray-600 flex items-end pb-2">Type: {fileTypeLabel}</div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm">
            {isPaste && <span className="text-gray-600">Type: {fileTypeLabel}</span>}
            <label className="flex items-center">
              <input type="checkbox" checked={proprietary} onChange={(e) => setProprietary(e.target.checked)} className="mr-2" />
              Proprietary content
            </label>
            <label className="flex items-center">
              <input type="checkbox" checked={includeInPrompt} onChange={(e) => setIncludeInPrompt(e.target.checked)} className="mr-2" />
              Include in chat prompt
            </label>
          </div>

          <TextEditorPanel
            value={text}
            onChange={setText}
            placeholder={isPaste ? 'Paste the text here. Markdown (# headings, - lists, | tables |) is fine.' : undefined}
            status={!isPaste && text !== preview!.text ? <span className="text-xs text-orange-600 font-medium">Edited</span> : undefined}
          />
        </div>

        <div className="px-6 py-4 border-t flex items-center justify-between gap-2">
          <div>
            {!isPaste && text !== preview!.text && (
              <button
                onClick={() => setText(preview!.text)}
                className="text-sm text-gray-600 hover:text-gray-800"
                title="Undo your edits and use the text as fetched"
              >
                Revert to fetched text
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={handleCancel} className="px-4 py-2 border rounded hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !text.trim()}
              className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:bg-gray-400"
            >
              {saving ? 'Saving...' : 'Save as case file'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WebFetchModal;
