import React, { useState, useEffect } from 'react';
import { api } from '../services/apiClient';

interface Student {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string | null;
  section_id: string | null;
  favorite_persona: string | null;
  created_at: string;
  finished_at: string | null;
}

interface Section {
  section_id: string;
  section_title: string;
  year_term: string;
}

interface StudentSection {
  section_id: string;
  section_title: string;
  year_term: string;
  is_primary: boolean;
}

type SortField = 'id' | 'full_name' | 'email' | 'section_id';
type SortDirection = 'asc' | 'desc';

const StudentManager: React.FC = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [resetPasswordStudent, setResetPasswordStudent] = useState<Student | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [formData, setFormData] = useState({
    id: '',
    first_name: '',
    last_name: '',
    full_name: '',
    email: '',
    password: '',
    section_ids: [] as string[],
  });
  const [originalSectionIds, setOriginalSectionIds] = useState<string[]>([]);

  // Search, filter, and sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('full_name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Pagination state
  const [pageSize, setPageSize] = useState<number>(20);
  const [currentPage, setCurrentPage] = useState(1);

  // Helper function to format student ID for display
  const formatStudentId = (id: string): string => {
    if (id.startsWith('cas:')) {
      return id; // Show full cas: IDs
    }
    // For non-cas IDs, show only first 5 characters + ellipsis
    return id.length > 5 ? `${id.substring(0, 5)}...` : id;
  };

  // Helper function to determine if we should show both name formats
  const shouldShowBothNames = (student: Student): boolean => {
    if (!student.first_name || !student.last_name) {
      return false; // Don't show if either is missing
    }
    const constructedName = `${student.first_name} ${student.last_name}`;
    return student.full_name !== constructedName;
  };

  useEffect(() => {
    fetchStudents();
    fetchSections();
  }, []);

  const fetchStudents = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get('/students');
      if (response.error) {
        setError(response.error.message);
      } else {
        setStudents(response.data || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch students');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSections = async () => {
    try {
      const response = await api.get('/sections');
      if (!response.error) {
        setSections(response.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch sections:', err);
    }
  };

  // Get section title for display
  const getSectionTitle = (sectionId: string | null): string => {
    if (!sectionId) return '';
    const section = sections.find(s => s.section_id === sectionId);
    return section ? section.section_title : sectionId;
  };

  // Handle sort toggle
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Filter and sort students
  const filteredAndSortedStudents = React.useMemo(() => {
    let result = [...students];

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(student =>
        student.id.toLowerCase().includes(query) ||
        student.full_name.toLowerCase().includes(query) ||
        (student.email && student.email.toLowerCase().includes(query)) ||
        (student.first_name && student.first_name.toLowerCase().includes(query)) ||
        (student.last_name && student.last_name.toLowerCase().includes(query))
      );
    }

    // Apply section filter
    if (sectionFilter !== 'all') {
      if (sectionFilter === 'unassigned') {
        result = result.filter(student => !student.section_id);
      } else {
        result = result.filter(student => student.section_id === sectionFilter);
      }
    }

    // Apply sort
    result.sort((a, b) => {
      let aVal: string = '';
      let bVal: string = '';

      switch (sortField) {
        case 'id':
          aVal = a.id.toLowerCase();
          bVal = b.id.toLowerCase();
          break;
        case 'full_name':
          aVal = a.full_name.toLowerCase();
          bVal = b.full_name.toLowerCase();
          break;
        case 'email':
          aVal = (a.email || '').toLowerCase();
          bVal = (b.email || '').toLowerCase();
          break;
        case 'section_id':
          aVal = getSectionTitle(a.section_id).toLowerCase();
          bVal = getSectionTitle(b.section_id).toLowerCase();
          break;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [students, searchQuery, sectionFilter, sortField, sortDirection, sections]);

  // Sort indicator component
  const SortIndicator: React.FC<{ field: SortField }> = ({ field }) => {
    if (sortField !== field) {
      return <span className="ml-1 text-gray-300">↕</span>;
    }
    return <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  // Pagination calculations
  const totalFiltered = filteredAndSortedStudents.length;
  const totalPages = pageSize === 0 ? 1 : Math.ceil(totalFiltered / pageSize);
  const startIndex = pageSize === 0 ? 0 : (currentPage - 1) * pageSize;
  const endIndex = pageSize === 0 ? totalFiltered : Math.min(startIndex + pageSize, totalFiltered);
  const paginatedStudents = pageSize === 0
    ? filteredAndSortedStudents
    : filteredAndSortedStudents.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sectionFilter, pageSize]);

  const handleCreate = () => {
    setEditingStudent(null);
    setFormData({
      id: '',
      first_name: '',
      last_name: '',
      full_name: '',
      email: '',
      password: '',
      section_ids: [],
    });
    setOriginalSectionIds([]);
    setShowModal(true);
  };

  const handleEdit = async (student: Student) => {
    setEditingStudent(student);

    // Fetch student's current sections
    let sectionIds: string[] = [];
    try {
      const response = await api.get(`/students/${student.id}/sections`);
      if (!response.error && response.data) {
        sectionIds = response.data.map((s: StudentSection) => s.section_id);
      }
    } catch (err) {
      // Fall back to legacy section_id if junction table query fails
      if (student.section_id) {
        sectionIds = [student.section_id];
      }
    }

    setFormData({
      id: student.id,
      first_name: student.first_name || '',
      last_name: student.last_name || '',
      full_name: student.full_name,
      email: student.email || '',
      password: '',
      section_ids: sectionIds,
    });
    setOriginalSectionIds(sectionIds);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      if (editingStudent) {
        // Update existing student basic info
        const updateData: any = {
          first_name: formData.first_name,
          last_name: formData.last_name,
          full_name: formData.full_name,
          email: formData.email,
        };
        if (formData.password) {
          updateData.password = formData.password;
        }
        const response = await api.patch(`/students/${editingStudent.id}`, updateData);
        if (response.error) {
          setError(response.error.message || response.error);
          return;
        }

        // Handle section changes
        const sectionsToAdd = formData.section_ids.filter(id => !originalSectionIds.includes(id));
        const sectionsToRemove = originalSectionIds.filter(id => !formData.section_ids.includes(id));

        // Add new sections
        for (const sectionId of sectionsToAdd) {
          const isFirst = formData.section_ids.indexOf(sectionId) === 0 && originalSectionIds.length === 0;
          await api.post(`/students/${editingStudent.id}/sections`, {
            section_id: sectionId,
            is_primary: isFirst
          });
        }

        // Remove sections
        for (const sectionId of sectionsToRemove) {
          await api.delete(`/students/${editingStudent.id}/sections/${sectionId}`);
        }
      } else {
        // Create new student
        if (!formData.id) {
          setError('Student ID is required for new students');
          return;
        }
        // Create student with first section as primary (for backward compat)
        const createData = {
          ...formData,
          section_id: formData.section_ids[0] || null
        };
        const response = await api.post('/students', createData);
        if (response.error) {
          setError(response.error.message || response.error);
          return;
        }

        // Add additional sections if more than one selected
        if (formData.section_ids.length > 1) {
          for (let i = 1; i < formData.section_ids.length; i++) {
            await api.post(`/students/${formData.id}/sections`, {
              section_id: formData.section_ids[i],
              is_primary: false
            });
          }
        }
      }

      setShowModal(false);
      fetchStudents();
    } catch (err: any) {
      setError(err.message || 'Failed to save student');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this student? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await api.delete(`/students/${id}`);
      if (response.error) {
        setError(response.error.message || response.error);
      } else {
        fetchStudents();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete student');
    }
  };

  const handleResetPassword = (student: Student) => {
    setResetPasswordStudent(student);
    setNewPassword('');
    setShowPasswordModal(true);
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPasswordStudent || !newPassword) return;

    try {
      const response = await api.post(`/students/${resetPasswordStudent.id}/reset-password`, {
        password: newPassword,
      });
      if (response.error) {
        setError(response.error.message || response.error);
      } else {
        setShowPasswordModal(false);
        setResetPasswordStudent(null);
        setNewPassword('');
        alert('Password reset successfully');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to reset password');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Student Management</h2>
          <p className="text-sm text-gray-500 mt-1">
            Manage student accounts and access
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleCreate}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            Add Student
          </button>
          
          {/* Refresh */}
          <button
            onClick={() => fetchStudents()}
            disabled={isLoading}
            className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg disabled:opacity-50 transition-colors"
            aria-label="Refresh students"
            title="Refresh students"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* Search and Filter Controls */}
      <div className="mb-4 flex flex-wrap gap-4 items-center">
        {/* Page Size Selector */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Show</label>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white text-sm"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={0}>All</option>
          </select>
        </div>

        {/* Search Input */}
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <input
              type="text"
              placeholder="Search by ID, name, or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 pl-10 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
            />
            <svg
              className="absolute left-3 top-2.5 h-5 w-5 text-gray-400"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                clipRule="evenodd"
              />
            </svg>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Section Filter */}
        <div className="min-w-[200px]">
          <select
            value={sectionFilter}
            onChange={(e) => setSectionFilter(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white"
          >
            <option value="all">All sections</option>
            <option value="unassigned">— Unassigned —</option>
            {sections.map((section) => (
              <option key={section.section_id} value={section.section_id}>
                {section.section_title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Pagination Controls */}
      <div className="mb-4 flex flex-wrap gap-4 items-center justify-between">
        {/* Results info */}
        <div className="text-sm text-gray-500">
          {totalFiltered === 0 ? (
            'No students found'
          ) : pageSize === 0 ? (
            `Showing all ${totalFiltered} of ${students.length} students`
          ) : (
            `Showing ${startIndex + 1}-${endIndex} of ${totalFiltered} students${totalFiltered !== students.length ? ` (${students.length} total)` : ''}`
          )}
        </div>

        {/* Page Navigation */}
        {pageSize > 0 && totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              title="First page"
            >
              ««
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="px-3 py-1 text-sm text-gray-600">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              className="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Last page"
            >
              »»
            </button>
          </div>
        )}
      </div>

      {/* Students Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleSort('id')}
              >
                ID <SortIndicator field="id" />
              </th>
              <th
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleSort('full_name')}
              >
                Name <SortIndicator field="full_name" />
              </th>
              <th
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleSort('email')}
              >
                Email <SortIndicator field="email" />
              </th>
              <th
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleSort('section_id')}
              >
                Section <SortIndicator field="section_id" />
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
            ) : paginatedStudents.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-4 text-center text-gray-500">
                  {students.length === 0 ? 'No students found' : 'No students match the current filters'}
                </td>
              </tr>
            ) : (
              paginatedStudents.map((student) => (
                <tr key={student.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900 font-mono" title={student.id}>
                      {formatStudentId(student.id)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{student.full_name}</div>
                    {shouldShowBothNames(student) && (
                      <div className="text-xs text-gray-500">
                        {student.first_name} {student.last_name}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-600">{student.email || '—'}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-600">
                      {student.section_id ? (
                        sections.find(s => s.section_id === student.section_id)?.section_title || student.section_id
                      ) : (
                        '—'
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleEdit(student)}
                      className="text-blue-600 hover:text-blue-900 mr-4"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleResetPassword(student)}
                      className="text-indigo-600 hover:text-indigo-900 mr-4"
                    >
                      Reset Password
                    </button>
                    <button
                      onClick={() => handleDelete(student.id)}
                      className="text-red-600 hover:text-red-900"
                    >
                      Delete
                    </button>
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
              {editingStudent ? 'Edit Student' : 'Add New Student'}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Student ID {!editingStudent && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="text"
                  value={formData.id}
                  onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  required={!editingStudent}
                  disabled={!!editingStudent}
                  placeholder="e.g., cas:netid or uuid"
                />
                {!editingStudent && (
                  <p className="text-xs text-gray-500 mt-1">
                    For CAS users, use format: cas:netid
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    First Name
                  </label>
                  <input
                    type="text"
                    value={formData.first_name}
                    onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Last Name
                  </label>
                  <input
                    type="text"
                    value={formData.last_name}
                    onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
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
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Password {editingStudent && <span className="text-gray-500">(leave blank to keep current)</span>}
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Sections
                </label>
                <div className="max-h-48 overflow-y-auto border border-gray-300 rounded-lg p-2 space-y-1">
                  {sections.length === 0 ? (
                    <div className="text-sm text-gray-500 p-2">No sections available</div>
                  ) : (
                    sections.map((section) => (
                      <label
                        key={section.section_id}
                        className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={formData.section_ids.includes(section.section_id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({
                                ...formData,
                                section_ids: [...formData.section_ids, section.section_id]
                              });
                            } else {
                              setFormData({
                                ...formData,
                                section_ids: formData.section_ids.filter(id => id !== section.section_id)
                              });
                            }
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700">
                          {section.section_title} ({section.year_term})
                        </span>
                      </label>
                    ))
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Select one or more sections. Most students will be in one section.
                </p>
              </div>

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
                  {editingStudent ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Password Reset Modal */}
      {showPasswordModal && resetPasswordStudent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4">Reset Password</h3>
            <p className="text-sm text-gray-600 mb-4">
              Reset password for <span className="font-semibold">{resetPasswordStudent.full_name}</span>
            </p>

            <form onSubmit={handlePasswordReset} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  New Password <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  required
                  minLength={6}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Minimum 6 characters
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowPasswordModal(false);
                    setResetPasswordStudent(null);
                    setNewPassword('');
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  Reset Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentManager;
