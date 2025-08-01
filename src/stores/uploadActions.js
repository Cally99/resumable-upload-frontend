import axios from 'axios';
import { useUploadStore } from './uploadStore';
import { UPLOAD_STATUS } from './uploadTypes';
import { indexedDBService } from '../services/indexedDBService';

// Create API client
const createApiClient = () => {
  const baseURL = process.env.REACT_APP_API_URL || 'http://localhost:4000/api/uploads';

  const client = axios.create({
    baseURL: baseURL,
    timeout: 30000,
    headers: {
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  });

  client.interceptors.response.use(
    (res) => res,
    (error) => Promise.reject(error)
  );

  return client;
};

// Helper: classify retryable errors
const isRetryableError = (error) => {
  if (!error || !error.response) {
    // Network error / CORS / timeout -> retryable
    return true;
  }
  const status = error.response.status;
  // 408, 425, 429, 5xx are retryable
  if (status === 408 || status === 425 || status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
};

// Helper: exponential backoff with full jitter
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoffDelay = (attempt, base = 1000, max = 30000) => {
  const expo = Math.min(max, base * Math.pow(2, attempt));
  // Full jitter [0, expo]
  return Math.floor(Math.random() * expo);
};

// Generic retry wrapper for API calls
const withRetry = async (fn, { retries = 5, base = 1000, max = 30000 } = {}) => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries || !isRetryableError(error)) {
        throw error;
      }
      const delay = backoffDelay(attempt, base, max);
      await sleep(delay);
    }
  }
};

// Startup reconciliation: refresh server status and optionally auto-resume
const reconcileFromServer = async (uploadId) => {
  const apiClient = createApiClient();
  const { getUpload, updateProgress, setUploadStatus } = useUploadStore.getState();
  const local = getUpload(uploadId);
  if (!local) return;

  try {
    const res = await withRetry(() => apiClient.get(`/${uploadId}/status`));
    const server = res.data;

    // Update local chunks and progress with server truth
    updateProgress(uploadId, server.uploadedChunks || [], local.chunkSize, local.filesize);

    if (server.status === 'completed') {
      setUploadStatus(uploadId, UPLOAD_STATUS.COMPLETED);
    } else if (server.status === 'paused') {
      setUploadStatus(uploadId, UPLOAD_STATUS.PAUSED);
    } else if (server.status === 'uploading') {
      // leave as-is; client will decide next step
    }
  } catch (err) {
    useUploadStore.getState().updateUpload(uploadId, {
      lastError: `Failed to reconcile status: ${err?.message || 'unknown error'}`,
      lastErrorAt: new Date().toISOString()
    });
  }
};

// New: restore file from IndexedDB after refresh
async function restoreFileFromIndexedDB(uploadId) {
  const { getUpload, updateUpload } = useUploadStore.getState();
  const u = getUpload(uploadId);
  if (!u) return false;

  try {
    // Try to get the file from IndexedDB
    const file = await indexedDBService.getFile(uploadId);
    
    if (file) {
      // File found in IndexedDB, restore it
      updateUpload(uploadId, {
        file,
        lastError: undefined,
        needsFile: false
      });
      return true;
    } else {
      // File not found in IndexedDB
      updateUpload(uploadId, {
        lastError: 'File not found in storage. Please restart the upload.',
        lastErrorAt: new Date().toISOString(),
        needsFile: true
      });
      return false;
    }
  } catch (error) {
    console.error('Failed to restore file from IndexedDB:', error);
    updateUpload(uploadId, {
      lastError: 'Failed to restore file. Please restart the upload.',
      lastErrorAt: new Date().toISOString(),
      needsFile: true
    });
    return false;
  }
}

// Guard: ensure we have a File instance before chunking
async function ensureFileAvailable(uploadId) {
  const { getUpload, setUploadStatus } = useUploadStore.getState();
  const u = getUpload(uploadId);
  if (!u) return false;

  if (!u.file || typeof u.file.slice !== 'function') {
    // Try to restore file from IndexedDB
    const restored = await restoreFileFromIndexedDB(uploadId);
    if (!restored) {
      setUploadStatus(uploadId, UPLOAD_STATUS.PAUSED);
      return false;
    }
  }
  return true;
}

