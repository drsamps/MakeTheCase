import React, { useState, useEffect } from 'react';
import { api } from '../services/apiClient';
import { CaseScenario } from '../types';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ScenarioManagerProps {
  caseId: string;
  caseTitle: string;
  onClose: () => void;
  onScenariosChanged?: () => void;
}

interface Position {
  position_id: number;
  scenario_id: number;
  position_name: string;
  position: string;
  position_order: number;
  arguments_for?: string | null;
  arguments_against?: string | null;
  position_enabled: boolean;
}

interface PositionTemplate {
  template_id: number;
  template_name: string;
  template_description: string | null;
  is_system_template: boolean;
  items: { item_id: number; position_name: string; position: string; position_order: number }[];
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
  enabled: boolean;
}

interface PositionFormData {
  position_name: string;
  position: string;
  arguments_for: string;
  arguments_against: string;
  position_enabled: boolean;
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
  enabled: true
};

const defaultPositionFormData: PositionFormData = {
  position_name: '',
  position: '',
  arguments_for: '',
  arguments_against: '',
  position_enabled: true
};

// Sortable Position Item Component
interface SortablePositionProps {
  position: Position;
  index: number;
  onEdit: (position: Position) => void;
  onToggle: (position: Position) => void;
  onDelete: (position: Position) => void;
}

