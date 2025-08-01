import axios from 'axios';
import { useUploadStore } from './uploadStore';
import { UPLOAD_STATUS } from './uploadTypes';
import { indexedDBService } from '../services/indexedDBService';

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

const isRetryableError = (error) => {
  if (!error || !error.response) {
    return true;
  }
  const status = error.response.status;
  // 408, 425, 429, 5xx are retryable
  if (status === 408 || status === 425 || status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoffDelay = (attempt, base = 1000, max = 30000) => {
  const expo = Math.min(max, base * Math.pow(2, attempt));
  return Math.floor(Math.random() * expo);
};

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

const reconcileFromServer = async (uploadId) => {
  const apiClient = createApiClient();
  const { getUpload, updateProgress, setUploadStatus } = useUploadStore.getState();
  const local = getUpload(uploadId);
  if (!local) return;

  try {
    const res = await withRetry(() => apiClient.get(`/${uploadId}/status`));
    const server = res.data;

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

async function restoreFileFromIndexedDB(uploadId) {
  const { getUpload, updateUpload } = useUploadStore.getState();
  const u = getUpload(uploadId);
  if (!u) return false;

  try {
    const file = await indexedDBService.getFile(uploadId);
    
    if (file) {
      // Verify the file is valid before updating state
      if (typeof file.slice === 'function' && file.size > 0) {
        updateUpload(uploadId, {
          file,
          lastError: undefined,
          needsFile: false
        });
        return true;
      } else {
        updateUpload(uploadId, {
          lastError: 'Invalid file format. Please restart the upload.',
          lastErrorAt: new Date().toISOString(),
          needsFile: true
        });
        return false;
      }
    } else {
      updateUpload(uploadId, {
        lastError: 'File not found in storage. Please restart the upload.',
        lastErrorAt: new Date().toISOString(),
        needsFile: true
      });
      return false;
    }
  } catch (error) {
    updateUpload(uploadId, {
      lastError: 'Failed to restore file. Please restart the upload.',
      lastErrorAt: new Date().toISOString(),
      needsFile: true
    });
    return false;
  }
}

async function ensureFileAvailable(uploadId) {
  const { getUpload, setUploadStatus } = useUploadStore.getState();
  const u = getUpload(uploadId);
  if (!u) return false;

  // Check if file is available and valid
  if (!u.file || typeof u.file.slice !== 'function' || u.file.size === 0) {
    const restored = await restoreFileFromIndexedDB(uploadId);
    if (!restored) {
      setUploadStatus(uploadId, UPLOAD_STATUS.PAUSED);
      return false;
    }
  }
  return true;
}

export const uploadActions = {
  async initiateUpload(file) {
    const { addUpload, removeUpload, clearStaleUploads, setError } = useUploadStore.getState();

    try {
      // Validate file before proceeding
      if (!file || typeof file.slice !== 'function' || file.size === 0) {
        throw new Error('Invalid file selected');
      }

      clearStaleUploads(file);

      const tempUploadId = 'temp_' + Date.now();
      const tempUpload = {
        uploadId: tempUploadId,
        file,
        filename: file.name,
        filetype: file.type,
        filesize: file.size,
        status: UPLOAD_STATUS.INITIATING,
        uploadedBytes: 0,
        progress: 0,
        uploadedChunks: [],
        chunkSize: 5242880,
        totalChunks: Math.ceil(file.size / 5242880),
        createdAt: new Date().toISOString(),
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

  async startUpload(uploadId) {
    const { getUpload, setUploadStatus, getUIState, updateUpload } = useUploadStore.getState();
    const upload = getUpload(uploadId);
    const uiState = getUIState();
    if (!upload) return;

    if (uiState.isOffline || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      updateUpload(uploadId, {
        lastError: 'You are offline. Upload paused.',
        lastErrorAt: new Date().toISOString()
      });
      setUploadStatus(uploadId, UPLOAD_STATUS.PAUSED);
      return;
    }

    if (!(await ensureFileAvailable(uploadId))) {
      return;
    }

    setUploadStatus(uploadId, UPLOAD_STATUS.UPLOADING);
    await this.uploadChunks(uploadId);
  },

  async uploadChunks(uploadId) {
    const { getUpload, updateProgress, setUploadStatus, setError, updateUpload } = useUploadStore.getState();
    let upload = getUpload(uploadId);
    if (!upload) return;

    if (upload.status !== UPLOAD_STATUS.UPLOADING) return;

    try {
      await this.refreshStatus(uploadId);
    } catch (e) {
      updateUpload(uploadId, {
        lastError: `Status check failed: ${e?.message || 'unknown error'}`,
        lastErrorAt: new Date().toISOString()
      });
    }

    upload = getUpload(uploadId);
    for (let chunkIndex = 0; chunkIndex < upload.totalChunks; chunkIndex++) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setUploadStatus(uploadId, UPLOAD_STATUS.PAUSED);
        updateUpload(uploadId, {
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
        continue;
      }

      const success = await this.uploadChunk(uploadId, chunkIndex);
      if (!success) {
        setUploadStatus(uploadId, UPLOAD_STATUS.PAUSED);
        return;
      }

      const newUploadedChunks = [...currentUpload.uploadedChunks, chunkIndex];
      updateProgress(uploadId, newUploadedChunks, currentUpload.chunkSize, currentUpload.filesize);
    }

    const apiClient = createApiClient();
    try {
      await withRetry(() => apiClient.post(`/${uploadId}/complete`));
      setUploadStatus(uploadId, UPLOAD_STATUS.COMPLETED);
    } catch (error) {
      setError(error.message);
      setUploadStatus(uploadId, UPLOAD_STATUS.FAILED);
      updateUpload(uploadId, {
        lastError: `Failed to complete upload: ${error?.message || 'unknown error'}`,
        lastErrorAt: new Date().toISOString()
      });
    }
  },

  async uploadChunk(uploadId, chunkIndex) {
    const { getUpload, setUploadStatus, updateUpload } = useUploadStore.getState();
    const upload = getUpload(uploadId);
    if (!upload) return false;

    if (!(await ensureFileAvailable(uploadId))) {
      return false;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setUploadStatus(uploadId, UPLOAD_STATUS.PAUSED);
      updateUpload(uploadId, {
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
      updateUpload(uploadId, {
        lastError: `Chunk ${chunkIndex} failed: ${error?.message || 'unknown error'}`,
        lastErrorAt: new Date().toISOString()
      });
      return false;
    }
  },

  async pauseUpload(uploadId) {
    const { setUploadStatus, updateUpload } = useUploadStore.getState();

    try {
      const apiClient = createApiClient();
      await withRetry(() => apiClient.post(`/${uploadId}/pause`));
      setUploadStatus(uploadId, UPLOAD_STATUS.PAUSED);
    } catch (error) {
      setUploadStatus(uploadId, UPLOAD_STATUS.PAUSED);
      updateUpload(uploadId, {
        lastError: `Pause error: ${error?.message || 'unknown error'}`,
        lastErrorAt: new Date().toISOString()
      });
    }
  },

  async resumeUpload(uploadId) {
    const { getUpload, updateUpload, setUploadStatus, setResuming, getIsResuming } = useUploadStore.getState();
    const u = getUpload(uploadId);
    if (!u) return;

    // Check if already resuming to prevent multiple calls
    if (getIsResuming()) return;
    
    // Set resuming state immediately to prevent race conditions
    setResuming(true);

    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        updateUpload(uploadId, {
          lastError: 'You are offline. Cannot resume.',
          lastErrorAt: new Date().toISOString()
        });
        return;
      }

      // Check if file is available and restore if needed
      if (!u.file || typeof u.file.slice !== 'function') {
        const restored = await restoreFileFromIndexedDB(uploadId);
        if (!restored) {
          updateUpload(uploadId, {
            lastError: 'File not found in storage. Please restart the upload.',
            lastErrorAt: new Date().toISOString()
          });
          return;
        }
      }

      // Get the updated upload after potential file restoration
      const updatedUpload = getUpload(uploadId);
      if (!updatedUpload || !updatedUpload.file) {
        updateUpload(uploadId, {
          lastError: 'File not available. Please try again.',
          lastErrorAt: new Date().toISOString()
        });
        return;
      }

      // Refresh status from server but don't fail if it doesn't work
      try {
        await this.refreshStatus(uploadId);
      } catch (error) {
        // Continue with resume anyway
      }

      // Resume the upload on the server and start uploading chunks
      const apiClient = createApiClient();
      await withRetry(() => apiClient.post(`/${uploadId}/resume`));
      setUploadStatus(uploadId, UPLOAD_STATUS.UPLOADING);
      await this.uploadChunks(uploadId);
    } catch (error) {
      updateUpload(uploadId, {
        lastError: `Resume error: ${error?.message || 'unknown error'}`,
        lastErrorAt: new Date().toISOString()
      });
      setUploadStatus(uploadId, UPLOAD_STATUS.PAUSED);
      throw error;
    } finally {
      // Always clear resuming state when done
      setResuming(false);
    }
  },

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

  async initAfterRehydrate({ autoResumeOnReload = true } = {}) {
    const { getUploads, setUploadStatus, updateUpload, setResuming } = useUploadStore.getState();
    const uploads = getUploads();

    for (const u of uploads) {
      try {
        // Reconcile with server first
        await reconcileFromServer(u.uploadId);

        const refreshed = useUploadStore.getState().getUpload(u.uploadId);
        if (!refreshed) continue;

        // Check if file needs to be restored from IndexedDB
        if (
          [UPLOAD_STATUS.PENDING, UPLOAD_STATUS.PAUSED, UPLOAD_STATUS.UPLOADING].includes(refreshed.status) &&
          (!refreshed.file || typeof refreshed.file.slice !== 'function')
        ) {
          const fileRestored = await restoreFileFromIndexedDB(refreshed.uploadId);
          if (!fileRestored) {
            updateUpload(refreshed.uploadId, {
              lastError: 'File not found in storage. Please restart the upload.',
              lastErrorAt: new Date().toISOString()
            });
            setUploadStatus(refreshed.uploadId, UPLOAD_STATUS.FAILED);
            continue;
          }
          
          const updatedUpload = useUploadStore.getState().getUpload(refreshed.uploadId);
          if (!updatedUpload || !updatedUpload.file) {
            updateUpload(refreshed.uploadId, {
              lastError: 'Failed to restore file. Please restart the upload.',
              lastErrorAt: new Date().toISOString()
            });
            setUploadStatus(refreshed.uploadId, UPLOAD_STATUS.FAILED);
            continue;
          }
        }

        // Auto-resume if enabled and online
        if (
          autoResumeOnReload &&
          [UPLOAD_STATUS.PENDING, UPLOAD_STATUS.PAUSED, UPLOAD_STATUS.UPLOADING].includes(refreshed.status) &&
          typeof navigator !== 'undefined' &&
          navigator.onLine
        ) {
          // Set resuming state to prevent conflicts
          setResuming(true);
          
          try {
            setUploadStatus(refreshed.uploadId, UPLOAD_STATUS.UPLOADING);
            await this.uploadChunks(refreshed.uploadId);
          } catch (error) {
            updateUpload(refreshed.uploadId, {
              lastError: `Auto-resume failed: ${error?.message || 'unknown error'}`,
              lastErrorAt: new Date().toISOString()
            });
            setUploadStatus(refreshed.uploadId, UPLOAD_STATUS.PAUSED);
          } finally {
            // Always clear resuming state
            setResuming(false);
          }
        }
      } catch (error) {
        // Continue with other uploads even if one fails
        console.error('Error in initAfterRehydrate for upload', u.uploadId, ':', error);
      }
    }
  }
};