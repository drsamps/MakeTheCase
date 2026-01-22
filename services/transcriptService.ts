import { api } from './apiClient';

export interface Transcript {
  id: string;
  case_chat_id: string;
  transcript: string;
  is_anonymized: boolean;
  anonymized_at: string | null;
  created_at: string;
  word_count: number;
  saved_with_permission: boolean;
  // Joined fields
  student_id?: string;
  student_name?: string;
  case_id?: string;
  case_title?: string;
  section_id?: string;
  section_title?: string;
}

export interface TranscriptListResponse {
  data: Transcript[];
  total: number;
  limit: number;
  offset: number;
  error: null | { message: string };
}

/**
 * Save a transcript for a case_chat
 */
export const saveTranscript = async (
  caseChatId: string,
  transcript: string,
  savedWithPermission: boolean = false
): Promise<{ data: Transcript | null; error: any }> => {
  try {
    const response = await api.post('/transcripts', {
      case_chat_id: caseChatId,
      transcript,
      saved_with_permission: savedWithPermission
    });
    return { data: response.data, error: null };
  } catch (error: any) {
    console.error('Error saving transcript:', error);
    return {
      data: null,
      error: error.response?.data?.error || { message: error.message }
    };
  }
};

/**
 * Get transcript by ID
 */
export const getTranscript = async (
  transcriptId: string
): Promise<{ data: Transcript | null; error: any }> => {
  try {
    const response = await api.get(`/transcripts/${transcriptId}`);
    return { data: response.data, error: null };
  } catch (error: any) {
    console.error('Error fetching transcript:', error);
    return {
      data: null,
      error: error.response?.data?.error || { message: error.message }
    };
  }
};

/**
 * Get transcript by case_chat_id
 */
export const getTranscriptForChat = async (
  caseChatId: string
): Promise<{ data: Transcript | null; error: any }> => {
  try {
    const response = await api.get(`/transcripts/chat/${caseChatId}`);
    return { data: response.data, error: null };
  } catch (error: any) {
    console.error('Error fetching transcript for chat:', error);
    return {
      data: null,
      error: error.response?.data?.error || { message: error.message }
    };
  }
};

/**
 * Anonymize a transcript
 */
export const anonymizeTranscript = async (
  transcriptId: string,
  anonymizedTranscript?: string
): Promise<{ data: Transcript | null; error: any }> => {
  try {
    const response = await api.patch(`/transcripts/${transcriptId}/anonymize`, {
      anonymized_transcript: anonymizedTranscript
    });
    return { data: response.data, error: null };
  } catch (error: any) {
    console.error('Error anonymizing transcript:', error);
    return {
      data: null,
      error: error.response?.data?.error || { message: error.message }
    };
  }
};

/**
 * Delete a transcript (admin only)
 */
export const deleteTranscript = async (
  transcriptId: string
): Promise<{ data: { deleted: boolean } | null; error: any }> => {
  try {
    const response = await api.delete(`/transcripts/${transcriptId}`);
    return { data: response.data, error: null };
  } catch (error: any) {
    console.error('Error deleting transcript:', error);
    return {
      data: null,
      error: error.response?.data?.error || { message: error.message }
    };
  }
};

/**
 * List transcripts with filters (admin only)
 */
export const listTranscripts = async (filters: {
  section_id?: string;
  case_id?: string;
  is_anonymized?: boolean;
  older_than_days?: number;
  limit?: number;
  offset?: number;
}): Promise<TranscriptListResponse> => {
  try {
    const params = new URLSearchParams();
    if (filters.section_id) params.set('section_id', filters.section_id);
    if (filters.case_id) params.set('case_id', filters.case_id);
    if (filters.is_anonymized !== undefined) params.set('is_anonymized', String(filters.is_anonymized));
    if (filters.older_than_days) params.set('older_than_days', String(filters.older_than_days));
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.offset) params.set('offset', String(filters.offset));

    const response = await api.get(`/transcripts?${params.toString()}`);
    return {
      data: response.data,
      total: response.total,
      limit: response.limit,
      offset: response.offset,
      error: null
    };
  } catch (error: any) {
    console.error('Error listing transcripts:', error);
    return {
      data: [],
      total: 0,
      limit: 0,
      offset: 0,
      error: error.response?.data?.error || { message: error.message }
    };
  }
};

/**
 * Bulk anonymize transcripts (admin only)
 */
export const bulkAnonymizeTranscripts = async (params: {
  transcript_ids?: string[];
  older_than_days?: number;
}): Promise<{ data: { anonymized_count: number; message: string } | null; error: any }> => {
  try {
    const response = await api.post('/transcripts/bulk-anonymize', params);
    return { data: response.data, error: null };
  } catch (error: any) {
    console.error('Error bulk anonymizing transcripts:', error);
    return {
      data: null,
      error: error.response?.data?.error || { message: error.message }
    };
  }
};
