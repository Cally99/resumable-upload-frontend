import axios from 'axios';
import { useUploadStore } from './uploadStore';
import { UPLOAD_STATUS } from './uploadTypes';

// Create API client
const createApiClient = () => {
  const baseURL = process.env.REACT_APP_API_URL || 'http://localhost:4000/api/uploads';
  
  return axios.create({
    baseURL: baseURL,
    timeout: 30000,
    headers: {
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  });
};

export const uploadActions = {
  // Initialize upload on server
  async initiateUpload(file) {
    const { addUpload, removeUpload, clearStaleUploads, setError } = useUploadStore.getState();
    
    try {
      // Clear any stale uploads for this file
      clearStaleUploads(file);
      
      // Create temporary upload
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
        chunkSize: 5242880, // 5MB
        totalChunks: Math.ceil(file.size / 5242880),
        createdAt: new Date().toISOString()
      };
      
      addUpload(tempUpload);
      
      // Initiate on server
      const apiClient = createApiClient();
      const response = await apiClient.post('/initiate', {
        filename: file.name,
        filetype: file.type,
        filesize: file.size
      });
      
      const serverUploadId = response.data.uploadId;
      if (!serverUploadId) {
        throw new Error('Server did not return uploadId');
      }
      
      // Remove temporary upload and add real one
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
    const { getUpload, setUploadStatus } = useUploadStore.getState();
    const upload = getUpload(uploadId);
    
    if (!upload) return;
    
    setUploadStatus(uploadId, UPLOAD_STATUS.UPLOADING);
    await this.uploadChunks(uploadId);
  },

  // Upload chunks
  async uploadChunks(uploadId) {
    const { getUpload, updateProgress, setUploadStatus, setError } = useUploadStore.getState();
    const upload = getUpload(uploadId);
    
    if (!upload || upload.status !== UPLOAD_STATUS.UPLOADING) {
      return;
    }
    
    try {
      // Get current status from server
      const apiClient = createApiClient();
      const statusResponse = await apiClient.get(`/${uploadId}/status`);
      const serverStatus = statusResponse.data;
      
      // Update local state with server state
      updateProgress(uploadId, serverStatus.uploadedChunks, upload.chunkSize, upload.filesize);
      
      // Upload remaining chunks
      for (let chunkIndex = 0; chunkIndex < upload.totalChunks; chunkIndex++) {
        const currentUpload = getUpload(uploadId);
        if (!currentUpload || currentUpload.status !== UPLOAD_STATUS.UPLOADING) {
          return; // Upload was paused or canceled
        }
        
        if (currentUpload.uploadedChunks.includes(chunkIndex)) {
          continue; // Skip already uploaded chunks
        }
        
        const success = await this.uploadChunk(uploadId, chunkIndex);
        if (!success) {
          setUploadStatus(uploadId, UPLOAD_STATUS.PAUSED);
          return;
        }
      }
      
      // Complete upload
      await apiClient.post(`/${uploadId}/complete`);
      setUploadStatus(uploadId, UPLOAD_STATUS.COMPLETED);
      
    } catch (error) {
      setError(error.message);
      setUploadStatus(uploadId, UPLOAD_STATUS.FAILED);
    }
  },

  // Upload single chunk
  async uploadChunk(uploadId, chunkIndex) {
    const { getUpload, updateProgress } = useUploadStore.getState();
    const upload = getUpload(uploadId);
    
    if (!upload) return false;
    
    const maxRetries = 5;
    const baseDelay = 1000;
    
    for (let retry = 0; retry <= maxRetries; retry++) {
      try {
        const start = chunkIndex * upload.chunkSize;
        const end = Math.min(start + upload.chunkSize, upload.filesize);
        const chunk = upload.file.slice(start, end);
        
        const formData = new FormData();
        formData.append('chunk', chunk);
        formData.append('chunkIndex', chunkIndex);
        formData.append('totalChunks', upload.totalChunks);
        
        const apiClient = createApiClient();
        await apiClient.post(`/${uploadId}/chunk`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 60000
        });
        
        // Update progress
        const newUploadedChunks = [...upload.uploadedChunks, chunkIndex];
        updateProgress(uploadId, newUploadedChunks, upload.chunkSize, upload.filesize);
        
        return true;
        
      } catch (error) {
        if (retry >= maxRetries) {
          console.error(`Max retries exceeded for chunk ${chunkIndex}:`, error);
          return false;
        }
        
        const delay = Math.min(baseDelay * Math.pow(2, retry), 30000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    return false;
  },

  // Pause upload
  async pauseUpload(uploadId) {
    const { setUploadStatus } = useUploadStore.getState();
    
    try {
      const apiClient = createApiClient();
      await apiClient.post(`/${uploadId}/pause`);
      setUploadStatus(uploadId, UPLOAD_STATUS.PAUSED);
    } catch (error) {
      console.error('Error pausing upload:', error);
      throw error;
    }
  },

  // Resume upload
  async resumeUpload(uploadId) {
    const { setUploadStatus } = useUploadStore.getState();
    
    try {
      const apiClient = createApiClient();
      await apiClient.post(`/${uploadId}/resume`);
      setUploadStatus(uploadId, UPLOAD_STATUS.UPLOADING);
      await this.uploadChunks(uploadId);
    } catch (error) {
      console.error('Error resuming upload:', error);
      throw error;
    }
  },

  // Cancel upload
  async cancelUpload(uploadId) {
    const { removeUpload, setError } = useUploadStore.getState();
    
    try {
      const apiClient = createApiClient();
      await apiClient.delete(`/${uploadId}`);
      removeUpload(uploadId);
    } catch (error) {
      setError(error.message);
      removeUpload(uploadId); // Remove locally even if server fails
      throw error;
    }
  },

  // Remove upload (for completed/failed uploads)
  async removeUpload(uploadId) {
    const { getUpload, removeUpload } = useUploadStore.getState();
    const upload = getUpload(uploadId);
    
    if (!upload) return;
    
    try {
      // Only attempt server cleanup for non-temporary, non-completed uploads
      if (!uploadId.startsWith('temp_') && upload.status !== UPLOAD_STATUS.COMPLETED) {
        const apiClient = createApiClient();
        await apiClient.delete(`/${uploadId}`);
      }
      
      removeUpload(uploadId);
    } catch (error) {
      console.warn('Server cleanup failed, removing locally:', error);
      removeUpload(uploadId);
    }
  }
};