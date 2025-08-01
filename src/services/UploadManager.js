import axios from 'axios';
import EventEmitter from 'events';

class UploadManager extends EventEmitter {
  constructor() {
    super();
    this.uploads = this.loadFromStorage();
    // Use direct URL to backend - no proxy needed
    const baseURL = process.env.REACT_APP_API_URL || 'http://localhost:4000/api/uploads';
    console.log('🔧 UploadManager baseURL:', baseURL);
    
    this.apiClient = axios.create({
      baseURL: baseURL,
      timeout: 30000,
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    
    // Set up request interceptor for logging
    this.apiClient.interceptors.request.use(
      (config) => {
        console.log('Request:', config.method?.toUpperCase(), config.url);
        console.log('Full URL:', config.baseURL + config.url);
        console.log('Base URL:', config.baseURL);
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );
    
    // Set up response interceptor for logging
    this.apiClient.interceptors.response.use(
      (response) => {
        console.log('Response:', response.status, response.config.url);
        return response;
      },
      (error) => {
        console.error('API Error:', error);
        return Promise.reject(error);
      }
    );
  }
  
  // Load uploads from localStorage
  loadFromStorage() {
    try {
      const stored = localStorage.getItem('resumableUploads');
      if (!stored) return {};
      
      const uploads = JSON.parse(stored);
      
      // Clean up any temporary uploads that might be left over
      Object.keys(uploads).forEach(uploadId => {
        if (uploadId.startsWith('temp_')) {
          console.log(`🧹 Removing leftover temporary upload: ${uploadId}`);
          delete uploads[uploadId];
        }
      });
      
      return uploads;
    } catch (error) {
      console.error('Error loading uploads from storage:', error);
      // Clear corrupted localStorage
      this.clearStorage();
      return {};
    }
  }
  
  // Save uploads to localStorage
  saveToStorage() {
    try {
      localStorage.setItem('resumableUploads', JSON.stringify(this.uploads));
    } catch (error) {
      console.error('Error saving uploads to storage:', error);
    }
  }
  
  // Get all uploads
  getUploads() {
    return Object.values(this.uploads);
  }
  
  // Find upload by ID
  getUpload(uploadId) {
    return this.uploads[uploadId] || null;
  }
  
  // Add new upload
  async addUpload(file) {
    // Clear any stale upload data for this file before starting
    this.clearStaleUploads(file);
    
    // Create temporary upload object with placeholder ID
    const tempUploadId = 'temp_' + Date.now();
    const upload = {
      uploadId: tempUploadId,
      file,
      filename: file.name,
      filetype: file.type,
      filesize: file.size,
      status: 'initiating',
      uploadedBytes: 0,
      progress: 0,
      uploadedChunks: [],
      chunkSize: 5242880, // 5MB
      totalChunks: Math.ceil(file.size / 5242880),
      createdAt: new Date().toISOString()
    };
    
    // Add temporary upload to show in UI
    this.uploads[tempUploadId] = upload;
    this.saveToStorage();
    this.emit('update');
    
    // Initiate upload on server
    try {
      console.log('🚀 Initiating upload on server for:', file.name);
      const response = await this.apiClient.post('/initiate', {
        filename: file.name,
        filetype: file.type,
        filesize: file.size
      });
      
      console.log('✅ Server response:', response.data);
      
      // Get the actual upload ID from server response
      const serverUploadId = response.data.uploadId;
      
      if (!serverUploadId) {
        throw new Error('Server did not return uploadId');
      }
      
      // Remove temporary upload
      delete this.uploads[tempUploadId];
      
      // Create new upload with server's upload ID
      const finalUpload = {
        ...upload,
        uploadId: serverUploadId,
        status: 'pending',
        s3Key: response.data.s3Key,
        chunkSize: response.data.chunkSize || upload.chunkSize,
        totalChunks: response.data.totalChunks || upload.totalChunks
      };
      
      // Store with server's upload ID as key
      this.uploads[serverUploadId] = finalUpload;
      this.saveToStorage();
      this.emit('update');
      
      console.log('🔄 Upload state synchronized with server ID:', serverUploadId);
      
      return serverUploadId;
    } catch (error) {
      console.error('Error initiating upload:', error);
      // Clean up temporary upload on error
      delete this.uploads[tempUploadId];
      this.saveToStorage();
      this.emit('update');
      throw error;
    }
  }
  
  // Remove upload
  removeUpload(uploadId) {
    delete this.uploads[uploadId];
    this.saveToStorage();
    this.emit('update');
  }
  
  // Clear stale uploads for a specific file
  clearStaleUploads(file) {
    const staleCutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
    let clearedCount = 0;
    
    // Find and remove stale uploads for the same file
    Object.keys(this.uploads).forEach(uploadId => {
      const upload = this.uploads[uploadId];
      
      // Remove if same filename and either very old or failed/canceled
      const isSameFile = upload.filename === file.name && upload.filesize === file.size;
      const isStale = new Date(upload.createdAt).getTime() < staleCutoff;
      const isFailedOrCanceled = ['failed', 'canceled'].includes(upload.status);
      
      if (isSameFile && (isStale || isFailedOrCanceled)) {
        console.log(`🧹 Clearing stale upload: ${uploadId} (${upload.status})`);
        delete this.uploads[uploadId];
        clearedCount++;
      }
    });
    
    if (clearedCount > 0) {
      console.log(`🧹 Cleared ${clearedCount} stale upload(s) for ${file.name}`);
      this.saveToStorage();
      this.emit('update');
    }
  }
  
  // Clear all localStorage data
  clearStorage() {
    try {
      localStorage.removeItem('resumableUploads');
      console.log('🧹 Cleared all upload data from localStorage');
    } catch (error) {
      console.error('Error clearing localStorage:', error);
    }
  }
  
  // Update upload status
  async updateUploadStatus(uploadId, status) {
    const upload = this.uploads[uploadId];
    if (!upload) return;
    
    try {
      await this.apiClient.post(`/${uploadId}/${status}`);
      
      // Update local status immediately for UI responsiveness
      if (status === 'pause') {
        upload.status = 'paused';
      } else if (status === 'resume') {
        upload.status = 'uploading';
      } else {
        upload.status = status;
      }
      
      this.saveToStorage();
      this.emit('update');
      
      console.log(`✅ Upload status updated: ${uploadId} - ${upload.status}`);
    } catch (error) {
      console.error(`Error updating upload status to ${status}:`, error);
      throw error;
    }
  }
  
  // Pause upload
  async pauseUpload(uploadId) {
    console.log(`⏸️ Pausing upload: ${uploadId}`);
    return this.updateUploadStatus(uploadId, 'pause');
  }
  
  // Resume upload
  async resumeUpload(uploadId) {
    console.log(`▶️ Resuming upload: ${uploadId}`);
    await this.updateUploadStatus(uploadId, 'resume');
    // Start uploading chunks after resuming
    await this.uploadChunks(uploadId);
  }
  
  // Cancel upload
  async cancelUpload(uploadId) {
    const upload = this.uploads[uploadId];
    if (!upload) return;
    
    try {
      await this.apiClient.delete(`/${uploadId}`);
      this.removeUpload(uploadId);
    } catch (error) {
      console.error('Error canceling upload:', error);
      this.removeUpload(uploadId);
      throw error;
    }
  }
  
  // Upload chunks with retry logic
  async uploadChunks(uploadId) {
    const upload = this.uploads[uploadId];
    console.log('🔄 uploadChunks called for:', uploadId, 'upload:', upload);
    
    if (!upload || upload.status !== 'uploading') {
      console.log('❌ Upload not found or not in uploading status:', upload?.status);
      return;
    }
    
    // Get upload status from server to check progress
    let status;
    try {
      console.log('📡 Getting upload status from server...');
      const response = await this.apiClient.get(`/${uploadId}/status`);
      status = response.data;
      console.log('📊 Server status:', status);
      upload.uploadedChunks = status.uploadedChunks;
      upload.status = status.status;
      this.saveToStorage();
      this.emit('update');
    } catch (error) {
      console.error('Error getting upload status:', error);
      // Continue with client-side progress if server is unreachable
      status = upload;
    }
    
    // Upload each unuploaded chunk
    console.log(`📦 Starting chunk upload loop. Total chunks: ${upload.totalChunks}, Uploaded: [${upload.uploadedChunks.join(', ')}]`);
    
    for (let chunkIndex = 0; chunkIndex < upload.totalChunks; chunkIndex++) {
      // Skip if chunk already uploaded
      if (upload.uploadedChunks.includes(chunkIndex)) {
        console.log(`⏭️ Skipping chunk ${chunkIndex} (already uploaded)`);
        continue;
      }
      
      console.log(`🚀 Uploading chunk ${chunkIndex}/${upload.totalChunks - 1}`);
      
      // Upload chunk with retry logic
      const success = await this.uploadChunkWithRetry(uploadId, chunkIndex);
      
      if (!success) {
        console.log(`❌ Chunk ${chunkIndex} upload failed, pausing upload`);
        // Update status to paused if upload failed
        upload.status = 'paused';
        this.saveToStorage();
        this.emit('update');
        return;
      }
      
      console.log(`✅ Chunk ${chunkIndex} uploaded successfully`);
      
      // Update progress
      upload.uploadedBytes = (upload.uploadedChunks.length + 1) * upload.chunkSize;
      upload.progress = (upload.uploadedBytes / upload.filesize) * 100;
      console.log(`📈 Progress updated: ${upload.progress.toFixed(1)}%`);
      this.saveToStorage();
      this.emit('update');
    }
    
    // Complete upload if all chunks are uploaded
    if (upload.uploadedChunks.length === upload.totalChunks) {
      try {
        await this.apiClient.post(`/${uploadId}/complete`);
        upload.status = 'completed';
        this.saveToStorage();
        this.emit('update');
      } catch (error) {
        console.error('Error completing upload:', error);
        upload.status = 'failed';
        this.saveToStorage();
        this.emit('update');
      }
    }
  }
  
  // Upload a single chunk with retry logic
  async uploadChunkWithRetry(uploadId, chunkIndex) {
    const upload = this.uploads[uploadId];
    if (!upload) {
      console.log('❌ Upload not found in uploadChunkWithRetry');
      return false;
    }
    
    const maxRetries = 5;
    const baseDelay = 1000; // 1 second
    const maxDelay = 30000; // 30 seconds
    const jitter = 0.25; // 25% jitter
    
    // Calculate chunk start and end
    const start = chunkIndex * upload.chunkSize;
    const end = Math.min(start + upload.chunkSize, upload.filesize);
    
    console.log(`📦 Preparing chunk ${chunkIndex}: bytes ${start}-${end} (${end - start} bytes)`);
    
    // Create chunk blob
    const chunk = upload.file.slice(start, end);
    console.log('📄 Chunk blob created:', chunk.size, 'bytes');
    
    for (let retry = 0; retry <= maxRetries; retry++) {
      try {
        const formData = new FormData();
        formData.append('chunk', chunk);
        formData.append('chunkIndex', chunkIndex);
        formData.append('totalChunks', upload.totalChunks);
        
        console.log(`🌐 Making POST request to: /${uploadId}/chunk (attempt ${retry + 1})`);
        console.log('📋 FormData contents:', {
          chunkSize: chunk.size,
          chunkIndex,
          totalChunks: upload.totalChunks
        });
        
        const response = await this.apiClient.post(
          `/${uploadId}/chunk`,
          formData,
          {
            headers: {
              'Content-Type': 'multipart/form-data'
            },
            timeout: 60000
          }
        );
        
        console.log(`✅ Chunk ${chunkIndex} upload response:`, response.status, response.data);
        
        // Add chunk index to uploaded chunks
        if (!upload.uploadedChunks.includes(chunkIndex)) {
          upload.uploadedChunks.push(chunkIndex);
          upload.uploadedChunks.sort((a, b) => a - b);
        }
        
        this.saveToStorage();
        this.emit('update');
        
        return true;
      } catch (error) {
        if (retry >= maxRetries) {
          console.error(`Max retries exceeded for chunk ${chunkIndex}:`, error);
          return false;
        }
        
        // Calculate delay with exponential backoff and jitter
        const delay = Math.min(
          baseDelay * Math.pow(2, retry),
          maxDelay
        );
        
        // Add jitter (random variation)
        const jitterDelay = delay * (1 + Math.random() * jitter * 2 - jitter);
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, jitterDelay));
        
        console.log(`Retrying chunk ${chunkIndex} (attempt ${retry + 1})`);
      }
    }
    
    return false;
  }
  
  // Generate unique upload ID using crypto for consistency with backend
  generateUploadId() {
    // Generate 12 random bytes and convert to hex (same as backend)
    const array = new Uint8Array(12);
    crypto.getRandomValues(array);
    const hex = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    return 'upload_' + hex;
  }
  
  // Start uploading
  async startUpload(uploadId) {
    const upload = this.uploads[uploadId];
    if (!upload) return;
    
    upload.status = 'uploading';
    this.saveToStorage();
    this.emit('update');
    
    await this.uploadChunks(uploadId);
  }
}

// Create singleton instance
const uploadManager = new UploadManager();
export default uploadManager;