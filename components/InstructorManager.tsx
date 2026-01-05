import React, { useState, useEffect } from 'react';
import { api } from '../services/apiClient';
import { AdminUser } from '../types';

interface InstructorManagerProps {
  user: AdminUser | null | undefined;
}

interface Instructor {
  id: string;
  who: string;
  email: string;
  superuser: boolean;
  admin_access: string[];
  created_at?: string;
}

const AVAILABLE_PERMISSIONS = [
  { id: 'caseprep', label: 'Case Prep' },
  { id: 'personas', label: 'Personas' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'models', label: 'Models' },
  { id: 'settings', label: 'Settings' },
  { id: 'instructors', label: 'Instructors' },
];

const InstructorManager: React.FC<InstructorManagerProps> = ({ user }) => {
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingInstructor, setEditingInstructor] = useState<Instructor | null>(null);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    who: '',
    superuser: false,
    admin_access: [] as string[],
  });

  useEffect(() => {
    fetchInstructors();
  }, []);

  const fetchInstructors = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get('/admins');
      if (response.error) {
        setError(response.error.message);
      } else {
        setInstructors(response.data || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch instructors');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingInstructor(null);
    setFormData({
      email: '',
      password: '',
      who: '',
      superuser: false,
      admin_access: [],
    });
    setShowModal(true);
  };

  const handleEdit = (instructor: Instructor) => {
    setEditingInstructor(instructor);
    setFormData({
      email: instructor.email,
      password: '',
      who: instructor.who,
      superuser: instructor.superuser,
      admin_access: instructor.admin_access || [],
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      if (editingInstructor) {
        // Update existing instructor
        const updateData: any = {
          who: formData.who,
          email: formData.email,
          superuser: formData.superuser,
          admin_access: formData.admin_access,
        };
        if (formData.password) {
          updateData.password = formData.password;
        }
        const response = await api.patch(`/admins/${editingInstructor.id}`, updateData);
        if (response.error) {
          setError(response.error.message || response.error);
          return;
        }
      } else {
        // Create new instructor
        if (!formData.password) {
          setError('Password is required for new instructors');
          return;
        }
        const response = await api.post('/admins', formData);
        if (response.error) {
          setError(response.error.message || response.error);
          return;
        }
      }

      setShowModal(false);
      fetchInstructors();
    } catch (err: any) {
      setError(err.message || 'Failed to save instructor');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this instructor? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await api.delete(`/admins/${id}`);
      if (response.error) {
        setError(response.error.message || response.error);
      } else {
        fetchInstructors();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete instructor');
    }
  };

  const togglePermission = (permission: string) => {
    setFormData(prev => ({
      ...prev,
      admin_access: prev.admin_access.includes(permission)
        ? prev.admin_access.filter(p => p !== permission)
        : [...prev.admin_access, permission]
    }));
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Instructor Management</h2>
          <p className="text-sm text-gray-500 mt-1">
            Manage admin accounts and permissions
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
        >
          Add Instructor
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* Instructors Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Role
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Permissions
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-6 py-4 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : instructors.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-4 text-center text-gray-500">
                  No instructors found
                </td>
              </tr>
            ) : (
              instructors.map((instructor) => (
                <tr key={instructor.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {instructor.who}
                      {instructor.id === user?.id && (
                        <span className="ml-2 text-xs text-gray-500">(You)</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-600">{instructor.email}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {instructor.superuser ? (
                      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">
                        Superuser
                      </span>
                    ) : (
                      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                        Instructor
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {instructor.superuser ? (
                      <span className="text-sm text-gray-500">Full Access</span>
                    ) : instructor.admin_access.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {instructor.admin_access.map(perm => (
                          <span key={perm} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded">
                            {perm}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400">Base Access Only</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleEdit(instructor)}
                      className="text-blue-600 hover:text-blue-900 mr-4"
                    >
                      Edit
                    </button>
                    {instructor.id !== user?.id && (
                      <button
                        onClick={() => handleDelete(instructor.id)}
                        className="text-red-600 hover:text-red-900"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal for Create/Edit */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">
              {editingInstructor ? 'Edit Instructor' : 'Add New Instructor'}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={formData.who}
                  onChange={(e) => setFormData({ ...formData, who: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Password {editingInstructor && <span className="text-gray-500">(leave blank to keep current)</span>}
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  required={!editingInstructor}
                />
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="superuser"
                  checked={formData.superuser}
                  onChange={(e) => setFormData({ ...formData, superuser: e.target.checked })}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="superuser" className="ml-2 block text-sm text-gray-900">
                  Superuser (full access to all functions)
                </label>
              </div>

              {!formData.superuser && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Additional Permissions
                  </label>
                  <div className="space-y-2">
                    {AVAILABLE_PERMISSIONS.map(perm => (
                      <div key={perm.id} className="flex items-center">
                        <input
                          type="checkbox"
                          id={perm.id}
                          checked={formData.admin_access.includes(perm.id)}
                          onChange={() => togglePermission(perm.id)}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <label htmlFor={perm.id} className="ml-2 block text-sm text-gray-700">
                          {perm.label}
                        </label>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    Base access (Chats, Assignments, Sections, Cases) is always included
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  {editingInstructor ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default InstructorManager;
