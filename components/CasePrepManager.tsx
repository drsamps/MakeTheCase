import React, { useState, useEffect, useRef } from 'react';
import { api, getApiBaseUrl } from '../services/apiClient';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Case {
  case_id: string;
  case_title: string;
}

interface Model {
  model_id: string;
  model_name: string;
  enabled: boolean;
}

interface CasePrepFile {
  id: number;
  case_id: string;
  filename: string;
  file_type: 'case' | 'notes';
  processing_status: 'pending' | 'processing' | 'completed' | 'failed' | null;
  processing_model: string | null;
  processing_error: string | null;
  outline_content: string | null;
  processed_at: string | null;
  created_at: string;
}

export const CasePrepManager: React.FC = () => {
  const [cases, setCases] = useState<Case[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedCase, setSelectedCase] = useState<string>('');
  const [fileType, setFileType] = useState<'case' | 'notes'>('case');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [files, setFiles] = useState<CasePrepFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingFile, setEditingFile] = useState<CasePrepFile | null>(null);
  const [editingOutline, setEditingOutline] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [showPreview, setShowPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);
  const [processingElapsed, setProcessingElapsed] = useState<number>(0);
  const [processingFileId, setProcessingFileId] = useState<number | null>(null);
  const [previousOutline, setPreviousOutline] = useState<string>('');
  const [pollIntervalId, setPollIntervalId] = useState<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const initialize = async () => {
      setIsInitializing(true);
      try {
        await Promise.all([fetchCases(), fetchModels()]);
      } catch (err) {
        console.error('Failed to initialize Case Prep:', err);
      } finally {
        setIsInitializing(false);
      }
    };
    initialize();
  }, []);

  useEffect(() => {
    if (selectedCase && selectedCase.trim() !== '') {
      fetchFiles(selectedCase);
    }
  }, [selectedCase]);

  // Track elapsed time during reprocessing
  useEffect(() => {
    if (processingStartTime) {
      const timer = setInterval(() => {
        setProcessingElapsed(Math.floor((Date.now() - processingStartTime) / 1000));
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [processingStartTime]);

  // Cleanup polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
      }
    };
  }, [pollIntervalId]);

  const fetchCases = async () => {
    try {
      console.log('[CasePrep] Fetching cases...');
      const response = await api.get('/cases');
      console.log('[CasePrep] Cases response:', response);
      if (response.error) {
        console.error('[CasePrep] Error in cases response:', response.error);
        setError(`Failed to fetch cases: ${response.error.message}`);
        return;
      }
      if (response.data) {
        console.log('[CasePrep] Setting cases:', response.data);
        setCases(response.data);
        if (response.data.length > 0 && !selectedCase) {
          setSelectedCase(response.data[0].case_id);
        }
      }
    } catch (err: any) {
      console.error('[CasePrep] Exception fetching cases:', err);
      setError(`Failed to fetch cases: ${err.message || 'Unknown error'}`);
    }
  };

  const fetchModels = async () => {
    try {
      console.log('[CasePrep] Fetching models...');
      const response = await api.get('/models?enabled=true');
      console.log('[CasePrep] Models response:', response);
      if (response.error) {
        console.error('[CasePrep] Error in models response:', response.error);
        setError(`Failed to fetch models: ${response.error.message}`);
        return;
      }
      if (response.data) {
        console.log('[CasePrep] Setting models:', response.data);
        setModels(response.data);
        if (response.data.length > 0 && !selectedModel) {
          setSelectedModel(response.data[0].model_id);
        }
      }
    } catch (err: any) {
      console.error('[CasePrep] Exception fetching models:', err);
      setError(`Failed to fetch models: ${err.message || 'Unknown error'}`);
    }
  };

  const fetchFiles = async (caseId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get(`/case-prep/${caseId}/files`);
      if (response.error) {
        console.error('Error fetching files:', response.error);
        setError(response.error.message || 'Failed to fetch files');
        setFiles([]);
      } else if (response.data) {
        setFiles(response.data);
      }
    } catch (err: any) {
      console.error('Exception fetching files:', err);
      setError(err.message || 'Failed to fetch files');
      setFiles([]);
    } finally {
      setIsLoading(false);
    }
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

    setIsUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('file_type', fileType);

      const token = localStorage.getItem('token') || localStorage.getItem('auth_token');
      if (!token) {
        throw new Error('Not authenticated. Please log in again.');
      }
      // For file uploads, bypass Vite proxy and go directly to backend server
      // Vite proxy doesn't handle FormData/binary uploads well
      const uploadUrl = `http://localhost:3001/api/case-prep/${selectedCase}/upload`;
      console.log('[CasePrep] Uploading file:', file.name);
      console.log('[CasePrep] Case ID:', selectedCase);
      console.log('[CasePrep] Upload URL:', uploadUrl);
      console.log('[CasePrep] File type:', fileType);
      console.log('[CasePrep] Token available:', !!token);
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      console.log('[CasePrep] Upload response status:', response.status);

      if (!response.ok) {
        // Try to parse as JSON, but fall back to text if that fails
        const contentType = response.headers.get('content-type');
        let errorMessage = 'Upload failed';
        
        try {
          if (contentType && contentType.includes('application/json')) {
            const errorData = await response.json();
            errorMessage = errorData.error?.message || errorData.error || 'Upload failed';
          } else {
            const textData = await response.text();
            console.error('[CasePrep] Server returned non-JSON response:', textData.substring(0, 500));
            errorMessage = `Server error (${response.status}): ${response.statusText}`;
          }
        } catch (parseErr) {
          console.error('[CasePrep] Failed to parse error response:', parseErr);
          errorMessage = `Upload failed with status ${response.status}`;
        }
        
        throw new Error(errorMessage);
      }

      console.log('[CasePrep] Upload successful');
      await fetchFiles(selectedCase);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err: any) {
      console.error('[CasePrep] Upload error:', err);
      setError(err.message || 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleProcess = async (fileId: number) => {
    if (!selectedModel) {
      alert('Please select a model');
      return;
    }

    setIsProcessing(true);
    setError(null);
    try {
      await api.post(`/case-prep/${selectedCase}/process`, {
        file_id: fileId,
        model_id: selectedModel,
      });

      // Poll for completion
      const pollInterval = setInterval(async () => {
        const response = await api.get(`/case-prep/${selectedCase}/files`);
        if (response.data) {
          const updatedFile = response.data.find((f: CasePrepFile) => f.id === fileId);
          if (updatedFile && updatedFile.processing_status !== 'processing') {
            setFiles(response.data);
            clearInterval(pollInterval);
            setIsProcessing(false);
          }
        }
      }, 2000);

      // Stop polling after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        setIsProcessing(false);
      }, 300000);
    } catch (err: any) {
      setError(err.message || 'Processing failed');
      setIsProcessing(false);
    }
  };

  const handleEdit = async (file: CasePrepFile) => {
    setEditingFile(file);
    setEditingOutline(file.outline_content || '');
    setShowPreview(true);

    // Fetch original file content
    try {
      const response = await api.get(`/case-prep/files/${file.id}/content`);
      if (response.data && response.data.text) {
        setOriginalContent(response.data.text);
      }
    } catch (err) {
      console.error('Failed to fetch original content:', err);
      setOriginalContent('Failed to load original content');
    }
  };

  const handleSave = async () => {
    if (!editingFile) return;

    setIsSaving(true);
    setError(null);
    try {
      await api.patch(`/case-prep/files/${editingFile.id}/outline`, {
        outline_content: editingOutline,
      });

      await fetchFiles(selectedCase);
      setEditingFile(null);
      setShowPreview(false);
    } catch (err: any) {
      setError(err.message || 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReprocess = async () => {
    if (!editingFile) return;

    if (!confirm('Re-process this file? This will generate a new outline (takes 1-2 minutes).')) {
      return;
    }

    // Store current outline for potential revert
    setPreviousOutline(editingOutline);
    
    // Keep modal open and show processing state
    setIsReprocessing(true);
    setProcessingStartTime(Date.now());
    setProcessingFileId(editingFile.id);
    
    try {
      await api.post(`/case-prep/${selectedCase}/process`, {
        file_id: editingFile.id,
        model_id: selectedModel,
      });

      // Poll for completion
      const pollInterval = setInterval(async () => {
        const response = await api.get(`/case-prep/${selectedCase}/files`);
        if (response.data) {
          const updatedFile = response.data.find((f: CasePrepFile) => f.id === editingFile.id);
          if (updatedFile && updatedFile.processing_status !== 'processing') {
            clearInterval(pollInterval);
            setPollIntervalId(null);
            setIsReprocessing(false);
            setProcessingStartTime(null);
            setProcessingElapsed(0);
            setProcessingFileId(null);
            
            if (updatedFile.processing_status === 'completed') {
              // Update the editing state with new outline
              setEditingFile(updatedFile);
              setEditingOutline(updatedFile.outline_content || '');
              setFiles(response.data);
              alert('✅ Outline generated successfully!');
            } else if (updatedFile.processing_status === 'failed') {
              setError(`Processing failed: ${updatedFile.processing_error || 'Unknown error'}`);
              setFiles(response.data);
            }
          }
        }
      }, 2000);

      setPollIntervalId(pollInterval);

      // Stop polling after 3 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        if (isReprocessing) {
          setPollIntervalId(null);
          setIsReprocessing(false);
          setProcessingStartTime(null);
          setProcessingElapsed(0);
          setProcessingFileId(null);
          setError('Processing is taking longer than expected. Please close and check the file list.');
        }
      }, 180000);
    } catch (err: any) {
      setIsReprocessing(false);
      setProcessingStartTime(null);
      setProcessingElapsed(0);
      setProcessingFileId(null);
      setPollIntervalId(null);
      setError(err.message || 'Re-processing failed');
    }
  };

  const handleAbortReprocess = () => {
    if (pollIntervalId) {
      clearInterval(pollIntervalId);
      setPollIntervalId(null);
    }
    
    // Revert to previous outline
    setEditingOutline(previousOutline);
    setIsReprocessing(false);
    setProcessingStartTime(null);
    setProcessingElapsed(0);
    setProcessingFileId(null);
    
    alert('⚠️ Regeneration aborted. Reverted to previous outline.');
  };

  const handleBackgroundProcess = () => {
    // Just close the modal, let polling continue in background
    setEditingFile(null);
    setShowPreview(false);
    
    alert('✓ Processing in background. You can continue working. Check back in 1-2 minutes.');
  };

  const getStatusBadge = (status: string | null) => {
    // Handle null or undefined status (old records before migration)
    const normalizedStatus = status || 'pending';
    
    const classes = {
      pending: 'bg-yellow-200 text-yellow-800',
      processing: 'bg-blue-200 text-blue-800',
      completed: 'bg-green-200 text-green-800',
      failed: 'bg-red-200 text-red-800',
    };
    return (
      <span className={`px-2 py-1 rounded text-xs font-semibold ${classes[normalizedStatus as keyof typeof classes] || 'bg-gray-200 text-gray-800'}`}>
        {normalizedStatus.toUpperCase()}
      </span>
    );
  };

  // Check if we have no cases or models available
  const noCasesAvailable = !isInitializing && cases.length === 0;
  const noModelsAvailable = !isInitializing && models.length === 0;

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-6">Case Prep</h2>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {isInitializing ? (
        <div className="bg-white border rounded-lg p-8 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mb-4"></div>
          <p className="text-gray-600">Loading Case Prep...</p>
        </div>
      ) : noCasesAvailable ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-8 text-center">
          <h3 className="text-xl font-semibold text-yellow-900 mb-2">No Cases Available</h3>
          <p className="text-yellow-700 mb-4">
            There are no cases in the database yet. Please add a case first before using Case Prep.
          </p>
          <p className="text-sm text-yellow-600">
            Go to the "Cases" tab to create your first case.
          </p>
        </div>
      ) : noModelsAvailable ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-8 text-center">
          <h3 className="text-xl font-semibold text-yellow-900 mb-2">No Models Available</h3>
          <p className="text-yellow-700 mb-4">
            There are no enabled AI models configured. Please enable at least one model first.
          </p>
          <p className="text-sm text-yellow-600">
            Go to the "Models+" tab to enable a model.
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

      {/* Upload Section */}
      <div className="bg-white border rounded-lg p-6 mb-4">
        <h3 className="text-lg font-semibold mb-4">Upload New File</h3>

        <div className="space-y-4">
          <div>
            <label className="font-semibold mb-2 block">File Type:</label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  value="case"
                  checked={fileType === 'case'}
                  onChange={(e) => setFileType(e.target.value as 'case')}
                  className="mr-2"
                />
                Case Document
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="notes"
                  checked={fileType === 'notes'}
                  onChange={(e) => setFileType(e.target.value as 'notes')}
                  className="mr-2"
                />
                Teaching Notes
              </label>
            </div>
          </div>

          <div>
            <label className="font-semibold mb-2 block">Model for Processing:</label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="border rounded px-3 py-2 w-full max-w-md"
            >
              {models.map(m => (
                <option key={m.model_id} value={m.model_id}>
                  {m.model_name} ({m.model_id})
                </option>
              ))}
            </select>
          </div>

          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt,.md"
              onChange={handleFileSelect}
              className="hidden"
            />
            <p className="text-gray-600">
              {isUploading ? 'Uploading...' : 'Click to choose file or drag and drop'}
            </p>
            <p className="text-sm text-gray-500 mt-2">
              Supported formats: PDF, DOCX, DOC, TXT, MD (max 10MB)
            </p>
          </div>
        </div>
      </div>

      {/* Files List */}
      <div className="bg-white border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Uploaded Files</h3>

        {/* Background Processing Banner */}
        {processingFileId && !editingFile && (
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
              <div>
                <p className="font-semibold text-blue-900">
                  ⚡ Processing outline in background: {files.find(f => f.id === processingFileId)?.filename || `File #${processingFileId}`}
                </p>
                <p className="text-sm text-blue-700">
                  Elapsed: {processingElapsed}s • Estimated: 1-2 minutes
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                const file = files.find(f => f.id === processingFileId);
                if (file) handleEdit(file);
              }}
              className="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
            >
              View Status
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-8">Loading files...</div>
        ) : files.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No files uploaded yet. Upload a file above to get started.
          </div>
        ) : (
          <div className="space-y-3">
            {files.map(file => (
              <div 
                key={file.id} 
                className={`border rounded-lg p-4 hover:bg-gray-50 ${
                  file.id === processingFileId ? 'bg-blue-50 border-blue-300' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      {file.id === processingFileId && (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                      )}
                      <span className="font-semibold">{file.filename}</span>
                      {getStatusBadge(file.processing_status)}
                      <span className="text-sm text-gray-500">
                        ({file.file_type === 'case' ? 'Case Document' : 'Teaching Notes'})
                      </span>
                    </div>
                    {file.processing_model && (
                      <div className="text-sm text-gray-600 mt-1">
                        Model: {file.processing_model}
                      </div>
                    )}
                    {file.processing_error && (
                      <div className="text-sm text-red-600 mt-1">
                        Error: {file.processing_error}
                      </div>
                    )}
                    {file.processed_at && (
                      <div className="text-xs text-gray-500 mt-1">
                        Processed: {new Date(file.processed_at).toLocaleString()}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    {(file.processing_status === 'pending' || file.processing_status === null) && (
                      <button
                        onClick={() => handleProcess(file.id)}
                        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                        disabled={isProcessing}
                      >
                        Process
                      </button>
                    )}
                    {file.processing_status === 'completed' && (
                      <button
                        onClick={() => handleEdit(file)}
                        className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                      >
                        Edit Outline
                      </button>
                    )}
                    {file.processing_status === 'failed' && (
                      <button
                        onClick={() => handleProcess(file.id)}
                        className="bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700"
                        disabled={isProcessing}
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
        </>
      )}

      {/* Side-by-Side Editor Modal */}
      {editingFile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-7xl h-[90vh] flex flex-col relative">
            {/* Processing Overlay */}
            {isReprocessing && (
              <div className="absolute inset-0 bg-white bg-opacity-95 z-10 flex items-center justify-center rounded-lg">
                <div className="text-center max-w-2xl px-6">
                  <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mb-4"></div>
                  <h3 className="text-xl font-semibold mb-2">Generating Outline with AI...</h3>
                  <p className="text-gray-600 mb-2">
                    This typically takes 1-2 minutes depending on document length.
                  </p>
                  <p className="text-sm text-gray-500 mb-6">
                    Elapsed time: {processingElapsed} seconds
                  </p>
                  
                  {/* Action Buttons */}
                  <div className="flex gap-3 justify-center mb-4">
                    <button
                      onClick={handleBackgroundProcess}
                      className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 flex items-center gap-2"
                    >
                      <span>⚡</span>
                      <span>Continue in Background</span>
                    </button>
                    <button
                      onClick={handleAbortReprocess}
                      className="bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 flex items-center gap-2"
                    >
                      <span>✕</span>
                      <span>Abort & Revert</span>
                    </button>
                  </div>
                  
                  <div className="text-xs text-gray-500 space-y-1">
                    <p>• <strong>Continue in Background:</strong> Close this window and do other work. You'll be notified when complete.</p>
                    <p>• <strong>Abort & Revert:</strong> Stop processing and restore your previous outline.</p>
                  </div>
                  
                  {processingElapsed > 90 && (
                    <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
                      <p className="text-yellow-800 text-sm">
                        ⏱️ Taking longer than usual. The AI is working on a very detailed outline.
                        Feel free to continue in background!
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Header */}
            <div className="p-4 border-b flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold">
                  Editing: {editingFile.filename}
                </h3>
                <p className="text-sm text-gray-600">
                  Model: {editingFile.processing_model}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleReprocess}
                  className="bg-orange-500 text-white px-4 py-2 rounded hover:bg-orange-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  disabled={isSaving || isReprocessing}
                >
                  {isReprocessing ? 'Processing...' : 'Re-Process'}
                </button>
                <button
                  onClick={handleSave}
                  className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  disabled={isSaving || isReprocessing}
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => {
                    if (isReprocessing) {
                      // Processing continues in background
                      handleBackgroundProcess();
                    } else {
                      setEditingFile(null);
                      setShowPreview(false);
                    }
                  }}
                  className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
                  disabled={isSaving}
                >
                  {isReprocessing ? 'Close (Continue in Background)' : 'Cancel'}
                </button>
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 flex overflow-hidden">
              {/* Left Pane - Original Content */}
              <div className="w-1/2 border-r overflow-auto p-4">
                <h4 className="font-semibold mb-2 sticky top-0 bg-white pb-2">Original Document</h4>
                <div className="prose max-w-none">
                  <pre className="whitespace-pre-wrap text-sm">{originalContent}</pre>
                </div>
              </div>

              {/* Right Pane - Markdown Editor + Preview */}
              <div className="w-1/2 flex flex-col">
                {/* Editor */}
                <div className="flex-1 p-4 border-b overflow-auto">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-semibold">Markdown Outline</h4>
                    <button
                      onClick={() => setShowPreview(!showPreview)}
                      className="text-sm bg-gray-200 px-3 py-1 rounded hover:bg-gray-300"
                    >
                      {showPreview ? 'Hide Preview' : 'Show Preview'}
                    </button>
                  </div>
                  <textarea
                    value={editingOutline}
                    onChange={(e) => setEditingOutline(e.target.value)}
                    className="w-full h-full border rounded p-3 font-mono text-sm resize-none"
                    placeholder="Enter markdown outline..."
                  />
                </div>

                {/* Preview */}
                {showPreview && (
                  <div className="flex-1 p-4 overflow-auto bg-gray-50">
                    <h4 className="font-semibold mb-2">Preview</h4>
                    <div className="prose max-w-none bg-white p-4 rounded border">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {editingOutline}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
