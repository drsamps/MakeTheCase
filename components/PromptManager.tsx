import React, { useState, useEffect } from 'react';
import { api } from '../services/apiClient';

interface Prompt {
  id: number;
  use: string;
  version: string;
  description: string;
  prompt_template: string;
  enabled: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const PromptManager: React.FC = () => {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [promptUses, setPromptUses] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filterUse, setFilterUse] = useState<string>('all');
  const [showModal, setShowModal] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [formData, setFormData] = useState({
    use: '',
    version: '',
    description: '',
    prompt_template: '',
    enabled: true
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPrompts();
    fetchPromptUses();
  }, [filterUse]);

  const fetchPrompts = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const url = filterUse === 'all' ? '/prompts' : `/prompts?use=${filterUse}`;
      const response = await api.get(url);
      if (response.data) {
        setPrompts(response.data);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch prompts');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPromptUses = async () => {
    try {
      const response = await api.get('/prompts/uses');
      if (response.data) {
        setPromptUses(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch prompt uses:', err);
    }
  };

  const handleCreate = () => {
    setEditingPrompt(null);
    setFormData({
      use: '',
      version: '',
      description: '',
      prompt_template: '',
      enabled: true
    });
    setShowModal(true);
  };

  const handleEdit = (prompt: Prompt) => {
    setEditingPrompt(prompt);
    setFormData({
      use: prompt.use,
      version: prompt.version,
      description: prompt.description,
      prompt_template: prompt.prompt_template,
      enabled: prompt.enabled
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      if (editingPrompt) {
        // Update existing prompt
        await api.patch(`/prompts/${editingPrompt.id}`, {
          description: formData.description,
          prompt_template: formData.prompt_template,
          enabled: formData.enabled
        });
      } else {
        // Create new prompt
        await api.post('/prompts', formData);
      }
      setShowModal(false);
      fetchPrompts();
    } catch (err: any) {
      setError(err.message || 'Failed to save prompt');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (prompt: Prompt) => {
    if (!confirm(`Are you sure you want to delete "${prompt.use} / ${prompt.version}"?`)) {
      return;
    }
    try {
      await api.delete(`/prompts/${prompt.id}`);
      fetchPrompts();
    } catch (err: any) {
      alert(err.message || 'Failed to delete prompt');
    }
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Prompt Templates</h2>
        <button
          onClick={handleCreate}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          + Create Prompt
        </button>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="mb-4">
        <label className="mr-2 font-semibold">Filter by Use:</label>
        <select
          value={filterUse}
          onChange={(e) => setFilterUse(e.target.value)}
          className="border rounded px-3 py-2"
        >
          <option value="all">All</option>
          {promptUses.map(use => (
            <option key={use} value={use}>{use}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="text-center py-8">Loading prompts...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full bg-white border">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-2 border text-left">Use</th>
                <th className="px-4 py-2 border text-left">Version</th>
                <th className="px-4 py-2 border text-left">Description</th>
                <th className="px-4 py-2 border text-center">Status</th>
                <th className="px-4 py-2 border text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {prompts.map(prompt => (
                <tr key={prompt.id} className={prompt.is_active ? 'bg-green-50' : ''}>
                  <td className="px-4 py-2 border">{prompt.use}</td>
                  <td className="px-4 py-2 border font-mono">{prompt.version}</td>
                  <td className="px-4 py-2 border">{prompt.description}</td>
                  <td className="px-4 py-2 border text-center">
                    {prompt.is_active && (
                      <span className="bg-green-600 text-white px-2 py-1 rounded text-xs">
                        ACTIVE
                      </span>
                    )}
                    {!prompt.enabled && (
                      <span className="bg-gray-400 text-white px-2 py-1 rounded text-xs ml-1">
                        DISABLED
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 border text-center">
                    <button
                      onClick={() => handleEdit(prompt)}
                      className="bg-blue-500 text-white px-3 py-1 rounded mr-2 hover:bg-blue-600"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(prompt)}
                      className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600"
                      disabled={prompt.is_active}
                      title={prompt.is_active ? 'Cannot delete active prompt' : 'Delete prompt'}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {prompts.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    No prompts found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h3 className="text-xl font-bold mb-4">
                {editingPrompt ? 'Edit Prompt' : 'Create New Prompt'}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block font-semibold mb-1">
                    Use {editingPrompt && <span className="text-gray-500 text-sm">(read-only)</span>}
                  </label>
                  <input
                    type="text"
                    value={formData.use}
                    onChange={(e) => setFormData({ ...formData, use: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                    placeholder="e.g., case_outline_generation"
                    disabled={!!editingPrompt}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Where this prompt is used in the system
                  </p>
                </div>

                <div>
                  <label className="block font-semibold mb-1">
                    Version {editingPrompt && <span className="text-gray-500 text-sm">(read-only)</span>}
                  </label>
                  <input
                    type="text"
                    value={formData.version}
                    onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                    placeholder="e.g., default, aggressive, experimental"
                    disabled={!!editingPrompt}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Version identifier for this prompt variant
                  </p>
                </div>

                <div>
                  <label className="block font-semibold mb-1">Description</label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                    placeholder="Brief description of this prompt variant"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">Prompt Template</label>
                  <textarea
                    value={formData.prompt_template}
                    onChange={(e) => setFormData({ ...formData, prompt_template: e.target.value })}
                    className="w-full border rounded px-3 py-2 font-mono text-sm"
                    rows={15}
                    placeholder="Enter prompt template with {placeholder} variables..."
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Available variables: {'{case_content}'}, {'{notes_content}'}, {'{student_name}'}, {'{protagonist}'}, {'{case_title}'}, {'{chat_question}'}
                  </p>
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.enabled}
                    onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                    className="mr-2"
                  />
                  <label>Enabled</label>
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border rounded hover:bg-gray-100"
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