export const uploadActions = {
  // Initialize upload on server
  async initiateUpload(file) {
    const { addUpload, removeUpload, clearStaleUploads, setError } = useUploadStore.getState();

    try {
      clearStaleUploads(file);

      const tempUploadId = 'temp_' + Date.now();
      const tempUpload = {
        uploadId: tempUploadId,
        file, // NOT persisted; store migration strips it
        filename: file.name,
        filetype: file.type,
        filesize: file.size,
        status: UPLOAD_STATUS.INITIATING,
        uploadedBytes: 0,
        progress: 0,
        uploadedChunks: [],
        chunkSize: 5242880, // 5MB
        totalChunks: Math.ceil(file.size / 5242880),
        createdAt: new Date().toISOString(),
        isResuming: false,
        needsFile: false
      };

      addUpload(tempUpload);

      const apiClient = createApiClient();
      const response = await withRetry(() =>
        apiClient.post('/initiate', {
          filename: file.name,
          filetype: file.type,
          filesize: file.size
        })
      );

      const serverUploadId = response.data.uploadId;
      if (!serverUploadId) {
        throw new Error('Server did not return uploadId');
      }

      removeUpload(tempUploadId);

      const finalUpload = {
        ...tempUpload,
        uploadId: serverUploadId,
        status: UPLOAD_STATUS.PENDING,
        s3Key: response.data.s3Key,
        chunkSize: response.data.chunkSize || tempUpload.chunkSize,
        totalChunks: response.data.totalChunks || tempUpload.totalChunks
      };

      addUpload(finalUpload);
      return serverUploadId;
    } catch (error) {
      setError(error.message);
      throw error;
    }
  },

  // Start upload process
  async startUpload(uploadId) {
    const { getUpload, setUploadStatus, isOffline, updateUpload } = useUploadStore.getState();
    const upload = getUpload(uploadId);
    if (!upload) return;

    if (isOffline || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      updateUpload(uploadId, {
        lastError: 'You are offline. Upload paused.',
        lastErrorAt: new Date().toISOString()
      });
      setUploadStatus(uploadId, UPLOAD_STATUS.PAUSED);
      return;
    }

    if (!(await ensureFileAvailable(uploadId))) {
      // File not available, cannot start upload
      return;
    }

    setUploadStatus(uploadId, UPLOAD_STATUS.UPLOADING);
    await this.uploadChunks(uploadId);
  },

  // Upload chunks
  async uploadChunks(uploadId) {
    const { getUpload, updateProgress, setUploadStatus, setError } = useUploadStore.getState();
    let upload = getUpload(uploadId);
    if (!upload) return;

    if (upload.status !== UPLOAD_STATUS.UPLOADING) return;

    // Reconcile server status before attempting chunks
    try {
      await this.refreshStatus(uploadId);
    } catch (e) {
      useUploadStore.getState().updateUpload(uploadId, {
        lastError: `Status check failed: ${e?.message || 'unknown error'}`,
        lastErrorAt: new Date().toISOString()
      });
    }

    // Loop through chunks
    upload = getUpload(uploadId);
    for (let chunkIndex = 0; chunkIndex < upload.totalChunks; chunkIndex++) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setUploadStatus(uploadId, UPLOAD_STATUS.PAUSED);
        useUploadStore.getState().updateUpload(uploadId, {
          lastError: 'Network offline. Upload paused.',
          lastErrorAt: new Date().toISOString()
        });
        return;
      }

      const currentUpload = getUpload(uploadId);
      if (!currentUpload || currentUpload.status !== UPLOAD_STATUS.UPLOADING) {
        return; // Paused or canceled elsewhere
      }

      if (currentUpload.uploadedChunks.includes(chunkIndex)) {
        continue; // Skip already uploaded chunks
      }

      const success = await this.uploadChunk(uploadId, chunkIndex);
      if (!success) {
        setUploadStatus(uploadId, UPLOAD_STATUS.PAUSED);
        return;
      }

      // Update progress locally after successful chunk post
      const newUploadedChunks = [...currentUpload.uploadedChunks, chunkIndex];
      updateProgress(uploadId, newUploadedChunks, currentUpload.chunkSize, currentUpload.filesize);
    }

    // Complete upload if all chunks uploaded
    const apiClient = createApiClient();
    try {
      await withRetry(() => apiClient.post(`/${uploadId}/complete`));
      setUploadStatus(uploadId, UPLOAD_STATUS.COMPLETED);
    } catch (error) {
      setError(error.message);
      setUploadStatus(uploadId, UPLOAD_STATUS.FAILED);
      useUploadStore.getState().updateUpload(uploadId, {
        lastError: `Failed to complete upload: ${error?.message || 'unknown error'}`,
        lastErrorAt: new Date().toISOString()
      });
    }
  },

  // Upload a single chunk with retry logic + jitter + offline checks
  async uploadChunk(uploadId, chunkIndex) {
    const { getUpload } = useUploadStore.getState();
    const upload = getUpload(uploadId);
    if (!upload) return false;

    // Ensure we have a file object
    if (!(await ensureFileAvailable(uploadId))) {
      return false;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      useUploadStore.getState().setUploadStatus(uploadId, UPLOAD_STATUS.PAUSED);
      useUploadStore.getState().updateUpload(uploadId, {
        lastError: 'Offline during chunk upload.',
        lastErrorAt: new Date().toISOString()
      });
      return false;
    }

    const start = chunkIndex * upload.chunkSize;
    const end = Math.min(start + upload.chunkSize, upload.filesize);
    const chunk = upload.file.slice(start, end);

    const formData = new FormData();
    formData.append('chunk', chunk);
    formData.append('chunkIndex', chunkIndex);
    formData.append('totalChunks', upload.totalChunks);

    const apiClient = createApiClient();
    try {
      await withRetry(() =>
        apiClient.post(`/${uploadId}/chunk`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 60000
        })
      );
      return true;
    } catch (error) {
      useUploadStore.getState().updateUpload(uploadId, {
        lastError: `Chunk ${chunkIndex} failed: ${error?.message || 'unknown error'}`,
        lastErrorAt: new Date().toISOString()
      });
      return false;
    }
  },

  // Pause upload
  async pauseUpload(uploadId) {
    const { setUploadStatus } = useUploadStore.getState();

    try {
      const apiClient = createApiClient();
      await withRetry(() => apiClient.post(`/${uploadId}/pause`));
      setUploadStatus(uploadId, UPLOAD_STATUS.PAUSED);
    } catch (error) {
      setUploadStatus(uploadId, UPLOAD_STATUS.PAUSED);
      useUploadStore.getState().updateUpload(uploadId, {
        lastError: `Pause error: ${error?.message || 'unknown error'}`,
        lastErrorAt: new Date().toISOString()
      });
    }
  },

  // Resume upload (debounced prompt; no auto-prompt elsewhere)
  async resumeUpload(uploadId) {
    const { getUpload, updateUpload, setUploadStatus } = useUploadStore.getState();
    const u = getUpload(uploadId);
    if (!u) return;

    // Prevent re-entrant resumes and repeated prompts
    if (u.isResuming) return;
    updateUpload(uploadId, { isResuming: true });

    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        updateUpload(uploadId, {
          lastError: 'You are offline. Cannot resume.',
          lastErrorAt: new Date().toISOString(),
          isResuming: false
        });
        return;
      }

      // If file missing (page refresh), try to restore from IndexedDB
      if (!u.file || typeof u.file.slice !== 'function') {
        const restored = await restoreFileFromIndexedDB(uploadId);
        if (!restored) {
          // File not found in IndexedDB, cannot resume
          return;
        }
      }

      // Get updated upload state after file restoration
      const updatedUpload = getUpload(uploadId);
      if (!updatedUpload || !updatedUpload.file) {
        updateUpload(uploadId, {
          lastError: 'File not available. Please try again.',
          lastErrorAt: new Date().toISOString(),
          isResuming: false
        });
        return;
      }

      // First, reconcile with server to get latest state
      try {
        await this.refreshStatus(uploadId);
      } catch (error) {
        console.warn('Failed to refresh status before resume:', error);
        // Continue with resume anyway
      }

      const apiClient = createApiClient();
      await withRetry(() => apiClient.post(`/${uploadId}/resume`));
      setUploadStatus(uploadId, UPLOAD_STATUS.UPLOADING);
      await this.uploadChunks(uploadId);
    } catch (error) {
      console.error('Resume upload failed:', error);
      updateUpload(uploadId, {
        lastError: `Resume error: ${error?.message || 'unknown error'}`,
        lastErrorAt: new Date().toISOString(),
        isResuming: false
      });
      setUploadStatus(uploadId, UPLOAD_STATUS.PAUSED);
      throw error;
    } finally {
      // Always clear isResuming guard
      updateUpload(uploadId, { isResuming: false });
    }
  },

  // Cancel upload
  async cancelUpload(uploadId) {
    const { removeUpload, setError } = useUploadStore.getState();

    try {
      const apiClient = createApiClient();
      await withRetry(() => apiClient.delete(`/${uploadId}`));
      removeUpload(uploadId);
    } catch (error) {
      setError(error.message);
      removeUpload(uploadId);
      throw error;
    }
  },

  // Remove upload (for completed/failed uploads)
  async removeUpload(uploadId) {
    const { getUpload, removeUpload } = useUploadStore.getState();
    const upload = getUpload(uploadId);
    if (!upload) return;

    try {
      if (!uploadId.startsWith('temp_') && upload.status !== UPLOAD_STATUS.COMPLETED) {
        const apiClient = createApiClient();
        await withRetry(() => apiClient.delete(`/${uploadId}`));
      }
      removeUpload(uploadId);
    } catch (error) {
      removeUpload(uploadId);
    }
  },

  // New: refresh status with retry
  async refreshStatus(uploadId) {
    const apiClient = createApiClient();
    const { getUpload, updateProgress, setUploadStatus } = useUploadStore.getState();
    const upload = getUpload(uploadId);
    if (!upload) return;

    const res = await withRetry(() => apiClient.get(`/${uploadId}/status`));
    const server = res.data;

    updateProgress(uploadId, server.uploadedChunks || [], upload.chunkSize, upload.filesize);

    if (server.status === 'completed') {
      setUploadStatus(uploadId, UPLOAD_STATUS.COMPLETED);
    } else if (server.status === 'paused') {
      setUploadStatus(uploadId, UPLOAD_STATUS.PAUSED);
    }
  },

  // On app load, reconcile all persisted uploads; DO NOT auto-prompt for file
  async initAfterRehydrate({ autoResumeOnReload = true } = {}) {
    const { getUploads, setUploadStatus, updateUpload } = useUploadStore.getState();
    const uploads = getUploads();

    // Process uploads sequentially to avoid overwhelming the browser
    for (const u of uploads) {
      try {
        // First reconcile with server to get the latest state
        await reconcileFromServer(u.uploadId);

        const refreshed = useUploadStore.getState().getUpload(u.uploadId);
        if (!refreshed) continue;

        // If file missing, try to restore from IndexedDB
        if (
          [UPLOAD_STATUS.PENDING, UPLOAD_STATUS.PAUSED, UPLOAD_STATUS.UPLOADING].includes(refreshed.status) &&
          (!refreshed.file || typeof refreshed.file.slice !== 'function')
        ) {
          const fileRestored = await restoreFileFromIndexedDB(refreshed.uploadId);
          if (!fileRestored) {
            // File not found in IndexedDB, mark as failed
            updateUpload(refreshed.uploadId, {
              lastError: 'File not found in storage. Please restart the upload.',
              lastErrorAt: new Date().toISOString(),
              isResuming: false
            });
            setUploadStatus(refreshed.uploadId, UPLOAD_STATUS.FAILED);
            continue;
          }
          
          // Get the updated upload with restored file
          const updatedUpload = useUploadStore.getState().getUpload(refreshed.uploadId);
          if (!updatedUpload || !updatedUpload.file) {
            updateUpload(refreshed.uploadId, {
              lastError: 'Failed to restore file. Please restart the upload.',
              lastErrorAt: new Date().toISOString(),
              isResuming: false
            });
            setUploadStatus(refreshed.uploadId, UPLOAD_STATUS.FAILED);
            continue;
          }
        }

        // Only auto-resume if:
        // 1. autoResumeOnReload is enabled
        // 2. Upload is in a resumable state
        // 3. We're online
        // 4. Not already resuming
        if (
          autoResumeOnReload &&
          [UPLOAD_STATUS.PENDING, UPLOAD_STATUS.PAUSED, UPLOAD_STATUS.UPLOADING].includes(refreshed.status) &&
          typeof navigator !== 'undefined' &&
          navigator.onLine &&
          !refreshed.isResuming
        ) {
          // Set resuming flag to prevent duplicate resume attempts
          updateUpload(refreshed.uploadId, { isResuming: true });
          
          try {
            setUploadStatus(refreshed.uploadId, UPLOAD_STATUS.UPLOADING);
            await this.uploadChunks(refreshed.uploadId);
          } catch (error) {
            console.error('Auto-resume failed for upload', refreshed.uploadId, error);
            updateUpload(refreshed.uploadId, {
              lastError: `Auto-resume failed: ${error?.message || 'unknown error'}`,
              lastErrorAt: new Date().toISOString(),
              isResuming: false
            });
            setUploadStatus(refreshed.uploadId, UPLOAD_STATUS.PAUSED);
          }
        }
      } catch (error) {
        console.error('Error processing upload during rehydrate:', u.uploadId, error);
        // Continue with other uploads even if one fails
      }
    }
  }
};