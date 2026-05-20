import React, { useState, useEffect } from 'react';
import { api } from '../services/apiClient';
import { AdminUser } from '../types';

interface InstructorManagerProps {
  user: AdminUser | null | undefined;
  mode: 'instructors' | 'admins';
}

// Admin from admins table
interface Admin {
  id: string;
  who: string;
  email: string;
  superuser: boolean;
  admin_access: string[];
  created_at?: string;
}

// Instructor from instructors table
interface Instructor {
  id: string;
  email: string;
  netid: string | null;
  auth_method: 'password' | 'cas' | 'both';
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  active: boolean;
  created_at: string;
  last_login: string | null;
  semester_count?: number;
  section_count?: number;
  semesters?: SemesterAssignment[];
  sections?: SectionAssignment[];
}

interface StudentLookupResult {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  email: string | null;
  netid: string | null;
}

interface SemesterAssignment {
  id: number;
  semester_id: number;
  semester_name: string;
  is_current: boolean;
  assigned_at: string;
}

interface SectionAssignment {
  id: number;
  section_id: string;
  section_title: string;
  course_name: string;
  semester_name: string;
  can_manage_students: boolean;
  can_manage_cases: boolean;
  can_view_chats: boolean;
  assigned_at: string;
}

interface Semester {
  id: number;
  semester_name: string;
  is_current: boolean;
}

interface Section {
  section_id: string;
  section_title: string;
  course_name?: string;
  semester_name?: string;
}

const AVAILABLE_PERMISSIONS = [
  { id: 'caseprep', label: 'Case Prep' },
  { id: 'personas', label: 'Personas' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'models', label: 'Models' },
  { id: 'settings', label: 'Settings' },
  { id: 'instructors', label: 'Instructors' },
];

