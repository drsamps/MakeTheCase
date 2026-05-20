import React, { useEffect, useState } from 'react';
import { getApiBaseUrl } from '../services/apiClient';
import MarkdownPreview from './caseWriter/MarkdownPreview';

const WelcomeScreen: React.FC = () => {
  const [markdown, setMarkdown] = useState<string>('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`${getApiBaseUrl()}/content/welcome`)
      .then(r => r.json())
      .then(d => setMarkdown(d.markdown || ''))
      .catch(() => setMarkdown(''))
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {loaded ? (
        <MarkdownPreview
          markdown={markdown}
          allowHtml="sanitized"
          sanitizePreset="welcome"
          emptyText="Welcome content is not yet configured. Edit config/welcome.md to add an orientation message for instructors."
        />
      ) : (
        <p className="text-sm text-gray-400 italic">Loading…</p>
      )}
    </div>
  );
};

export default WelcomeScreen;
