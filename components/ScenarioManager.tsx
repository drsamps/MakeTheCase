import React, { useState, useEffect } from 'react';
import { api } from '../services/apiClient';
import { CaseScenario } from '../types';

interface ScenarioManagerProps {
  caseId: string;
  caseTitle: string;
  onClose: () => void;
  onScenariosChanged?: () => void;
}

interface FormData {
  scenario_name: string;
  protagonist: string;
  protagonist_initials: string;
  protagonist_role: string;
  chat_topic: string;
  chat_question: string;
  chat_time_limit: number;
  chat_time_warning: number;
  arguments_for: string;
  arguments_against: string;
  enabled: boolean;
  // Position tracking fields
  position_tracking_enabled: boolean;
  position_capture_method: string;
  position_options: string;  // Comma-separated for form input
  track_position_change: boolean;
}

const defaultFormData: FormData = {
  scenario_name: '',
  protagonist: '',
  protagonist_initials: '',
  protagonist_role: '',
  chat_topic: '',
  chat_question: '',
  chat_time_limit: 0,
  chat_time_warning: 5,
  arguments_for: '',
  arguments_against: '',
  enabled: true,
  // Position tracking defaults
  position_tracking_enabled: false,
  position_capture_method: 'explicit',
  position_options: 'for, against',
  track_position_change: true
};

