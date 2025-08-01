import React, { useState } from 'react';
import UploadControls from './UploadControls';
import UploadProgress from './UploadProgress';
import { useUpload } from '../hooks/useUploads';
import './ActiveUpload.css';

const ActiveUpload = ({ uploadId }) => {
  const { upload, startUpload, pauseUpload, resumeUpload, cancelUpload, removeUpload } = useUpload(uploadId);
  const [isResuming, setIsResuming] = useState(false);

  if (!upload) {
    return null;
  }

  const handleUpload = async () => {
    try {
      await startUpload();
    } catch (error) {
      console.error('Error starting upload:', error);
    }
  };

  const handlePause = async () => {
    try {
      await pauseUpload();
    } catch (error) {
      console.error('Error pausing upload:', error);
    }
  };

  const handleResume = async () => {
    if (isResuming) return; // Prevent multiple resume attempts
    
    setIsResuming(true);
    try {
      await resumeUpload();
    } catch (error) {
      console.error('Error resuming upload:', error);
    } finally {
      setIsResuming(false);
    }
  };

  const handleCancel = async () => {
    try {
      await cancelUpload();
    } catch (error) {
      console.error('Error canceling upload:', error);
    }
  };

  const handleRemove = async () => {
    try {
      await removeUpload();
    } catch (error) {
      console.error('Error removing upload:', error);
    }
  };

  // Format error message for display
  const getErrorMessage = () => {
    if (!upload.lastError) return null;
    
    // Make error messages more user-friendly
    let message = upload.lastError;
    if (message.includes('Failed to reconcile status')) {
      message = 'Unable to check upload status. Please check your connection and try again.';
    } else if (message.includes('File not available after refresh')) {
      message = 'File needs to be reselected after page refresh. Click Resume to select the file.';
    } else if (message.includes('Network offline')) {
      message = 'You are offline. Please check your internet connection.';
    } else if (message.includes('Chunk') && message.includes('failed')) {
      message = 'Upload interrupted due to network issues. Will retry automatically.';
    }
    
    return message;
  };

  const errorMessage = getErrorMessage();

  return (
    <div className="active-upload">
      <div className="upload-header">
        <h3>{upload.filename}</h3>
        <span className="file-size">
          {(upload.filesize / (1024 * 1024)).toFixed(2)} MB
        </span>
      </div>
      
      {errorMessage && (
        <div className="error-message">
          <span className="error-icon">⚠️</span>
          <span className="error-text">{errorMessage}</span>
        </div>
      )}
      
      <UploadProgress upload={upload} />
      <UploadControls
        upload={upload}
        onUpload={handleUpload}
        onPause={handlePause}
        onResume={handleResume}
        onCancel={handleCancel}
        onRemove={handleRemove}
        isResuming={isResuming}
      />
      
      <div className="upload-details">
        <span className={`status-badge status-${upload.status}`}>
          {upload.status.charAt(0).toUpperCase() + upload.status.slice(1)}
        </span>
        {upload.needsFile && (
          <span className="needs-file-indicator">
            File needs to be reselected
          </span>
        )}
      </div>
    </div>
  );
};

export default ActiveUpload;