import React, { useState, useEffect } from 'react';
import { api } from '../services/apiClient';

interface Settings {
  [key: string]: {
    value: string;
    description: string;
  };
}

interface PromptVersions {
  [use: string]: string[];
}

export const SettingsManager: React.FC = () => {
  const [settings, setSettings] = useState<Settings>({});
  const [promptVersions, setPromptVersions] = useState<PromptVersions>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<{[key: string]: string}>({});

  useEffect(() => {
    fetchSettings();
    fetchPromptVersions();
  }, []);

  const fetchSettings = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get('/settings');
      if (response.data) {
        setSettings(response.data);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch settings');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPromptVersions = async () => {
    try {
      const response = await api.get('/prompts');
      if (response.data) {
        // Group prompts by use and collect versions
        const versionsByUse: PromptVersions = {};
        response.data.forEach((prompt: any) => {
          if (!versionsByUse[prompt.use]) {
            versionsByUse[prompt.use] = [];
          }
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
    setPendingChanges({
      ...pendingChanges,
      [key]: value
    });
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
      // Save all pending changes
      for (const [key, value] of Object.entries(pendingChanges)) {
        await api.patch(`/settings/${key}`, { setting_value: value });
      }

      setSuccess('Settings saved successfully!');
      setPendingChanges({});
      fetchSettings(); // Refresh to get updated values
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const getCurrentValue = (key: string): string => {
    return pendingChanges[key] ?? settings[key]?.value ?? '';
  };

  // Extract prompt-related settings
  const promptSettings = Object.entries(settings).filter(([key]) =>
    key.startsWith('active_prompt_')
  );

  // Extract other settings
  const otherSettings = Object.entries(settings).filter(([key]) =>
    !key.startsWith('active_prompt_')
  );

  const getPromptUseFromKey = (key: string): string => {
    return key.replace('active_prompt_', '');
  };

  const formatUseName = (use: string): string => {
    return use
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const hasChanges = Object.keys(pendingChanges).length > 0;

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Settings</h2>
        {hasChanges && (
          <button
            onClick={handleSave}
            className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 font-semibold"
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : `Save ${Object.keys(pendingChanges).length} Change${Object.keys(pendingChanges).length > 1 ? 's' : ''}`}
          </button>
        )}
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
        <div className="space-y-8">
          {/* Active Prompt Versions Section */}
          <div className="bg-white border rounded-lg p-6">
            <h3 className="text-xl font-semibold mb-4 pb-2 border-b">Active Prompt Versions</h3>
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
                        onChange={(e) => handleChange(key, e.target.value)}
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
                <div className="text-center py-4 text-gray-500">
                  No prompt settings configured
                </div>
              )}
            </div>
          </div>

          {/* Other Settings Section */}
          {otherSettings.length > 0 && (
            <div className="bg-white border rounded-lg p-6">
              <h3 className="text-xl font-semibold mb-4 pb-2 border-b">Other Settings</h3>

              <div className="space-y-4">
                {otherSettings.map(([key, setting]) => {
                  const currentValue = getCurrentValue(key);
                  const hasChanged = pendingChanges.hasOwnProperty(key);

                  return (
                    <div key={key} className="border-b pb-4 last:border-b-0">
                      <label className="block font-semibold mb-2">
                        {key}
                        {hasChanged && (
                          <span className="ml-2 text-xs bg-yellow-200 text-yellow-800 px-2 py-1 rounded">
                            Modified
                          </span>
                        )}
                      </label>
                      <input
                        type="text"
                        value={currentValue}
                        onChange={(e) => handleChange(key, e.target.value)}
                        className="border rounded px-3 py-2 w-full max-w-md"
                      />
                      {setting.description && (
                        <p className="text-xs text-gray-500 mt-1">{setting.description}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Save button at bottom */}
          {hasChanges && (
            <div className="flex justify-end">
              <button
                onClick={() => setPendingChanges({})}
                className="px-4 py-2 border rounded mr-2 hover:bg-gray-100"
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
