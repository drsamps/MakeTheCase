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