const InstructorManager: React.FC<InstructorManagerProps> = ({ user, mode }) => {
  // Mode is controlled by parent - 'instructors' or 'admins'

  // Admin state
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [isLoadingAdmins, setIsLoadingAdmins] = useState(false);

  // Instructor state
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [isLoadingInstructors, setIsLoadingInstructors] = useState(false);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [sections, setSections] = useState<Section[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [showInstructorModal, setShowInstructorModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignType, setAssignType] = useState<'semester' | 'section'>('semester');

  const [editingAdmin, setEditingAdmin] = useState<Admin | null>(null);
  const [editingInstructor, setEditingInstructor] = useState<Instructor | null>(null);

  const [adminFormData, setAdminFormData] = useState({
    email: '',
    password: '',
    who: '',
    superuser: false,
    admin_access: [] as string[],
  });

  const [instructorFormData, setInstructorFormData] = useState({
    email: '',
    password: '',
    first_name: '',
    last_name: '',
    full_name: '',
    netid: '',
    auth_method: 'password' as 'password' | 'cas' | 'both',
    active: true,
    use_system_key: false,
    can_publish: false,
    monthly_token_cap: '' as string,
  });

  // Student-lookup typeahead state for the Add Instructor modal: lets an admin
  // promote an existing CAS student to instructor without re-typing their info.
  const [studentLookupQuery, setStudentLookupQuery] = useState('');
  const [studentLookupResults, setStudentLookupResults] = useState<StudentLookupResult[]>([]);
  const [studentLookupOpen, setStudentLookupOpen] = useState(false);
  const [studentLookupLoading, setStudentLookupLoading] = useState(false);

  const [assignFormData, setAssignFormData] = useState({
    semester_id: '',
    section_id: '',
    can_manage_students: true,
    can_manage_cases: true,
    can_view_chats: true,
  });

  // Track which instructor's assignments are expanded
  const [expandedInstructorId, setExpandedInstructorId] = useState<string | null>(null);
  const [expandedInstructorDetails, setExpandedInstructorDetails] = useState<Instructor | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  useEffect(() => {
    if (mode === 'admins') {
      fetchAdmins();
    } else {
      fetchInstructors();
      fetchSemesters();
      fetchSections();
    }
  }, [mode]);

  const fetchAdmins = async () => {
    setIsLoadingAdmins(true);
    setError(null);
    try {
      const response = await api.get('/admins');
      if (response.error) {
        setError(response.error.message);
      } else {
        setAdmins(response.data || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch admins');
    } finally {
      setIsLoadingAdmins(false);
    }
  };

  const fetchInstructors = async () => {
    setIsLoadingInstructors(true);
    setError(null);
    try {
      const response = await api.get('/instructors');
      if (response.error) {
        setError(response.error.message);
      } else {
        setInstructors(response.data || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch instructors');
    } finally {
      setIsLoadingInstructors(false);
    }
  };

  const fetchSemesters = async () => {
    try {
      const response = await api.get('/semesters');
      if (!response.error) {
        setSemesters(response.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch semesters:', err);
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

  // Fetch instructor details (with full assignment info)
  const fetchInstructorDetails = async (instructorId: string) => {
    setIsLoadingDetails(true);
    try {
      const response = await api.get(`/instructors/${instructorId}`);
      if (!response.error && response.data) {
        setExpandedInstructorDetails(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch instructor details:', err);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  // Toggle expanded state for an instructor
  const toggleExpandedInstructor = async (instructorId: string) => {
    if (expandedInstructorId === instructorId) {
      // Collapse
      setExpandedInstructorId(null);
      setExpandedInstructorDetails(null);
    } else {
      // Expand and fetch details
      setExpandedInstructorId(instructorId);
      await fetchInstructorDetails(instructorId);
    }
  };

  // Admin handlers
  const handleCreateAdmin = () => {
    setEditingAdmin(null);
    setAdminFormData({
      email: '',
      password: '',
      who: '',
      superuser: false,
      admin_access: [],
    });
    setShowAdminModal(true);
  };

  const handleEditAdmin = (admin: Admin) => {
    setEditingAdmin(admin);
    setAdminFormData({
      email: admin.email,
      password: '',
      who: admin.who,
      superuser: admin.superuser,
      admin_access: admin.admin_access || [],
    });
    setShowAdminModal(true);
  };

  const handleSubmitAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      if (editingAdmin) {
        const updateData: any = {
          who: adminFormData.who,
          email: adminFormData.email,
          superuser: adminFormData.superuser,
          admin_access: adminFormData.admin_access,
        };
        if (adminFormData.password) {
          updateData.password = adminFormData.password;
        }
        const response = await api.patch(`/admins/${editingAdmin.id}`, updateData);
        if (response.error) {
          setError(response.error.message || response.error);
          return;
        }
      } else {
        if (!adminFormData.password) {
          setError('Password is required for new admins');
          return;
        }
        const response = await api.post('/admins', adminFormData);
        if (response.error) {
          setError(response.error.message || response.error);
          return;
        }
      }

      setShowAdminModal(false);
      fetchAdmins();
    } catch (err: any) {
      setError(err.message || 'Failed to save admin');
    }
  };

  const handleDeleteAdmin = async (id: string) => {
    if (!confirm('Are you sure you want to delete this admin? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await api.delete(`/admins/${id}`);
      if (response.error) {
        setError(response.error.message || response.error);
      } else {
        fetchAdmins();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete admin');
    }
  };

  // Debounced student lookup for the "Look up from students" typeahead
  useEffect(() => {
    if (!showInstructorModal || editingInstructor) return;
    const q = studentLookupQuery.trim();
    if (q.length < 2) {
      setStudentLookupResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setStudentLookupLoading(true);
      try {
        const response = await api.get(`/students/lookup?q=${encodeURIComponent(q)}`);
        if (!cancelled && !response.error) {
          setStudentLookupResults(response.data || []);
        }
      } catch {
        // Lookup is best-effort — silently ignore.
      } finally {
        if (!cancelled) setStudentLookupLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [studentLookupQuery, showInstructorModal, editingInstructor]);

  const applyStudentLookupSelection = (s: StudentLookupResult) => {
    setInstructorFormData(prev => ({
      ...prev,
      first_name: s.first_name || prev.first_name,
      last_name: s.last_name || prev.last_name,
      full_name: s.full_name || prev.full_name,
      email: s.email || prev.email,
      netid: s.netid || prev.netid,
      // If we have a NetID, default to CAS sign-in
      auth_method: s.netid ? 'cas' : prev.auth_method,
    }));
    setStudentLookupOpen(false);
    setStudentLookupQuery('');
    setStudentLookupResults([]);
  };

  // Instructor handlers
  const handleCreateInstructor = () => {
    setEditingInstructor(null);
    setStudentLookupQuery('');
    setStudentLookupResults([]);
    setStudentLookupOpen(false);
    setInstructorFormData({
      email: '',
      password: '',
      first_name: '',
      last_name: '',
      full_name: '',
      netid: '',
      auth_method: 'password',
      active: true,
      use_system_key: false,
      can_publish: false,
      monthly_token_cap: '',
    });
    setShowInstructorModal(true);
  };

  const handleEditInstructor = (instructor: Instructor) => {
    setEditingInstructor(instructor);
    setStudentLookupQuery('');
    setStudentLookupResults([]);
    setStudentLookupOpen(false);
    setInstructorFormData({
      email: instructor.email,
      password: '',
      first_name: instructor.first_name || '',
      last_name: instructor.last_name || '',
      full_name: instructor.full_name,
      netid: instructor.netid || '',
      auth_method: instructor.auth_method || 'password',
      active: instructor.active,
      use_system_key: Boolean((instructor as any).use_system_key),
      can_publish: Boolean((instructor as any).can_publish),
      monthly_token_cap: (instructor as any).monthly_token_cap == null
        ? ''
        : String((instructor as any).monthly_token_cap),
    });
    setShowInstructorModal(true);
  };

  const handleSubmitInstructor = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const passwordRequired = instructorFormData.auth_method !== 'cas';
    const trimmedNetid = instructorFormData.netid.trim().toLowerCase();

    if (instructorFormData.auth_method === 'cas' && instructorFormData.password) {
      setError('CAS-only instructors should not have a password.');
      return;
    }

    try {
      if (editingInstructor) {
        const updateData: any = {
          first_name: instructorFormData.first_name,
          last_name: instructorFormData.last_name,
          full_name: instructorFormData.full_name || `${instructorFormData.first_name} ${instructorFormData.last_name}`.trim(),
          email: instructorFormData.email,
          netid: trimmedNetid === '' ? null : trimmedNetid,
          auth_method: instructorFormData.auth_method,
          active: instructorFormData.active,
          use_system_key: instructorFormData.use_system_key,
          can_publish: instructorFormData.can_publish,
          monthly_token_cap: instructorFormData.monthly_token_cap === ''
            ? null
            : Number(instructorFormData.monthly_token_cap),
        };
        if (instructorFormData.password) {
          updateData.password = instructorFormData.password;
        }
        const response = await api.patch(`/instructors/${editingInstructor.id}`, updateData);
        if (response.error) {
          setError(response.error.message || response.error);
          return;
        }
      } else {
        if (passwordRequired && !instructorFormData.password) {
          setError('Password is required for password-based sign-in.');
          return;
        }
        const response = await api.post('/instructors', {
          ...instructorFormData,
          netid: trimmedNetid === '' ? null : trimmedNetid,
          full_name: instructorFormData.full_name || `${instructorFormData.first_name} ${instructorFormData.last_name}`.trim(),
        });
        if (response.error) {
          setError(response.error.message || response.error);
          return;
        }
      }

      setShowInstructorModal(false);
      fetchInstructors();
    } catch (err: any) {
      setError(err.message || 'Failed to save instructor');
    }
  };

  const handleDeleteInstructor = async (id: string) => {
    if (!confirm('Are you sure you want to delete this instructor? This will also remove all their semester and section assignments.')) {
      return;
    }

    try {
      const response = await api.delete(`/instructors/${id}`);
      if (response.error) {
        setError(response.error.message || response.error);
      } else {
        fetchInstructors();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete instructor');
    }
  };

  // Assignment handlers
  const handleOpenAssignModal = (instructor: Instructor, type: 'semester' | 'section') => {
    setEditingInstructor(instructor);
    setAssignType(type);
    setAssignFormData({
      semester_id: '',
      section_id: '',
      can_manage_students: true,
      can_manage_cases: true,
      can_view_chats: true,
    });
    setShowAssignModal(true);
  };

  const handleSubmitAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!editingInstructor) return;

    try {
      if (assignType === 'semester') {
        if (!assignFormData.semester_id) {
          setError('Please select a semester');
          return;
        }
        const response = await api.post(`/instructors/${editingInstructor.id}/semesters`, {
          semester_id: parseInt(assignFormData.semester_id),
        });
        if (response.error) {
          setError(response.error.message || response.error);
          return;
        }
      } else {
        if (!assignFormData.section_id) {
          setError('Please select a section');
          return;
        }
        const response = await api.post(`/instructors/${editingInstructor.id}/sections`, {
          section_id: assignFormData.section_id,
          can_manage_students: assignFormData.can_manage_students,
          can_manage_cases: assignFormData.can_manage_cases,
          can_view_chats: assignFormData.can_view_chats,
        });
        if (response.error) {
          setError(response.error.message || response.error);
          return;
        }
      }

      setShowAssignModal(false);
      fetchInstructors();
    } catch (err: any) {
      setError(err.message || 'Failed to create assignment');
    }
  };

  const handleRemoveSemester = async (instructorId: string, semesterId: number) => {
    if (!confirm('Remove this semester assignment?')) return;

    try {
      const response = await api.delete(`/instructors/${instructorId}/semesters/${semesterId}`);
      if (response.error) {
        setError(response.error.message);
      } else {
        fetchInstructors();
        // Refresh expanded details if this instructor is expanded
        if (expandedInstructorId === instructorId) {
          fetchInstructorDetails(instructorId);
        }
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRemoveSection = async (instructorId: string, sectionId: string) => {
    if (!confirm('Remove this section assignment?')) return;

    try {
      const response = await api.delete(`/instructors/${instructorId}/sections/${sectionId}`);
      if (response.error) {
        setError(response.error.message);
      } else {
        fetchInstructors();
        // Refresh expanded details if this instructor is expanded
        if (expandedInstructorId === instructorId) {
          fetchInstructorDetails(instructorId);
        }
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const togglePermission = (permission: string) => {
    setAdminFormData(prev => ({
      ...prev,
      admin_access: prev.admin_access.includes(permission)
        ? prev.admin_access.filter(p => p !== permission)
        : [...prev.admin_access, permission]
    }));
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">
          {mode === 'admins' ? 'Admin Accounts' : 'Instructor Management'}
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          {mode === 'admins'
            ? 'Manage admin accounts with dashboard access'
            : 'Manage instructor assignments to semesters and sections'}
        </p>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-500 hover:text-red-700">
            &times;
          </button>
        </div>
      )}

      {/* Admins Tab */}
      {mode === 'admins' && (
        <>
          <div className="mb-4 flex justify-between items-center">
            <p className="text-sm text-gray-600">
              Admins have access to the instructor dashboard. Superusers have full access.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCreateAdmin}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
              >
                + Add Admin
              </button>
              <button
                onClick={fetchAdmins}
                disabled={isLoadingAdmins}
                aria-label="Refresh admins list"
                title="Refresh admins list"
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${isLoadingAdmins ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Permissions</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {isLoadingAdmins ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-4 text-center text-gray-500">Loading...</td>
                  </tr>
                ) : admins.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-4 text-center text-gray-500">No admins found</td>
                  </tr>
                ) : (
                  admins.map((admin) => (
                    <tr key={admin.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {admin.who}
                          {admin.id === user?.id && <span className="ml-2 text-xs text-gray-500">(You)</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-600">{admin.email}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {admin.superuser ? (
                          <span className="px-2 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">Superuser</span>
                        ) : (
                          <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">Admin</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {admin.superuser ? (
                          <span className="text-sm text-gray-500">Full Access</span>
                        ) : admin.admin_access.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {admin.admin_access.map(perm => (
                              <span key={perm} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded">{perm}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">Base Access Only</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button onClick={() => handleEditAdmin(admin)} className="text-blue-600 hover:text-blue-900 mr-4">Edit</button>
                        {admin.id !== user?.id && (
                          <button onClick={() => handleDeleteAdmin(admin.id)} className="text-red-600 hover:text-red-900">Delete</button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Instructors Tab */}
      {mode === 'instructors' && (
        <>
          <div className="mb-4 flex justify-between items-center">
            <p className="text-sm text-gray-600">
              Primary instructors are assigned to semesters and can manage courses within them.
              TAs are assigned to specific sections.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCreateInstructor}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
              >
                + Add Instructor
              </button>
              <button
                onClick={fetchInstructors}
                disabled={isLoadingInstructors}
                aria-label="Refresh instructors list"
                title="Refresh instructors list"
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${isLoadingInstructors ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assignments</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {isLoadingInstructors ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-4 text-center text-gray-500">Loading...</td>
                  </tr>
                ) : instructors.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-4 text-center text-gray-500">No instructors found</td>
                  </tr>
                ) : (
                  instructors.map((instructor) => (
                    <React.Fragment key={instructor.id}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{instructor.full_name}</div>
                        {instructor.last_login && (
                          <div className="text-xs text-gray-400">
                            Last login: {new Date(instructor.last_login).toLocaleDateString()}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-600">{instructor.email}</div>
                        <div className="text-xs text-gray-400 flex gap-2 items-center mt-0.5">
                          {instructor.netid && <span title="BYU NetID">NetID: {instructor.netid}</span>}
                          {instructor.auth_method === 'cas' && (
                            <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] uppercase tracking-wide" title="Signs in with BYU CAS only">CAS</span>
                          )}
                          {instructor.auth_method === 'both' && (
                            <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-[10px] uppercase tracking-wide" title="Signs in with CAS or password">CAS + Pwd</span>
                          )}
                          {instructor.auth_method === 'password' && (
                            <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] uppercase tracking-wide" title="Email and password sign-in">Pwd</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-wrap gap-1 items-center">
                          {instructor.active ? (
                            <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">Active</span>
                          ) : (
                            <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">Inactive</span>
                          )}
                          {(instructor as any).use_system_key && (
                            <span className="px-2 py-0.5 text-xs rounded bg-amber-100 text-amber-800" title="Uses system API key">sys-key</span>
                          )}
                          {(instructor as any).use_system_key && (instructor as any).monthly_token_cap != null && (
                            <span
                              className="px-2 py-0.5 text-xs rounded bg-amber-50 text-amber-700 border border-amber-200"
                              title="Monthly token cap (input + cached + output)"
                            >
                              cap: {Number((instructor as any).monthly_token_cap).toLocaleString()}
                            </span>
                          )}
                          {(instructor as any).can_publish && (
                            <span className="px-2 py-0.5 text-xs rounded bg-blue-100 text-blue-800" title="Can publish to all instructors">publish</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {(instructor.semester_count || 0) > 0 || (instructor.section_count || 0) > 0 ? (
                          <button
                            onClick={() => toggleExpandedInstructor(instructor.id)}
                            className="flex flex-wrap gap-1 items-center cursor-pointer hover:opacity-80 transition-opacity"
                            title="Click to view/manage assignments"
                          >
                            {(instructor.semester_count || 0) > 0 && (
                              <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">
                                {instructor.semester_count} semester{instructor.semester_count !== 1 ? 's' : ''}
                              </span>
                            )}
                            {(instructor.section_count || 0) > 0 && (
                              <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                                {instructor.section_count} section{instructor.section_count !== 1 ? 's' : ''}
                              </span>
                            )}
                            <svg
                              className={`w-4 h-4 text-gray-400 transition-transform ${expandedInstructorId === instructor.id ? 'rotate-180' : ''}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        ) : (
                          <span className="text-sm text-gray-400">No assignments</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => handleOpenAssignModal(instructor, 'semester')}
                          className="text-purple-600 hover:text-purple-900 mr-2"
                          title="Assign to semester"
                        >
                          +Sem
                        </button>
                        <button
                          onClick={() => handleOpenAssignModal(instructor, 'section')}
                          className="text-blue-600 hover:text-blue-900 mr-2"
                          title="Assign to section"
                        >
                          +Sec
                        </button>
                        <button onClick={() => handleEditInstructor(instructor)} className="text-gray-600 hover:text-gray-900 mr-2">Edit</button>
                        <button onClick={() => handleDeleteInstructor(instructor.id)} className="text-red-600 hover:text-red-900">Delete</button>
                      </td>
                    </tr>
                    {/* Expanded Assignment Details */}
                    {expandedInstructorId === instructor.id && (
                      <tr className="bg-gray-50">
                        <td colSpan={5} className="px-6 py-4">
                          {isLoadingDetails ? (
                            <div className="text-sm text-gray-500">Loading assignments...</div>
                          ) : expandedInstructorDetails ? (
                            <div className="space-y-4">
                              {/* Semester Assignments */}
                              {expandedInstructorDetails.semesters && expandedInstructorDetails.semesters.length > 0 && (
                                <div>
                                  <h4 className="text-sm font-medium text-purple-700 mb-2">Semester Assignments (Primary Instructor)</h4>
                                  <div className="space-y-1">
                                    {expandedInstructorDetails.semesters.map((sem) => (
                                      <div key={sem.id} className="flex items-center justify-between bg-white px-3 py-2 rounded border border-purple-100">
                                        <div>
                                          <span className="font-medium text-gray-900">{sem.semester_name}</span>
                                          {sem.is_current && (
                                            <span className="ml-2 px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">Current</span>
                                          )}
                                        </div>
                                        <button
                                          onClick={() => handleRemoveSemester(instructor.id, sem.semester_id)}
                                          className="text-red-500 hover:text-red-700 text-sm"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Section Assignments */}
                              {expandedInstructorDetails.sections && expandedInstructorDetails.sections.length > 0 && (
                                <div>
                                  <h4 className="text-sm font-medium text-blue-700 mb-2">Section Assignments (TA)</h4>
                                  <div className="space-y-1">
                                    {expandedInstructorDetails.sections.map((sec) => (
                                      <div key={sec.id} className="flex items-center justify-between bg-white px-3 py-2 rounded border border-blue-100">
                                        <div>
                                          <span className="font-medium text-gray-900">{sec.section_title}</span>
                                          {sec.course_name && (
                                            <span className="ml-2 text-sm text-gray-500">({sec.course_name})</span>
                                          )}
                                          {sec.semester_name && (
                                            <span className="ml-1 text-xs text-gray-400">- {sec.semester_name}</span>
                                          )}
                                          <div className="text-xs text-gray-500 mt-0.5">
                                            Permissions:
                                            {sec.can_manage_students && <span className="ml-1 text-green-600">Students</span>}
                                            {sec.can_manage_cases && <span className="ml-1 text-green-600">Cases</span>}
                                            {sec.can_view_chats && <span className="ml-1 text-green-600">Chats</span>}
                                          </div>
                                        </div>
                                        <button
                                          onClick={() => handleRemoveSection(instructor.id, sec.section_id)}
                                          className="text-red-500 hover:text-red-700 text-sm"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* No assignments message */}
                              {(!expandedInstructorDetails.semesters || expandedInstructorDetails.semesters.length === 0) &&
                               (!expandedInstructorDetails.sections || expandedInstructorDetails.sections.length === 0) && (
                                <div className="text-sm text-gray-500">No assignments</div>
                              )}
                            </div>
                          ) : (
                            <div className="text-sm text-gray-500">Failed to load assignments</div>
                          )}
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Admin Modal */}
      {showAdminModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">
              {editingAdmin ? 'Edit Admin' : 'Add New Admin'}
            </h3>

            <form onSubmit={handleSubmitAdmin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={adminFormData.who}
                  onChange={(e) => setAdminFormData({ ...adminFormData, who: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={adminFormData.email}
                  onChange={(e) => setAdminFormData({ ...adminFormData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Password {editingAdmin && <span className="text-gray-500">(leave blank to keep current)</span>}
                </label>
                <input
                  type="password"
                  value={adminFormData.password}
                  onChange={(e) => setAdminFormData({ ...adminFormData, password: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  required={!editingAdmin}
                />
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="superuser"
                  checked={adminFormData.superuser}
                  onChange={(e) => setAdminFormData({ ...adminFormData, superuser: e.target.checked })}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="superuser" className="ml-2 block text-sm text-gray-900">
                  Superuser (full access to all functions)
                </label>
              </div>

              {!adminFormData.superuser && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Additional Permissions</label>
                  <div className="space-y-2">
                    {AVAILABLE_PERMISSIONS.map(perm => (
                      <div key={perm.id} className="flex items-center">
                        <input
                          type="checkbox"
                          id={perm.id}
                          checked={adminFormData.admin_access.includes(perm.id)}
                          onChange={() => togglePermission(perm.id)}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <label htmlFor={perm.id} className="ml-2 block text-sm text-gray-700">{perm.label}</label>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    Base access (Chats, Assignments, Sections, Cases) is always included
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setShowAdminModal(false)} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">{editingAdmin ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Instructor Modal */}
      {showInstructorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">
              {editingInstructor ? 'Edit Instructor' : 'Add New Instructor'}
            </h3>

            <form onSubmit={handleSubmitInstructor} className="space-y-4">
              {!editingInstructor && (
                <div className="border border-gray-200 rounded-lg bg-gray-50 p-3 relative">
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Look up from students
                  </label>
                  <p className="text-xs text-gray-500 mb-2">
                    If this person has previously signed in as a student via BYU CAS, find them by name or email to auto-fill the form.
                  </p>
                  <input
                    type="text"
                    value={studentLookupQuery}
                    onChange={(e) => { setStudentLookupQuery(e.target.value); setStudentLookupOpen(true); }}
                    onFocus={() => setStudentLookupOpen(true)}
                    placeholder="Search students…"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm"
                  />
                  {studentLookupOpen && studentLookupQuery.trim().length >= 2 && (
                    <div className="absolute z-10 left-3 right-3 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                      {studentLookupLoading && (
                        <div className="px-3 py-2 text-xs text-gray-500">Searching…</div>
                      )}
                      {!studentLookupLoading && studentLookupResults.length === 0 && (
                        <div className="px-3 py-2 text-xs text-gray-500">No matches.</div>
                      )}
                      {studentLookupResults.map(s => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => applyStudentLookupSelection(s)}
                          className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-100 last:border-b-0"
                        >
                          <div className="text-sm font-medium text-gray-900">{s.full_name}</div>
                          <div className="text-xs text-gray-500">
                            {s.email || '(no email)'}{s.netid ? ` · NetID: ${s.netid}` : ''}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sign-in method</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { value: 'cas', label: 'BYU CAS only', hint: 'Signs in with NetID' },
                    { value: 'password', label: 'Password only', hint: 'Email + password' },
                    { value: 'both', label: 'Both', hint: 'Either method' },
                  ] as const).map(opt => (
                    <label
                      key={opt.value}
                      className={`flex flex-col items-start border rounded-lg p-2 cursor-pointer text-xs ${
                        instructorFormData.auth_method === opt.value
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="auth_method"
                        value={opt.value}
                        checked={instructorFormData.auth_method === opt.value}
                        onChange={() => setInstructorFormData({
                          ...instructorFormData,
                          auth_method: opt.value,
                          // Clear password when switching to CAS-only.
                          password: opt.value === 'cas' ? '' : instructorFormData.password,
                        })}
                        className="mb-1"
                      />
                      <span className="font-medium text-gray-800">{opt.label}</span>
                      <span className="text-gray-500">{opt.hint}</span>
                    </label>
                  ))}
                </div>
                {instructorFormData.auth_method !== 'password' && (
                  <p className="text-xs text-gray-500 mt-1">
                    For CAS sign-in the instructor clicks <em>Sign in with BYU NetID</em> on the login screen — no invite email is sent.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                  <input
                    type="text"
                    value={instructorFormData.first_name}
                    onChange={(e) => setInstructorFormData({ ...instructorFormData, first_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                  <input
                    type="text"
                    value={instructorFormData.last_name}
                    onChange={(e) => setInstructorFormData({ ...instructorFormData, last_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
                <input
                  type="text"
                  value={instructorFormData.full_name}
                  onChange={(e) => setInstructorFormData({ ...instructorFormData, full_name: e.target.value })}
                  placeholder="Auto-generated from first/last if blank"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={instructorFormData.email}
                  onChange={(e) => setInstructorFormData({ ...instructorFormData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              {instructorFormData.auth_method !== 'password' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    BYU NetID {instructorFormData.auth_method === 'cas' && <span className="text-gray-500">(recommended)</span>}
                  </label>
                  <input
                    type="text"
                    value={instructorFormData.netid}
                    onChange={(e) => setInstructorFormData({ ...instructorFormData, netid: e.target.value })}
                    placeholder="e.g. jsmith21"
                    autoComplete="off"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Optional but preferred for CAS match. If left blank, CAS sign-in falls back to matching by email.
                  </p>
                </div>
              )}

              {instructorFormData.auth_method !== 'cas' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Password {editingInstructor && <span className="text-gray-500">(leave blank to keep current)</span>}
                  </label>
                  <input
                    type="password"
                    value={instructorFormData.password}
                    onChange={(e) => setInstructorFormData({ ...instructorFormData, password: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    required={!editingInstructor}
                  />
                </div>
              )}

              {editingInstructor && (
                <>
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="active"
                      checked={instructorFormData.active}
                      onChange={(e) => setInstructorFormData({ ...instructorFormData, active: e.target.checked })}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="active" className="ml-2 block text-sm text-gray-900">
                      Active (can log in)
                    </label>
                  </div>

                  <div className="border-t border-gray-200 pt-3 space-y-2">
                    <div className="text-xs font-medium text-gray-500 uppercase">Admin grants</div>
                    <div className="flex items-start">
                      <input
                        type="checkbox"
                        id="use_system_key"
                        checked={instructorFormData.use_system_key}
                        onChange={(e) => setInstructorFormData({ ...instructorFormData, use_system_key: e.target.checked })}
                        className="h-4 w-4 mt-0.5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <label htmlFor="use_system_key" className="ml-2 block text-sm text-gray-900">
                        Use system API key
                        <div className="text-xs text-gray-500">Bypass per-instructor key requirement; use server env keys.</div>
                      </label>
                    </div>
                    <div className="flex items-start">
                      <input
                        type="checkbox"
                        id="can_publish"
                        checked={instructorFormData.can_publish}
                        onChange={(e) => setInstructorFormData({ ...instructorFormData, can_publish: e.target.checked })}
                        className="h-4 w-4 mt-0.5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <label htmlFor="can_publish" className="ml-2 block text-sm text-gray-900">
                        Can publish to all instructors
                        <div className="text-xs text-gray-500">Allow this instructor to set resources to Public visibility.</div>
                      </label>
                    </div>
                    <div>
                      <label htmlFor="monthly_token_cap" className="block text-sm font-medium text-gray-700">
                        Monthly token cap
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        id="monthly_token_cap"
                        value={instructorFormData.monthly_token_cap}
                        onChange={(e) => setInstructorFormData({ ...instructorFormData, monthly_token_cap: e.target.value })}
                        placeholder="(no cap)"
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Only enforced when "Use system API key" is on. Total tokens (input + cached + output) per calendar month. Leave blank for no cap.
                      </p>
                    </div>
                  </div>
                </>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setShowInstructorModal(false)} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">{editingInstructor ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assignment Modal */}
      {showAssignModal && editingInstructor && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">
              {assignType === 'semester' ? 'Assign to Semester' : 'Assign to Section'}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Assigning <strong>{editingInstructor.full_name}</strong>
            </p>

            <form onSubmit={handleSubmitAssignment} className="space-y-4">
              {assignType === 'semester' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Semester</label>
                  <select
                    value={assignFormData.semester_id}
                    onChange={(e) => setAssignFormData({ ...assignFormData, semester_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    required
                  >
                    <option value="">Select a semester...</option>
                    {semesters.map(sem => (
                      <option key={sem.id} value={sem.id}>
                        {sem.semester_name} {sem.is_current ? '(Current)' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs text-gray-500">
                    Primary instructors can create and manage courses within their assigned semesters.
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Section</label>
                    <select
                      value={assignFormData.section_id}
                      onChange={(e) => setAssignFormData({ ...assignFormData, section_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                      required
                    >
                      <option value="">Select a section...</option>
                      {sections.map(sec => (
                        <option key={sec.section_id} value={sec.section_id}>
                          {sec.section_title} {sec.course_name ? `(${sec.course_name})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">TA Permissions</label>
                    <div className="space-y-2">
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          id="can_manage_students"
                          checked={assignFormData.can_manage_students}
                          onChange={(e) => setAssignFormData({ ...assignFormData, can_manage_students: e.target.checked })}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <label htmlFor="can_manage_students" className="ml-2 block text-sm text-gray-700">Can manage students</label>
                      </div>
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          id="can_manage_cases"
                          checked={assignFormData.can_manage_cases}
                          onChange={(e) => setAssignFormData({ ...assignFormData, can_manage_cases: e.target.checked })}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <label htmlFor="can_manage_cases" className="ml-2 block text-sm text-gray-700">Can manage case assignments</label>
                      </div>
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          id="can_view_chats"
                          checked={assignFormData.can_view_chats}
                          onChange={(e) => setAssignFormData({ ...assignFormData, can_view_chats: e.target.checked })}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <label htmlFor="can_view_chats" className="ml-2 block text-sm text-gray-700">Can view student chats</label>
                      </div>
                    </div>
                  </div>
                </>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setShowAssignModal(false)} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Assign</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default InstructorManager;
