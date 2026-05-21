import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/apiClient';

interface LogFile {
  filename: string;
  type: 'chat' | 'eval' | 'casewriter';
  timestamp: string;
  studentId: string;
  caseId: string;
  size: number;
}

interface LoggingSettings {
  log_case_chat_prompts: number;
  log_evaluation_prompts: number;
  max_log_files: number;
  log_with_full_case_context: boolean;
}

type FilterType = 'all' | 'chat' | 'eval' | 'casewriter';

export const LoggingManager: React.FC = () => {
  const [settings, setSettings] = useState<LoggingSettings>({
    log_case_chat_prompts: 0,
    log_evaluation_prompts: 0,
    max_log_files: 100,
    log_with_full_case_context: false
  });
  const [logFiles, setLogFiles] = useState<LogFile[]>([]);
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Pending changes for settings
  const [pendingSettings, setPendingSettings] = useState<Partial<LoggingSettings>>({});

  const fetchSettings = useCallback(async () => {
    try {
      const response = await api.get('/logs/settings');
      if (response.data) {
        setSettings(response.data);
      }
    } catch (err: any) {
      console.error('Failed to fetch logging settings:', err);
      setError(err.message || 'Failed to fetch settings');
    }
  }, []);

  const fetchLogFiles = useCallback(async () => {
    setIsLoading(true);
    try {
      const filterParam = filter !== 'all' ? `?filter=${filter}` : '';
      const response = await api.get(`/logs${filterParam}`);
      if (response.data) {
        setLogFiles(response.data);
      }
    } catch (err: any) {
      console.error('Failed to fetch log files:', err);
      setError(err.message || 'Failed to fetch log files');
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchSettings();
    fetchLogFiles();
  }, [fetchSettings, fetchLogFiles]);

  const handleSettingChange = (key: keyof LoggingSettings, value: number | boolean) => {
    setPendingSettings(prev => ({ ...prev, [key]: value }));
  };

  const saveSettings = async () => {
    if (Object.keys(pendingSettings).length === 0) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await api.patch('/logs/settings', pendingSettings);
      setPendingSettings({});
      await fetchSettings();
      setSuccess('Settings saved successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const viewFile = async (filename: string) => {
    setSelectedFile(filename);
    setIsLoadingContent(true);
    setFileContent('');

    try {
      const response = await api.get(`/logs/${encodeURIComponent(filename)}`);
      if (response.data?.content) {
        setFileContent(response.data.content);
      }
    } catch (err: any) {
      setFileContent(`Error loading file: ${err.message}`);
    } finally {
      setIsLoadingContent(false);
    }
  };

  const downloadFile = () => {
    if (!selectedFile || !fileContent) return;

    const blob = new Blob([fileContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = selectedFile;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const toggleFileSelection = (filename: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
      return next;
    });
  };

  const selectAllFiles = () => {
    if (selectedFiles.size === logFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(logFiles.map(f => f.filename)));
    }
  };

  const deleteSelectedFiles = async () => {
    if (selectedFiles.size === 0) return;

    const confirmMsg = selectedFiles.size === 1
      ? 'Delete this log file?'
      : `Delete ${selectedFiles.size} log files?`;

    if (!window.confirm(confirmMsg)) return;

    try {
      await api.post('/logs/delete-batch', { filenames: Array.from(selectedFiles) });
      setSelectedFiles(new Set());
      if (selectedFile && selectedFiles.has(selectedFile)) {
        setSelectedFile(null);
        setFileContent('');
      }
      await fetchLogFiles();
      setSuccess(`Deleted ${selectedFiles.size} file(s)`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to delete files');
    }
  };

  const getDisplayValue = (key: keyof LoggingSettings): number | boolean => {
    return pendingSettings[key] !== undefined ? pendingSettings[key]! : settings[key];
  };

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatTimestamp = (timestamp: string): string => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return timestamp;
    }
  };

  const handleRefresh = async () => {
    setError(null);
    await Promise.all([fetchSettings(), fetchLogFiles()]);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Prompt Logging</h2>
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-2 text-sm border rounded hover:bg-gray-50"
        >
          <svg className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-500 hover:text-red-700">&times;</button>
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-50 text-green-700 rounded-lg">
          {success}
        </div>
      )}

      {/* Settings Section */}
      <div className="bg-white rounded-lg shadow mb-6 p-4">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Logging Configuration</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Chat prompts to log (countdown)
            </label>
            <input
              type="number"
              min="0"
              value={getDisplayValue('log_case_chat_prompts') as number}
              onChange={(e) => handleSettingChange('log_case_chat_prompts', parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-xs text-gray-500 mt-1">Decrements after each logged chat turn</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Evaluation prompts to log (countdown)
            </label>
            <input
              type="number"
              min="0"
              value={getDisplayValue('log_evaluation_prompts') as number}
              onChange={(e) => handleSettingChange('log_evaluation_prompts', parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-xs text-gray-500 mt-1">Decrements after each logged evaluation</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Max log files
            </label>
            <input
              type="number"
              min="1"
              value={getDisplayValue('max_log_files') as number}
              onChange={(e) => handleSettingChange('max_log_files', parseInt(e.target.value) || 100)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-xs text-gray-500 mt-1">Logging stops when limit reached</p>
          </div>

          <div className="flex items-center">
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={getDisplayValue('log_with_full_case_context') as boolean}
                onChange={(e) => handleSettingChange('log_with_full_case_context', e.target.checked)}
                className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
              />
              <span className="ml-2 text-sm font-medium text-gray-700">Include full case context</span>
            </label>
            <p className="text-xs text-gray-500 ml-6">If unchecked, case content is hidden in logs</p>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={saveSettings}
            disabled={isSaving || Object.keys(pendingSettings).length === 0}
            className={`px-4 py-2 rounded-lg text-white ${
              isSaving || Object.keys(pendingSettings).length === 0
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-purple-600 hover:bg-purple-700'
            }`}
          >
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      {/* Log Files Section */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Log Files ({logFiles.length})</h3>

          <div className="flex gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 text-sm rounded-lg ${
                filter === 'all' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('chat')}
              className={`px-3 py-1 text-sm rounded-lg ${
                filter === 'chat' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setFilter('eval')}
              className={`px-3 py-1 text-sm rounded-lg ${
                filter === 'eval' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Eval
            </button>
            <button
              onClick={() => setFilter('casewriter')}
              className={`px-3 py-1 text-sm rounded-lg ${
                filter === 'casewriter' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Case Writer
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-gray-500">Loading log files...</div>
        ) : logFiles.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No log files found</div>
        ) : (
          <>
            <div className="flex justify-between items-center mb-2">
              <label className="flex items-center text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={selectedFiles.size === logFiles.length && logFiles.length > 0}
                  onChange={selectAllFiles}
                  className="w-4 h-4 mr-2"
                />
                Select all
              </label>
              {selectedFiles.size > 0 && (
                <button
                  onClick={deleteSelectedFiles}
                  className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200"
                >
                  Delete Selected ({selectedFiles.size})
                </button>
              )}
            </div>

            <div className="border rounded-lg overflow-hidden max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="w-8 px-2 py-2"></th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Type</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Timestamp</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Student / Project</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Case / Step</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {logFiles.map((file) => (
                    <tr
                      key={file.filename}
                      onClick={() => viewFile(file.filename)}
                      className={`cursor-pointer hover:bg-gray-50 ${
                        selectedFile === file.filename ? 'bg-purple-50' : ''
                      }`}
                    >
                      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedFiles.has(file.filename)}
                          onChange={() => toggleFileSelection(file.filename)}
                          className="w-4 h-4"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 text-xs rounded-full ${
                          file.type === 'chat' ? 'bg-blue-100 text-blue-700'
                            : file.type === 'eval' ? 'bg-green-100 text-green-700'
                            : file.type === 'casewriter' ? 'bg-amber-100 text-amber-800'
                            : 'bg-gray-100 text-gray-700'
                        }`}>
                          {file.type === 'casewriter' ? 'CASE WRITER' : file.type.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-600">{formatTimestamp(file.timestamp)}</td>
                      <td className="px-3 py-2 text-gray-600 font-mono text-xs">{file.studentId}</td>
                      <td className="px-3 py-2 text-gray-600">{file.caseId}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{formatBytes(file.size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* File Content Viewer */}
        {selectedFile && (
          <div className="mt-4 border-t pt-4">
            <div className="flex justify-between items-center mb-2">
              <h4 className="font-medium text-gray-800">{selectedFile}</h4>
              <button
                onClick={downloadFile}
                disabled={!fileContent || isLoadingContent}
                className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Download
              </button>
            </div>
            {isLoadingContent ? (
              <div className="text-center py-4 text-gray-500">Loading content...</div>
            ) : (
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-auto max-h-96 text-xs font-mono whitespace-pre-wrap">
                {fileContent}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default LoggingManager;
