import React, { useState, useEffect } from 'react';
import { api } from '../services/apiClient';
import CollapsibleSection from './ui/CollapsibleSection';
import FeedbackSettingsAdmin from './feedback/FeedbackSettingsAdmin';

interface Settings {
  [key: string]: {
    value: string;
    description: string;
  };
}

interface PromptVersions {
  [use: string]: string[];
}

const LOG_SETTING_KEYS = new Set([
  'log_case_chat_prompts',
  'log_evaluation_prompts',
  'max_log_files',
  'log_with_full_case_context',
]);

const FEEDBACK_SETTING_PREFIX = 'feedback.';

export const SettingsManager: React.FC = () => {
  const [settings, setSettings] = useState<Settings>({});
  const [promptVersions, setPromptVersions] = useState<PromptVersions>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<{ [key: string]: string }>({});

  // Independent open state per section. Default: all collapsed.
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchPromptVersions();
  }, []);

  // Auto-expand a section if the URL hash points to it (e.g. #/admin#settings/feedback).
  useEffect(() => {
    const applyHash = () => {
      const hash = window.location.hash;
      if (hash.endsWith('/feedback')) setFeedbackOpen(true);
      if (hash.endsWith('/prompts')) setPromptsOpen(true);
      if (hash.endsWith('/logs')) setLogsOpen(true);
      if (hash.endsWith('/other')) setOtherOpen(true);
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  const fetchSettings = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get('/settings');
      if (response.data) {
        setSettings(response.data as Settings);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch settings');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPromptVersions = async () => {
    try {
      const response = await api.get<any[]>('/prompts');
      if (response.data) {
        const versionsByUse: PromptVersions = {};
        response.data.forEach((prompt: any) => {
          if (!versionsByUse[prompt.use]) versionsByUse[prompt.use] = [];
          if (prompt.enabled && !versionsByUse[prompt.use].includes(prompt.version)) {
            versionsByUse[prompt.use].push(prompt.version);
          }
        });
        setPromptVersions(versionsByUse);
      }
    } catch (err) {
      console.error('Failed to fetch prompt versions:', err);
    }
  };

  const handleChange = (key: string, value: string) => {
    setPendingChanges({ ...pendingChanges, [key]: value });
  };

  const handleSave = async () => {
    if (Object.keys(pendingChanges).length === 0) {
      alert('No changes to save');
      return;
    }
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      for (const [key, value] of Object.entries(pendingChanges)) {
        await api.patch(`/settings/${key}`, { setting_value: value });
      }
      setSuccess('Settings saved successfully!');
      setPendingChanges({});
      fetchSettings();
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const getCurrentValue = (key: string): string => {
    return pendingChanges[key] ?? settings[key]?.value ?? '';
  };

  const promptSettings = Object.entries(settings).filter(([key]) => key.startsWith('active_prompt_'));
  const logSettings = Object.entries(settings).filter(([key]) => LOG_SETTING_KEYS.has(key));
  const otherSettings = Object.entries(settings).filter(
    ([key]) =>
      !key.startsWith('active_prompt_') &&
      !LOG_SETTING_KEYS.has(key) &&
      !key.startsWith(FEEDBACK_SETTING_PREFIX)
  );

  const getPromptUseFromKey = (key: string): string => key.replace('active_prompt_', '');

  const formatUseName = (use: string): string =>
    use.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  const hasChanges = Object.keys(pendingChanges).length > 0;

  const expandAll = () => {
    setFeedbackOpen(true);
    setPromptsOpen(true);
    setLogsOpen(true);
    setOtherOpen(true);
  };
  const collapseAll = () => {
    setFeedbackOpen(false);
    setPromptsOpen(false);
    setLogsOpen(false);
    setOtherOpen(false);
  };

  const renderKeyValueSection = (
    entries: [string, { value: string; description: string }][]
  ) => (
    <div className="space-y-4">
      {entries.map(([key, setting]) => {
        const currentValue = getCurrentValue(key);
        const hasChanged = pendingChanges.hasOwnProperty(key);
        const isBooleanSetting = currentValue === 'true' || currentValue === 'false';
        return (
          <div key={key} className="border-b pb-4 last:border-b-0">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <label className="block font-semibold mb-1">
                  {key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                  {hasChanged && (
                    <span className="ml-2 text-xs bg-yellow-200 text-yellow-800 px-2 py-1 rounded">Modified</span>
                  )}
                </label>
                {setting.description && (
                  <p className="text-xs text-gray-500 mt-1">{setting.description}</p>
                )}
              </div>
              {isBooleanSetting ? (
                <button
                  onClick={() => handleChange(key, currentValue === 'true' ? 'false' : 'true')}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    currentValue === 'true' ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      currentValue === 'true' ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              ) : (
                <input
                  type="text"
                  value={currentValue}
                  onChange={e => handleChange(key, e.target.value)}
                  className="border rounded px-3 py-2 w-full max-w-md"
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Settings</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={expandAll}
            className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-100"
          >
            Expand all
          </button>
          <button
            onClick={collapseAll}
            className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-100"
          >
            Collapse all
          </button>
          {hasChanges && (
            <button
              onClick={handleSave}
              className="bg-green-600 text-white px-4 py-1.5 rounded hover:bg-green-700 font-semibold text-sm"
              disabled={isSaving}
            >
              {isSaving
                ? 'Saving...'
                : `Save ${Object.keys(pendingChanges).length} Change${
                    Object.keys(pendingChanges).length > 1 ? 's' : ''
                  }`}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
          {success}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8">Loading settings...</div>
      ) : (
        <div className="space-y-4">
          <CollapsibleSection
            id="settings-feedback"
            title="Feedback Settings"
            open={feedbackOpen}
            onToggle={setFeedbackOpen}
          >
            <FeedbackSettingsAdmin />
          </CollapsibleSection>

          <CollapsibleSection
            id="settings-prompts"
            title="Active Prompt Versions"
            open={promptsOpen}
            onToggle={setPromptsOpen}
          >
            <p className="text-gray-600 mb-4 text-sm">
              Select which prompt template version should be used for each system function.
            </p>
            <div className="space-y-4">
              {promptSettings.map(([key, setting]) => {
                const use = getPromptUseFromKey(key);
                const availableVersions = promptVersions[use] || [];
                const currentValue = getCurrentValue(key);
                const hasChanged = pendingChanges.hasOwnProperty(key);
                return (
                  <div key={key} className="border-b pb-4 last:border-b-0">
                    <label className="block font-semibold mb-2">
                      {formatUseName(use)}
                      {hasChanged && (
                        <span className="ml-2 text-xs bg-yellow-200 text-yellow-800 px-2 py-1 rounded">
                          Modified
                        </span>
                      )}
                    </label>
                    <div className="flex items-center gap-4">
                      <select
                        value={currentValue}
                        onChange={e => handleChange(key, e.target.value)}
                        className="border rounded px-3 py-2 flex-1 max-w-md"
                      >
                        {availableVersions.length === 0 && (
                          <option value={currentValue}>{currentValue} (current)</option>
                        )}
                        {availableVersions.map(version => (
                          <option key={version} value={version}>
                            {version}
                          </option>
                        ))}
                      </select>
                      <span className="text-sm text-gray-500">
                        {availableVersions.length} version{availableVersions.length !== 1 ? 's' : ''} available
                      </span>
                    </div>
                    {setting.description && (
                      <p className="text-xs text-gray-500 mt-1">{setting.description}</p>
                    )}
                  </div>
                );
              })}
              {promptSettings.length === 0 && (
                <div className="text-center py-4 text-gray-500">No prompt settings configured</div>
              )}
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            id="settings-logs"
            title="Log Settings"
            open={logsOpen}
            onToggle={setLogsOpen}
          >
            {logSettings.length === 0 ? (
              <div className="text-sm text-gray-500">No log settings configured.</div>
            ) : (
              renderKeyValueSection(logSettings)
            )}
          </CollapsibleSection>

          <CollapsibleSection
            id="settings-other"
            title="Other Settings"
            open={otherOpen}
            onToggle={setOtherOpen}
          >
            {otherSettings.length === 0 ? (
              <div className="text-sm text-gray-500">No other settings configured.</div>
            ) : (
              renderKeyValueSection(otherSettings)
            )}
          </CollapsibleSection>

          {hasChanges && (
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPendingChanges({})}
                className="px-4 py-2 border rounded hover:bg-gray-100"
                disabled={isSaving}
              >
                Cancel Changes
              </button>
              <button
                onClick={handleSave}
                className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 font-semibold"
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