const SortablePositionItem: React.FC<SortablePositionProps> = ({
  position,
  index,
  onEdit,
  onToggle,
  onDelete
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: position.position_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 p-3 border rounded-lg border-l-4 ${
        position.position_enabled
          ? 'bg-white border-l-teal-400'
          : 'bg-gray-50 opacity-75 border-l-gray-300'
      } ${isDragging ? 'shadow-lg' : ''}`}
    >
      {/* Drag Handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-1 text-gray-400 hover:text-gray-600"
        title="Drag to reorder"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
        </svg>
      </button>
      <span className="text-xs text-gray-400 w-5">{index + 1}.</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-gray-800">{position.position_name}</span>
          {!position.position_enabled && (
            <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">disabled</span>
          )}
        </div>
        <p className="text-xs text-gray-500 truncate">{position.position}</p>
      </div>
      <div className="flex gap-1">
        <button
          onClick={() => onEdit(position)}
          className="px-2 py-1 text-xs border rounded hover:bg-gray-50"
        >
          Edit
        </button>
        <button
          onClick={() => onToggle(position)}
          className={`px-2 py-1 text-xs rounded ${
            position.position_enabled
              ? 'bg-yellow-50 text-yellow-700 border border-yellow-300 hover:bg-yellow-100'
              : 'bg-green-50 text-green-700 border border-green-300 hover:bg-green-100'
          }`}
        >
          {position.position_enabled ? 'Disable' : 'Enable'}
        </button>
        <button
          onClick={() => onDelete(position)}
          className="px-2 py-1 text-xs bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100"
        >
          Delete
        </button>
      </div>
    </div>
  );
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

  // Positions state
  const [positions, setPositions] = useState<Position[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);
  const [showPositionForm, setShowPositionForm] = useState(false);
  const [editingPosition, setEditingPosition] = useState<Position | null>(null);
  const [positionFormData, setPositionFormData] = useState<PositionFormData>(defaultPositionFormData);
  const [isSavingPosition, setIsSavingPosition] = useState(false);

  // Templates state
  const [templates, setTemplates] = useState<PositionTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [isApplyingTemplate, setIsApplyingTemplate] = useState(false);

  // Drag-and-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before starting drag
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    fetchScenarios();
    fetchTemplates();
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

  const fetchTemplates = async () => {
    setIsLoadingTemplates(true);
    try {
      const response = await api.get('/position-templates');
      if (response.data) {
        setTemplates(response.data);
      }
    } catch (err: any) {
      console.error('Failed to fetch templates:', err);
    } finally {
      setIsLoadingTemplates(false);
    }
  };

  const fetchPositions = async (scenarioId: number) => {
    setIsLoadingPositions(true);
    try {
      const response = await api.get(`/cases/${caseId}/scenarios/${scenarioId}/positions`);
      if (response.data) {
        setPositions(response.data);
      }
    } catch (err: any) {
      console.error('Failed to fetch positions:', err);
      setPositions([]);
    } finally {
      setIsLoadingPositions(false);
    }
  };

  const handleCreate = () => {
    setEditingScenario(null);
    setFormData(defaultFormData);
    setPositions([]);
    setShowForm(true);
  };

  const handleEdit = (scenario: CaseScenario) => {
    setEditingScenario(scenario);
    setFormData({
      scenario_name: scenario.scenario_name,
      protagonist: scenario.protagonist,
      protagonist_initials: scenario.protagonist_initials,
      protagonist_role: scenario.protagonist_role || '',
      chat_topic: scenario.chat_topic || '',
      chat_question: scenario.chat_question,
      chat_time_limit: scenario.chat_time_limit || 0,
      chat_time_warning: scenario.chat_time_warning || 5,
      enabled: scenario.enabled
    });
    fetchPositions(scenario.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formData.scenario_name || !formData.protagonist || !formData.protagonist_initials || !formData.chat_question) {
      setError('Scenario name, protagonist, initials, and chat question are required');
      return;
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
      enabled: formData.enabled
    };

    setIsSaving(true);
    setError(null);
    try {
      if (editingScenario) {
        await api.patch(`/cases/${caseId}/scenarios/${editingScenario.id}`, payload);
      } else {
        const response = await api.post(`/cases/${caseId}/scenarios`, payload);
        // Set editingScenario to the newly created scenario so positions can be added
        if (response.data) {
          setEditingScenario(response.data);
        }
      }
      await fetchScenarios();
      onScenariosChanged?.();
      // Don't close form - stay to add positions if this was a new scenario
      if (editingScenario) {
        setShowForm(false);
      }
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

  // Position handlers
  const handleCreatePosition = () => {
    setEditingPosition(null);
    setPositionFormData(defaultPositionFormData);
    setShowPositionForm(true);
  };

  const handleEditPosition = (position: Position) => {
    setEditingPosition(position);
    setPositionFormData({
      position_name: position.position_name,
      position: position.position,
      arguments_for: position.arguments_for || '',
      arguments_against: position.arguments_against || '',
      position_enabled: position.position_enabled
    });
    setShowPositionForm(true);
  };

  const handleSavePosition = async () => {
    if (!editingScenario) {
      setError('Please save the scenario first before adding positions');
      return;
    }

    if (!positionFormData.position_name || !positionFormData.position) {
      setError('Position name and description are required');
      return;
    }

    setIsSavingPosition(true);
    setError(null);
    try {
      const payload = {
        position_name: positionFormData.position_name,
        position: positionFormData.position,
        arguments_for: positionFormData.arguments_for || null,
        arguments_against: positionFormData.arguments_against || null,
        position_enabled: positionFormData.position_enabled
      };

      if (editingPosition) {
        await api.patch(`/cases/${caseId}/scenarios/${editingScenario.id}/positions/${editingPosition.position_id}`, payload);
      } else {
        await api.post(`/cases/${caseId}/scenarios/${editingScenario.id}/positions`, payload);
      }
      await fetchPositions(editingScenario.id);
      setShowPositionForm(false);
    } catch (err: any) {
      setError(err.message || 'Failed to save position');
    } finally {
      setIsSavingPosition(false);
    }
  };

  const handleDeletePosition = async (position: Position) => {
    if (!editingScenario) return;
    if (!confirm(`Delete position "${position.position_name}"?`)) return;

    try {
      await api.delete(`/cases/${caseId}/scenarios/${editingScenario.id}/positions/${position.position_id}`);
      await fetchPositions(editingScenario.id);
    } catch (err: any) {
      setError(err.message || 'Failed to delete position');
    }
  };

  const handleTogglePositionEnabled = async (position: Position) => {
    if (!editingScenario) return;
    try {
      await api.patch(`/cases/${caseId}/scenarios/${editingScenario.id}/positions/${position.position_id}/toggle`);
      await fetchPositions(editingScenario.id);
    } catch (err: any) {
      setError(err.message || 'Failed to toggle position');
    }
  };

  const handleApplyTemplate = async (template: PositionTemplate) => {
    if (!editingScenario) {
      setError('Please save the scenario first before applying a template');
      return;
    }

    const confirmMsg = positions.length > 0
      ? `Apply "${template.template_name}" template? This will add ${template.items.length} position(s). Existing positions will be kept.`
      : `Apply "${template.template_name}" template? This will add ${template.items.length} position(s).`;

    if (!confirm(confirmMsg)) return;

    setIsApplyingTemplate(true);
    setError(null);
    try {
      await api.post(`/position-templates/${template.template_id}/apply/${editingScenario.id}`, {
        clear_existing: false
      });
      await fetchPositions(editingScenario.id);
      setShowTemplateDropdown(false);
    } catch (err: any) {
      setError(err.message || 'Failed to apply template');
    } finally {
      setIsApplyingTemplate(false);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id || !editingScenario) {
      return;
    }

    const oldIndex = positions.findIndex(p => p.position_id === active.id);
    const newIndex = positions.findIndex(p => p.position_id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    // Optimistically update the UI
    const reorderedPositions = arrayMove(positions, oldIndex, newIndex);
    setPositions(reorderedPositions);

    // Send reorder to server
    try {
      const order = reorderedPositions.map(p => p.position_id);
      await api.patch(`/cases/${caseId}/scenarios/${editingScenario.id}/positions/reorder`, { order });
    } catch (err: any) {
      // Revert on error
      setError(err.message || 'Failed to reorder positions');
      await fetchPositions(editingScenario.id);
    }
  };

  const handlePositionInputChange = (field: keyof PositionFormData, value: string | boolean) => {
    setPositionFormData(prev => ({ ...prev, [field]: value }));
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
          ) : showPositionForm ? (
            /* Position Form */
            <div className="space-y-4">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-lg font-medium">
                  {editingPosition ? 'Edit Position' : 'Define Position'}
                </h3>
                <button
                  onClick={() => setShowPositionForm(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  &larr; Back to scenario
                </button>
              </div>

              {/* Chat Question Context */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                <div className="text-xs font-medium text-blue-600 uppercase tracking-wide mb-1">Chat Question</div>
                <p className="text-sm text-blue-900">{formData.chat_question || 'No chat question defined'}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Position Name *</label>
                <input
                  type="text"
                  value={positionFormData.position_name}
                  onChange={(e) => handlePositionInputChange('position_name', e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '_'))}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="e.g., agree, disagree, support"
                />
                <p className="text-xs text-gray-500 mt-1">Short identifier (lowercase, underscores allowed)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Position Description *</label>
                <textarea
                  value={positionFormData.position}
                  onChange={(e) => handlePositionInputChange('position', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  rows={2}
                  placeholder="e.g., I agree with the recommendation to close the factory"
                />
                <p className="text-xs text-gray-500 mt-1">Full description shown to students</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Arguments For This Position
                  <span className="text-gray-400 font-normal ml-1">(used in AI prompt)</span>
                </label>
                <textarea
                  value={positionFormData.arguments_for}
                  onChange={(e) => handlePositionInputChange('arguments_for', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  rows={3}
                  placeholder="Key arguments supporting this position..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Arguments Against This Position
                  <span className="text-gray-400 font-normal ml-1">(used to challenge students)</span>
                </label>
                <textarea
                  value={positionFormData.arguments_against}
                  onChange={(e) => handlePositionInputChange('arguments_against', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  rows={3}
                  placeholder="Counter-arguments to probe and challenge..."
                />
              </div>

              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={positionFormData.position_enabled}
                    onChange={(e) => handlePositionInputChange('position_enabled', e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700">Position is enabled (available for selection)</span>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  onClick={() => setShowPositionForm(false)}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-100"
                  disabled={isSavingPosition}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSavePosition}
                  disabled={isSavingPosition}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSavingPosition ? 'Saving...' : (editingPosition ? 'Update Position' : 'Add Position')}
                </button>
              </div>
            </div>
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

              {/* Save Scenario Button (for new scenarios) */}
              {!editingScenario && (
                <div className="flex justify-end pt-2">
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isSaving ? 'Saving...' : 'Save Scenario to Add Positions'}
                  </button>
                </div>
              )}

              {/* Defined Positions Section - only show for existing scenarios */}
              {editingScenario && (
                <div className="border-t pt-4 mt-4">
                  {/* Hierarchy breadcrumb */}
                  <div className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                    <span>{caseTitle}</span>
                    <span>→</span>
                    <span className="font-medium text-gray-700">{editingScenario.scenario_name}</span>
                    <span>→</span>
                    <span>Positions</span>
                  </div>
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="text-sm font-semibold text-gray-700">Defined Positions</h4>
                    <div className="flex gap-2 relative">
                      <div className="relative">
                        <button
                          onClick={() => setShowTemplateDropdown(!showTemplateDropdown)}
                          disabled={isApplyingTemplate || isLoadingTemplates}
                          className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 flex items-center gap-1"
                        >
                          Apply Template
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {showTemplateDropdown && (
                          <div className="absolute right-0 mt-1 w-64 bg-white border rounded-lg shadow-lg z-10">
                            <div className="p-2 border-b">
                              <span className="text-xs text-gray-500">Select a template to apply</span>
                            </div>
                            {templates.length === 0 ? (
                              <div className="p-3 text-sm text-gray-500">No templates available</div>
                            ) : (
                              <div className="max-h-48 overflow-y-auto">
                                {templates.map(template => (
                                  <button
                                    key={template.template_id}
                                    onClick={() => handleApplyTemplate(template)}
                                    className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-b-0"
                                  >
                                    <div className="text-sm font-medium">{template.template_name}</div>
                                    <div className="text-xs text-gray-500">
                                      {template.items.length} position(s)
                                      {template.is_system_template && ' • System template'}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                            <div className="p-2 border-t">
                              <button
                                onClick={() => setShowTemplateDropdown(false)}
                                className="text-xs text-gray-500 hover:text-gray-700"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={handleCreatePosition}
                        className="px-3 py-1.5 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700"
                      >
                        + Add Position
                      </button>
                    </div>
                  </div>

                  {isLoadingPositions ? (
                    <div className="text-center py-4 text-gray-500 text-sm">Loading positions...</div>
                  ) : positions.length === 0 ? (
                    <div className="bg-gray-50 rounded-lg p-4 text-center">
                      <p className="text-sm text-gray-600">No positions defined yet.</p>
                      <p className="text-xs text-gray-500 mt-1">
                        Use "Apply Template" for quick setup or "Add Position" to define custom positions.
                      </p>
                      <p className="text-xs text-gray-400 mt-2">
                        Note: Defining positions is optional, but necessary if you want to track student positions on the chat question.
                      </p>
                    </div>
                  ) : (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={positions.map(p => p.position_id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="space-y-2">
                          {positions.map((position, index) => (
                            <SortablePositionItem
                              key={position.position_id}
                              position={position}
                              index={index}
                              onEdit={handleEditPosition}
                              onToggle={handleTogglePositionEnabled}
                              onDelete={handleDeletePosition}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {showForm && !showPositionForm && editingScenario && (
          <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3">
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 border rounded-lg hover:bg-gray-100"
              disabled={isSaving}
            >
              Close
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Update Scenario'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScenarioManager;