export const ScenarioManager: React.FC<ScenarioManagerProps> = ({
  caseId,
  caseTitle,
  onClose,
  onScenariosChanged
}) => {
  const [scenarios, setScenarios] = useState<CaseScenario[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingScenario, setEditingScenario] = useState<CaseScenario | null>(null);
  const [formData, setFormData] = useState<FormData>(defaultFormData);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchScenarios();
  }, [caseId]);

  const fetchScenarios = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get(`/cases/${caseId}/scenarios`);
      if (response.data) {
        setScenarios(response.data);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch scenarios');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingScenario(null);
    setFormData(defaultFormData);
    setShowForm(true);
  };

  const handleEdit = (scenario: CaseScenario) => {
    setEditingScenario(scenario);
    // Parse position tracking from chat_options_override if present
    const override = scenario.chat_options_override || {};
    setFormData({
      scenario_name: scenario.scenario_name,
      protagonist: scenario.protagonist,
      protagonist_initials: scenario.protagonist_initials,
      protagonist_role: scenario.protagonist_role || '',
      chat_topic: scenario.chat_topic || '',
      chat_question: scenario.chat_question,
      chat_time_limit: scenario.chat_time_limit || 0,
      chat_time_warning: scenario.chat_time_warning || 5,
      arguments_for: scenario.arguments_for || '',
      arguments_against: scenario.arguments_against || '',
      enabled: scenario.enabled,
      // Position tracking from chat_options_override
      position_tracking_enabled: override.position_tracking_enabled ?? false,
      position_capture_method: override.position_capture_method || 'explicit',
      position_options: Array.isArray(override.position_options)
        ? override.position_options.join(', ')
        : 'for, against',
      track_position_change: override.track_position_change ?? true
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formData.scenario_name || !formData.protagonist || !formData.protagonist_initials || !formData.chat_question) {
      setError('Scenario name, protagonist, initials, and chat question are required');
      return;
    }

    // Build chat_options_override with position tracking settings
    const chatOptionsOverride: Record<string, any> = {};
    if (formData.position_tracking_enabled) {
      chatOptionsOverride.position_tracking_enabled = true;
      chatOptionsOverride.position_capture_method = formData.position_capture_method;
      chatOptionsOverride.position_options = formData.position_options
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      chatOptionsOverride.track_position_change = formData.track_position_change;
    }

    const payload = {
      scenario_name: formData.scenario_name,
      protagonist: formData.protagonist,
      protagonist_initials: formData.protagonist_initials,
      protagonist_role: formData.protagonist_role,
      chat_topic: formData.chat_topic,
      chat_question: formData.chat_question,
      chat_time_limit: formData.chat_time_limit,
      chat_time_warning: formData.chat_time_warning,
      arguments_for: formData.arguments_for,
      arguments_against: formData.arguments_against,
      enabled: formData.enabled,
      chat_options_override: Object.keys(chatOptionsOverride).length > 0 ? chatOptionsOverride : null
    };

    setIsSaving(true);
    setError(null);
    try {
      if (editingScenario) {
        await api.patch(`/cases/${caseId}/scenarios/${editingScenario.id}`, payload);
      } else {
        await api.post(`/cases/${caseId}/scenarios`, payload);
      }
      await fetchScenarios();
      setShowForm(false);
      onScenariosChanged?.();
    } catch (err: any) {
      setError(err.message || 'Failed to save scenario');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleEnabled = async (scenario: CaseScenario) => {
    try {
      await api.patch(`/cases/${caseId}/scenarios/${scenario.id}/toggle`);
      await fetchScenarios();
      onScenariosChanged?.();
    } catch (err: any) {
      setError(err.message || 'Failed to toggle scenario');
    }
  };

  const handleDelete = async (scenario: CaseScenario) => {
    if (!confirm(`Delete scenario "${scenario.scenario_name}"? This cannot be undone.`)) {
      return;
    }

    try {
      await api.delete(`/cases/${caseId}/scenarios/${scenario.id}`);
      await fetchScenarios();
      onScenariosChanged?.();
    } catch (err: any) {
      setError(err.message || 'Failed to delete scenario');
    }
  };

  const handleInputChange = (field: keyof FormData, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">Manage Scenarios</h2>
            <p className="text-sm text-gray-600">{caseTitle}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg border border-red-200">
              {error}
              <button onClick={() => setError(null)} className="float-right text-red-500">&times;</button>
            </div>
          )}

          {!showForm ? (
            <>
              {/* Scenario List */}
              <div className="mb-4 flex justify-between items-center">
                <span className="text-gray-600">{scenarios.length} scenario(s)</span>
                <button
                  onClick={handleCreate}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  + Add Scenario
                </button>
              </div>

              {isLoading ? (
                <div className="text-center py-8 text-gray-500">Loading scenarios...</div>
              ) : scenarios.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No scenarios defined. Click "Add Scenario" to create one.
                </div>
              ) : (
                <div className="space-y-3">
                  {scenarios.map((scenario, index) => (
                    <div
                      key={scenario.id}
                      className={`border rounded-lg p-4 ${scenario.enabled ? 'bg-white' : 'bg-gray-50 opacity-75'}`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400">#{index + 1}</span>
                            <h3 className="font-medium text-gray-800">{scenario.scenario_name}</h3>
                            {!scenario.enabled && (
                              <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded">Disabled</span>
                            )}
                            {scenario.chat_time_limit > 0 && (
                              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                                {scenario.chat_time_limit}min limit
                              </span>
                            )}
                            {scenario.chat_options_override?.position_tracking_enabled && (
                              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                                Position tracking
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 mt-1">
                            <span className="font-medium">{scenario.protagonist}</span>
                            {scenario.protagonist_role && (
                              <span className="text-gray-400"> - {scenario.protagonist_role}</span>
                            )}
                          </p>
                          <p className="text-sm text-gray-500 mt-1 line-clamp-2">{scenario.chat_question}</p>
                        </div>
                        <div className="flex gap-2 ml-4">
                          <button
                            onClick={() => handleEdit(scenario)}
                            className="px-3 py-1 text-sm border rounded hover:bg-gray-50"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleToggleEnabled(scenario)}
                            className={`px-3 py-1 text-sm rounded ${
                              scenario.enabled
                                ? 'bg-yellow-50 text-yellow-700 border border-yellow-300 hover:bg-yellow-100'
                                : 'bg-green-50 text-green-700 border border-green-300 hover:bg-green-100'
                            }`}
                          >
                            {scenario.enabled ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            onClick={() => handleDelete(scenario)}
                            className="px-3 py-1 text-sm bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            /* Scenario Form */
            <div className="space-y-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium">
                  {editingScenario ? 'Edit Scenario' : 'New Scenario'}
                </h3>
                <button
                  onClick={() => setShowForm(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  &larr; Back to list
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Scenario Name *</label>
                  <input
                    type="text"
                    value={formData.scenario_name}
                    onChange={(e) => handleInputChange('scenario_name', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="e.g., CEO Perspective"
                  />
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.enabled}
                      onChange={(e) => handleInputChange('enabled', e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-700">Enabled</span>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Protagonist Name *</label>
                  <input
                    type="text"
                    value={formData.protagonist}
                    onChange={(e) => handleInputChange('protagonist', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="e.g., Rocky Aoki"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Initials *</label>
                  <input
                    type="text"
                    value={formData.protagonist_initials}
                    onChange={(e) => handleInputChange('protagonist_initials', e.target.value.toUpperCase().slice(0, 5))}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="e.g., RA"
                    maxLength={5}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role/Title</label>
                  <input
                    type="text"
                    value={formData.protagonist_role}
                    onChange={(e) => handleInputChange('protagonist_role', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="e.g., CEO of Benihana"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Chat Topic</label>
                <input
                  type="text"
                  value={formData.chat_topic}
                  onChange={(e) => handleInputChange('chat_topic', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="e.g., Business expansion strategy"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Chat Question *</label>
                <textarea
                  value={formData.chat_question}
                  onChange={(e) => handleInputChange('chat_question', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  rows={3}
                  placeholder="The main question for students to discuss..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Time Limit (minutes)
                    <span className="text-gray-400 font-normal ml-1">0 = unlimited</span>
                  </label>
                  <input
                    type="number"
                    value={formData.chat_time_limit}
                    onChange={(e) => handleInputChange('chat_time_limit', parseInt(e.target.value) || 0)}
                    className="w-full border rounded-lg px-3 py-2"
                    min={0}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Warning Time (minutes before end)
                  </label>
                  <input
                    type="number"
                    value={formData.chat_time_warning}
                    onChange={(e) => handleInputChange('chat_time_warning', parseInt(e.target.value) || 5)}
                    className="w-full border rounded-lg px-3 py-2"
                    min={1}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Arguments For
                  <span className="text-gray-400 font-normal ml-1">(used in AI prompt, not shown to students)</span>
                </label>
                <textarea
                  value={formData.arguments_for}
                  onChange={(e) => handleInputChange('arguments_for', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  rows={3}
                  placeholder="Key arguments supporting one position..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Arguments Against
                  <span className="text-gray-400 font-normal ml-1">(used in AI prompt, not shown to students)</span>
                </label>
                <textarea
                  value={formData.arguments_against}
                  onChange={(e) => handleInputChange('arguments_against', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  rows={3}
                  placeholder="Key arguments supporting the opposing position..."
                />
              </div>

              {/* Position Tracking Section */}
              <div className="border-t pt-4 mt-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Position Tracking</h4>

                <label className="flex items-center gap-2 mb-3">
                  <input
                    type="checkbox"
                    checked={formData.position_tracking_enabled}
                    onChange={(e) => handleInputChange('position_tracking_enabled', e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700">Enable position tracking for this scenario</span>
                </label>

                {formData.position_tracking_enabled && (
                  <div className="ml-6 space-y-3 bg-blue-50 p-4 rounded-lg">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Capture Method</label>
                      <select
                        value={formData.position_capture_method}
                        onChange={(e) => handleInputChange('position_capture_method', e.target.value)}
                        className="w-full border rounded-lg px-3 py-2"
                      >
                        <option value="explicit">Student selects at chat start</option>
                        <option value="ai_inferred">AI infers from transcript</option>
                        <option value="instructor_manual">Instructor tags after chat</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Position Options
                        <span className="text-gray-400 font-normal ml-1">(comma-separated, at least 2)</span>
                      </label>
                      <input
                        type="text"
                        value={formData.position_options}
                        onChange={(e) => handleInputChange('position_options', e.target.value)}
                        className="w-full border rounded-lg px-3 py-2"
                        placeholder="for, against"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        These options will be shown to students (e.g., "Support expansion", "Oppose expansion")
                      </p>
                    </div>

                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={formData.track_position_change}
                        onChange={(e) => handleInputChange('track_position_change', e.target.checked)}
                        className="rounded"
                      />
                      <span className="text-sm text-gray-700">Track if position changes during chat</span>
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {showForm && (
          <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3">
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 border rounded-lg hover:bg-gray-100"
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : (editingScenario ? 'Update Scenario' : 'Create Scenario')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScenarioManager;
