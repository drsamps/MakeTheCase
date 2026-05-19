import React, { useEffect, useState } from 'react';
import { getApiBaseUrl } from '../../services/apiClient';

interface Category {
  id: number;
  name: string;
  description: string | null;
  sort_order: number;
  active: number;
}

function getActiveToken(): string | null {
  return localStorage.getItem('admin_auth_token') || localStorage.getItem('student_auth_token');
}

const FeedbackCategoriesAdmin: React.FC = () => {
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const load = () => {
    const token = getActiveToken();
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`${getApiBaseUrl()}/feedback/categories/admin`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Request failed'))))
      .then(d => setItems(d.categories || []))
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const createOne = async () => {
    setError(null);
    const token = getActiveToken();
    if (!token) return;
    const name = newName.trim();
    if (!name) return;
    const response = await fetch(`${getApiBaseUrl()}/feedback/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, description: newDescription || null, sort_order: (items.length + 1) * 10 }),
    });
    if (!response.ok) {
      const d = await response.json().catch(() => ({}));
      setError(d?.error || 'Failed to create');
      return;
    }
    setNewName('');
    setNewDescription('');
    load();
  };

  const updateOne = async (id: number, patch: Partial<Category>) => {
    const token = getActiveToken();
    if (!token) return;
    const response = await fetch(`${getApiBaseUrl()}/feedback/categories/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      const d = await response.json().catch(() => ({}));
      setError(d?.error || 'Failed to update');
      return;
    }
    load();
  };

  const softDelete = async (id: number) => {
    if (!window.confirm('Deactivate this category? Existing submissions keep their label.')) return;
    const token = getActiveToken();
    if (!token) return;
    const response = await fetch(`${getApiBaseUrl()}/feedback/categories/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const d = await response.json().catch(() => ({}));
      setError(d?.error || 'Failed to delete');
      return;
    }
    load();
  };

  if (loading) return <div className="text-sm text-gray-500">Loading categories…</div>;

  return (
    <div className="space-y-3">
      {error && <div className="text-sm text-red-700">{error}</div>}

      <div className="space-y-2">
        {items.map(c => (
          <div
            key={c.id}
            className={`border rounded-md p-3 flex items-center gap-3 ${
              c.active ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50 opacity-70'
            }`}
          >
            <input
              type="number"
              value={c.sort_order}
              onChange={e => updateOne(c.id, { sort_order: Number(e.target.value) })}
              className="w-16 border border-gray-300 rounded px-2 py-1 text-sm"
            />
            <input
              type="text"
              defaultValue={c.name}
              onBlur={e => { if (e.target.value !== c.name) updateOne(c.id, { name: e.target.value }); }}
              className="border border-gray-300 rounded px-2 py-1 text-sm w-48"
            />
            <input
              type="text"
              defaultValue={c.description || ''}
              onBlur={e => { if ((e.target.value || null) !== (c.description || null)) updateOne(c.id, { description: e.target.value }); }}
              placeholder="(no description)"
              className="border border-gray-300 rounded px-2 py-1 text-sm flex-1"
            />
            <label className="text-sm flex items-center gap-1">
              <input
                type="checkbox"
                checked={!!c.active}
                onChange={e => updateOne(c.id, { active: e.target.checked ? 1 : 0 })}
              />
              Active
            </label>
            <button
              onClick={() => softDelete(c.id)}
              className="text-xs text-red-600 hover:text-red-800"
              disabled={!c.active}
              title={c.active ? 'Soft-delete' : 'Already inactive'}
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-200 pt-3">
        <h4 className="text-sm font-semibold text-gray-800 mb-2">Add category</h4>
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Name"
            className="border border-gray-300 rounded px-2 py-1 text-sm w-48"
          />
          <input
            type="text"
            value={newDescription}
            onChange={e => setNewDescription(e.target.value)}
            placeholder="Description (optional)"
            className="border border-gray-300 rounded px-2 py-1 text-sm flex-1"
          />
          <button
            onClick={createOne}
            disabled={!newName.trim()}
            className="px-3 py-1 text-sm font-semibold rounded text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
};

export default FeedbackCategoriesAdmin;
