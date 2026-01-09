import React, { useState, useEffect, useRef } from 'react';
import { api, getApiBaseUrl } from '../services/apiClient';

interface Case {
  case_id: string;
  case_title: string;
}

interface CaseFile {
  id: number;
  case_id: string;
  filename: string;
  original_filename: string | null;
  file_type: string;
  file_type_label: string;
  file_format: string | null;
  file_source: 'uploaded' | 'ai_prepped' | 'downloaded';
  source_url: string | null;
  proprietary: boolean;
  proprietary_confirmed_by: number | null;
  proprietary_confirmed_at: string | null;
  include_in_chat_prompt: boolean;
  prompt_order: number;
  file_version: string | null;
  file_size: number | null;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed' | null;
  created_at: string;
}

const PREDEFINED_FILE_TYPES = [
  { value: 'case', label: 'Case Document' },
  { value: 'teaching_note', label: 'Teaching Note' },
  { value: 'chapter', label: 'Chapter' },
  { value: 'reading', label: 'Reading' },
  { value: 'article', label: 'Article' },
  { value: 'instructor_notes', label: 'Instructor Notes' },
];

export const CaseFilesManager: React.FC = () => {
  const [cases, setCases] = useState<Case[]>([]);
  const [selectedCase, setSelectedCase] = useState<string>('');
  const [files, setFiles] = useState<CaseFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Upload form state
  const [uploadFileType, setUploadFileType] = useState<string>('case');
  const [uploadCustomType, setUploadCustomType] = useState<string>('');
  const [uploadProprietary, setUploadProprietary] = useState<boolean>(false);
  const [uploadIncludeInPrompt, setUploadIncludeInPrompt] = useState<boolean>(true);
  const [uploadPromptOrder, setUploadPromptOrder] = useState<number>(0);
  const [uploadVersion, setUploadVersion] = useState<string>('');

  // URL download state
  const [downloadUrl, setDownloadUrl] = useState<string>('');
  const [downloadFileType, setDownloadFileType] = useState<string>('reading');
  const [downloadCustomType, setDownloadCustomType] = useState<string>('');

  // Edit modal state
  const [editingFile, setEditingFile] = useState<CaseFile | null>(null);
  const [editFileType, setEditFileType] = useState<string>('');
  const [editCustomType, setEditCustomType] = useState<string>('');
  const [editProprietary, setEditProprietary] = useState<boolean>(false);
  const [editIncludeInPrompt, setEditIncludeInPrompt] = useState<boolean>(true);
  const [editPromptOrder, setEditPromptOrder] = useState<number>(0);
  const [editVersion, setEditVersion] = useState<string>('');

  // Proprietary confirmation modal
  const [confirmingFile, setConfirmingFile] = useState<CaseFile | null>(null);

  // Drag state for reordering
  const [draggedItem, setDraggedItem] = useState<CaseFile | null>(null);

  // Sync report modal
  const [syncReport, setSyncReport] = useState<any>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const initialize = async () => {
      setIsInitializing(true);
      await fetchCases();
      setIsInitializing(false);
    };
    initialize();
  }, []);

  useEffect(() => {
    if (selectedCase) {
      fetchFiles(selectedCase);
    }
  }, [selectedCase]);

  // Auto-clear success message
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  const fetchCases = async () => {
    try {
      const response = await api.get('/cases');
      if (response.error) {
        setError(`Failed to fetch cases: ${response.error.message}`);
        return;
      }
      if (response.data) {
        setCases(response.data);
        if (response.data.length > 0 && !selectedCase) {
          setSelectedCase(response.data[0].case_id);
        }
      }
    } catch (err: any) {
      setError(`Failed to fetch cases: ${err.message || 'Unknown error'}`);
    }
  };

  const fetchFiles = async (caseId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get(`/case-files/${caseId}`);
      if (response.error) {
        setError(response.error.message || 'Failed to fetch files');
        setFiles([]);
      } else if (response.data) {
        setFiles(response.data);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch files');
      setFiles([]);
    } finally {
      setIsLoading(false);
    }
  };

  const getEffectiveFileType = (type: string, customType: string): string => {
    if (type === 'other' && customType.trim()) {
      return `other:${customType.trim()}`;
    }
    return type;
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleUpload(e.target.files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleUpload(e.dataTransfer.files[0]);
    }
  };

  const handleUpload = async (file: File) => {
    if (!selectedCase) {
      alert('Please select a case first');
      return;
    }

    const effectiveType = getEffectiveFileType(uploadFileType, uploadCustomType);
    if (uploadFileType === 'other' && !uploadCustomType.trim()) {
      alert('Please enter a custom file type label');
      return;
    }

    setIsUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('file_type', effectiveType);
      formData.append('proprietary', uploadProprietary ? '1' : '0');
      formData.append('include_in_chat_prompt', uploadIncludeInPrompt ? '1' : '0');
      formData.append('prompt_order', uploadPromptOrder.toString());
      if (uploadVersion) {
        formData.append('file_version', uploadVersion);
      }

      const token = localStorage.getItem('token') || localStorage.getItem('auth_token');
      if (!token) {
        throw new Error('Not authenticated. Please log in again.');
      }

      const response = await fetch(`${getApiBaseUrl()}/case-files/${selectedCase}/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        let errorMessage = 'Upload failed';
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json();
          errorMessage = errorData.error?.message || 'Upload failed';
        }
        throw new Error(errorMessage);
      }

      await fetchFiles(selectedCase);
      setSuccess('File uploaded successfully');

      // Reset form
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setUploadCustomType('');
      setUploadVersion('');
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownloadUrl = async () => {
    if (!selectedCase) {
      alert('Please select a case first');
      return;
    }

    if (!downloadUrl.trim()) {
      alert('Please enter a URL');
      return;
    }

    const effectiveType = getEffectiveFileType(downloadFileType, downloadCustomType);
    if (downloadFileType === 'other' && !downloadCustomType.trim()) {
      alert('Please enter a custom file type label');
      return;
    }

    setIsDownloading(true);
    setError(null);
    try {
      const response = await api.post(`/case-files/${selectedCase}/download-url`, {
        url: downloadUrl.trim(),
        file_type: effectiveType,
        proprietary: false,
        include_in_chat_prompt: true,
        prompt_order: 0,
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      await fetchFiles(selectedCase);
      setSuccess('File downloaded successfully');
      setDownloadUrl('');
      setDownloadCustomType('');
    } catch (err: any) {
      setError(err.message || 'Download failed');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDelete = async (fileId: number) => {
    if (!confirm('Are you sure you want to delete this file?')) {
      return;
    }

    try {
      const response = await api.delete(`/case-files/${fileId}`);
      if (response.error) {
        throw new Error(response.error.message);
      }
      await fetchFiles(selectedCase);
      setSuccess('File deleted');
    } catch (err: any) {
      setError(err.message || 'Delete failed');
    }
  };

  const openEditModal = (file: CaseFile) => {
    setEditingFile(file);
    // Parse file_type - check if it's a custom type
    if (file.file_type.startsWith('other:')) {
      setEditFileType('other');
      setEditCustomType(file.file_type.substring(6));
    } else {
      setEditFileType(file.file_type);
      setEditCustomType('');
    }
    setEditProprietary(file.proprietary);
    setEditIncludeInPrompt(file.include_in_chat_prompt);
    setEditPromptOrder(file.prompt_order);
    setEditVersion(file.file_version || '');
  };

  const handleSaveEdit = async () => {
    if (!editingFile) return;

    const effectiveType = getEffectiveFileType(editFileType, editCustomType);
    if (editFileType === 'other' && !editCustomType.trim()) {
      alert('Please enter a custom file type label');
      return;
    }

    try {
      const response = await api.patch(`/case-files/${editingFile.id}`, {
        file_type: effectiveType,
        proprietary: editProprietary,
        include_in_chat_prompt: editIncludeInPrompt,
        prompt_order: editPromptOrder,
        file_version: editVersion || null,
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      await fetchFiles(selectedCase);
      setEditingFile(null);
      setSuccess('File updated');
    } catch (err: any) {
      setError(err.message || 'Update failed');
    }
  };

  const handleConfirmProprietary = async () => {
    if (!confirmingFile) return;

    try {
      const response = await api.post(`/case-files/${confirmingFile.id}/confirm-proprietary`);
      if (response.error) {
        throw new Error(response.error.message);
      }

      await fetchFiles(selectedCase);
      setConfirmingFile(null);
      setSuccess('Proprietary content confirmed');
    } catch (err: any) {
      setError(err.message || 'Confirmation failed');
    }
  };

  const handleToggleIncludeInPrompt = async (file: CaseFile) => {
    // If turning ON and file is proprietary without confirmation, show confirmation modal
    if (!file.include_in_chat_prompt && file.proprietary && !file.proprietary_confirmed_by) {
      setConfirmingFile(file);
      return;
    }

    try {
      const response = await api.patch(`/case-files/${file.id}`, {
        include_in_chat_prompt: !file.include_in_chat_prompt,
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      await fetchFiles(selectedCase);
    } catch (err: any) {
      setError(err.message || 'Update failed');
    }
  };

  // Drag and drop reordering
  const handleDragStart = (e: React.DragEvent, file: CaseFile) => {
    setDraggedItem(file);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDropReorder = async (e: React.DragEvent, targetFile: CaseFile) => {
    e.preventDefault();
    if (!draggedItem || draggedItem.id === targetFile.id) {
      setDraggedItem(null);
      return;
    }

    // Calculate new order
    const newOrder = targetFile.prompt_order;

    try {
      const response = await api.patch(`/case-files/${draggedItem.id}/reorder`, {
        prompt_order: newOrder,
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      await fetchFiles(selectedCase);
    } catch (err: any) {
      setError(err.message || 'Reorder failed');
    }

    setDraggedItem(null);
  };

  const handleSync = async () => {
    if (!selectedCase) {
      alert('Please select a case first');
      return;
    }

    setIsSyncing(true);
    setError(null);
    try {
      const response = await api.post(`/case-files/${selectedCase}/sync`);
      if (response.error) {
        throw new Error(response.error.message);
      }

      setSyncReport(response.data);
      await fetchFiles(selectedCase);
    } catch (err: any) {
      setError(err.message || 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  const formatFileSize = (bytes: number | null): string => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getSourceBadge = (source: string) => {
    const colors = {
      uploaded: 'bg-blue-100 text-blue-800',
      downloaded: 'bg-purple-100 text-purple-800',
      ai_prepped: 'bg-green-100 text-green-800',
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs ${colors[source as keyof typeof colors] || 'bg-gray-100 text-gray-800'}`}>
        {source}
      </span>
    );
  };

  const noCasesAvailable = !isInitializing && cases.length === 0;

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-6">Case Files</h2>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
          <button onClick={() => setError(null)} className="float-right font-bold">&times;</button>
        </div>
      )}

      {success && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
          {success}
        </div>
      )}

      {isInitializing ? (
        <div className="bg-white border rounded-lg p-8 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      ) : noCasesAvailable ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-8 text-center">
          <h3 className="text-xl font-semibold text-yellow-900 mb-2">No Cases Available</h3>
          <p className="text-yellow-700">
            Create a case first in the "Cases" tab before managing files.
          </p>
        </div>
      ) : (
        <>
          {/* Case Selection */}
          <div className="bg-white border rounded-lg p-4 mb-4">
            <div className="flex items-center gap-4">
              <label className="font-semibold">Select Case:</label>
              <select
                value={selectedCase}
                onChange={(e) => setSelectedCase(e.target.value)}
                className="border rounded px-3 py-2 flex-1"
              >
                {cases.map(c => (
                  <option key={c.case_id} value={c.case_id}>
                    {c.case_title} ({c.case_id})
                  </option>
                ))}
              </select>
              <button
                onClick={() => fetchFiles(selectedCase)}
                className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
              >
                Refresh
              </button>
            </div>
          </div>

          {/* Files List */}
          <div className="bg-white border rounded-lg p-6 mb-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">
                Files ({files.length})
                <span className="text-sm font-normal text-gray-500 ml-2">
                  Drag rows to reorder prompt context
                </span>
              </h3>
              <button
                onClick={handleSync}
                disabled={isSyncing}
                className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:bg-gray-100"
                title="Sync with filesystem"
              >
                <svg className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {isSyncing ? 'Syncing...' : 'Sync'}
              </button>
            </div>

            {/* Sync Report */}
            {syncReport && (
              <div className="mb-4 p-4 border rounded bg-blue-50">
                <div className="flex justify-between items-start mb-2">
                  <h4 className="font-semibold text-blue-900">Sync Report</h4>
                  <button
                    onClick={() => setSyncReport(null)}
                    className="text-blue-600 hover:text-blue-800 text-sm"
                  >
                    Dismiss
                  </button>
                </div>

                {syncReport.missing_files?.length > 0 && (
                  <div className="mb-2">
                    <div className="font-medium text-red-700">Missing Files ({syncReport.missing_files.length}):</div>
                    <div className="text-sm text-red-600 ml-4">
                      {syncReport.missing_files.map((f: any, i: number) => (
                        <div key={i}>• {f.filename} (ID: {f.id})</div>
                      ))}
                    </div>
                  </div>
                )}

                {syncReport.unregistered_files?.length > 0 && (
                  <div className="mb-2">
                    <div className="font-medium text-yellow-700">Unregistered Files ({syncReport.unregistered_files.length}):</div>
                    <div className="text-sm text-yellow-600 ml-4">
                      {syncReport.unregistered_files.map((f: string, i: number) => (
                        <div key={i}>• {f}</div>
                      ))}
                    </div>
                  </div>
                )}

                {syncReport.updated_files?.length > 0 && (
                  <div className="mb-2">
                    <div className="font-medium text-green-700">Updated Files ({syncReport.updated_files.length}):</div>
                    <div className="text-sm text-green-600 ml-4">
                      {syncReport.updated_files.map((f: any, i: number) => (
                        <div key={i}>• {f.filename} - file_size updated</div>
                      ))}
                    </div>
                  </div>
                )}

                {syncReport.errors?.length > 0 && (
                  <div className="mb-2">
                    <div className="font-medium text-red-700">Errors ({syncReport.errors.length}):</div>
                    <div className="text-sm text-red-600 ml-4">
                      {syncReport.errors.map((e: string, i: number) => (
                        <div key={i}>• {e}</div>
                      ))}
                    </div>
                  </div>
                )}

                {!syncReport.missing_files?.length &&
                 !syncReport.unregistered_files?.length &&
                 !syncReport.updated_files?.length &&
                 !syncReport.errors?.length && (
                  <div className="text-green-700">✓ All files in sync!</div>
                )}
              </div>
            )}

            {isLoading ? (
              <div className="text-center py-8">Loading files...</div>
            ) : files.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No files uploaded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left">#</th>
                      <th className="px-3 py-2 text-left">File</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-left">Source</th>
                      <th className="px-3 py-2 text-left">Size</th>
                      <th className="px-3 py-2 text-center">Proprietary</th>
                      <th className="px-3 py-2 text-center">In Prompt</th>
                      <th className="px-3 py-2 text-left">Version</th>
                      <th className="px-3 py-2 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((file, index) => (
                      <tr
                        key={file.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, file)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDropReorder(e, file)}
                        className={`border-b hover:bg-gray-50 cursor-move ${
                          draggedItem?.id === file.id ? 'opacity-50' : ''
                        }`}
                      >
                        <td className="px-3 py-2 text-gray-500">{file.prompt_order}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{file.original_filename || file.filename}</div>
                          <div className="text-xs text-gray-500">{file.file_format?.toUpperCase()}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">
                            {file.file_type_label}
                          </span>
                        </td>
                        <td className="px-3 py-2">{getSourceBadge(file.file_source)}</td>
                        <td className="px-3 py-2">{formatFileSize(file.file_size)}</td>
                        <td className="px-3 py-2 text-center">
                          {file.proprietary ? (
                            <span className={`px-2 py-0.5 rounded text-xs ${
                              file.proprietary_confirmed_by
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {file.proprietary_confirmed_by ? 'Confirmed' : 'Unconfirmed'}
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => handleToggleIncludeInPrompt(file)}
                            className={`px-2 py-0.5 rounded text-xs ${
                              file.include_in_chat_prompt
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {file.include_in_chat_prompt ? 'Yes' : 'No'}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {file.file_version || '-'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <button
                              onClick={() => openEditModal(file)}
                              className="text-blue-600 hover:text-blue-800 text-xs"
                            >
                              Edit
                            </button>
                            <span className="text-gray-300">|</span>
                            <button
                              onClick={() => handleDelete(file.id)}
                              className="text-red-600 hover:text-red-800 text-xs"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Upload Section */}
          <div className="bg-white border rounded-lg p-6 mb-4">
            <h3 className="text-lg font-semibold mb-4">Upload New File</h3>

            <div className="grid grid-cols-2 gap-6">
              {/* Left Column - File Type and Options */}
              <div className="space-y-4">
                <div>
                  <label className="font-medium block mb-2">File Type:</label>
                  <select
                    value={uploadFileType}
                    onChange={(e) => setUploadFileType(e.target.value)}
                    className="border rounded px-3 py-2 w-full"
                  >
                    {PREDEFINED_FILE_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                    <option value="other">Other (custom)...</option>
                  </select>
                  {uploadFileType === 'other' && (
                    <input
                      type="text"
                      value={uploadCustomType}
                      onChange={(e) => setUploadCustomType(e.target.value)}
                      placeholder="Enter custom type label"
                      className="border rounded px-3 py-2 w-full mt-2"
                    />
                  )}
                </div>

                <div className="flex items-center gap-4">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={uploadProprietary}
                      onChange={(e) => setUploadProprietary(e.target.checked)}
                      className="mr-2"
                    />
                    <span className="text-sm">Proprietary content</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={uploadIncludeInPrompt}
                      onChange={(e) => setUploadIncludeInPrompt(e.target.checked)}
                      className="mr-2"
                    />
                    <span className="text-sm">Include in chat prompt</span>
                  </label>
                </div>

                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="font-medium block mb-1 text-sm">Prompt Order:</label>
                    <input
                      type="number"
                      value={uploadPromptOrder}
                      onChange={(e) => setUploadPromptOrder(parseInt(e.target.value) || 0)}
                      className="border rounded px-3 py-2 w-full"
                      min="0"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="font-medium block mb-1 text-sm">Version (optional):</label>
                    <input
                      type="text"
                      value={uploadVersion}
                      onChange={(e) => setUploadVersion(e.target.value)}
                      placeholder="e.g., Fall 2025"
                      className="border rounded px-3 py-2 w-full"
                    />
                  </div>
                </div>
              </div>

              {/* Right Column - Drop Zone */}
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 cursor-pointer flex flex-col justify-center"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.doc,.txt,.md,.jpg,.jpeg,.png"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <p className="text-gray-600">
                  {isUploading ? 'Uploading...' : 'Click to choose file or drag and drop'}
                </p>
                <p className="text-sm text-gray-500 mt-2">
                  PDF, DOCX, DOC, TXT, MD, JPG, PNG (max 10MB)
                </p>
              </div>
            </div>
          </div>

          {/* URL Import Section */}
          <div className="bg-white border rounded-lg p-6 mb-4">
            <h3 className="text-lg font-semibold mb-4">Import file from URL</h3>
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="font-medium block mb-1 text-sm">URL:</label>
                <input
                  type="url"
                  value={downloadUrl}
                  onChange={(e) => setDownloadUrl(e.target.value)}
                  placeholder="https://example.com/document.pdf"
                  className="border rounded px-3 py-2 w-full"
                />
              </div>
              <div className="w-48">
                <label className="font-medium block mb-1 text-sm">File Type:</label>
                <select
                  value={downloadFileType}
                  onChange={(e) => setDownloadFileType(e.target.value)}
                  className="border rounded px-3 py-2 w-full"
                >
                  {PREDEFINED_FILE_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                  <option value="other">Other...</option>
                </select>
              </div>
              {downloadFileType === 'other' && (
                <div className="w-40">
                  <label className="font-medium block mb-1 text-sm">Custom:</label>
                  <input
                    type="text"
                    value={downloadCustomType}
                    onChange={(e) => setDownloadCustomType(e.target.value)}
                    placeholder="Label"
                    className="border rounded px-3 py-2 w-full"
                  />
                </div>
              )}
              <button
                onClick={handleDownloadUrl}
                disabled={isDownloading || !downloadUrl.trim()}
                className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 disabled:bg-gray-400"
              >
                {isDownloading ? 'Downloading...' : 'Download'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Edit Modal */}
      {editingFile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-lg p-6">
            <h3 className="text-xl font-bold mb-4">Edit File Metadata</h3>
            <p className="text-sm text-gray-600 mb-4">
              {editingFile.original_filename || editingFile.filename}
            </p>

            <div className="space-y-4">
              <div>
                <label className="font-medium block mb-1">File Type:</label>
                <select
                  value={editFileType}
                  onChange={(e) => setEditFileType(e.target.value)}
                  className="border rounded px-3 py-2 w-full"
                >
                  {PREDEFINED_FILE_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                  <option value="other">Other (custom)...</option>
                </select>
                {editFileType === 'other' && (
                  <input
                    type="text"
                    value={editCustomType}
                    onChange={(e) => setEditCustomType(e.target.value)}
                    placeholder="Enter custom type label"
                    className="border rounded px-3 py-2 w-full mt-2"
                  />
                )}
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={editProprietary}
                    onChange={(e) => setEditProprietary(e.target.checked)}
                    className="mr-2"
                  />
                  Proprietary content
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={editIncludeInPrompt}
                    onChange={(e) => setEditIncludeInPrompt(e.target.checked)}
                    className="mr-2"
                  />
                  Include in chat prompt
                </label>
              </div>

              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="font-medium block mb-1">Prompt Order:</label>
                  <input
                    type="number"
                    value={editPromptOrder}
                    onChange={(e) => setEditPromptOrder(parseInt(e.target.value) || 0)}
                    className="border rounded px-3 py-2 w-full"
                    min="0"
                  />
                </div>
                <div className="flex-1">
                  <label className="font-medium block mb-1">Version:</label>
                  <input
                    type="text"
                    value={editVersion}
                    onChange={(e) => setEditVersion(e.target.value)}
                    placeholder="e.g., Fall 2025"
                    className="border rounded px-3 py-2 w-full"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setEditingFile(null)}
                className="px-4 py-2 border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Proprietary Confirmation Modal */}
      {confirmingFile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-red-600 mb-4">Proprietary Content Warning</h3>
            <p className="text-gray-700 mb-4">
              The file "<strong>{confirmingFile.original_filename || confirmingFile.filename}</strong>" is marked as proprietary.
            </p>
            <p className="text-gray-700 mb-4">
              Including it in AI chat prompts may violate copyright or licensing terms.
            </p>
            <p className="text-gray-700 mb-4">
              By confirming, you acknowledge that you have the right to use this content with AI systems.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmingFile(null)}
                className="px-4 py-2 border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmProprietary}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                I Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
