import React from 'react';
import UploadControls from './UploadControls';
import UploadProgress from './UploadProgress';
import uploadManager from '../services/UploadManager';
import './ActiveUpload.css';

const ActiveUpload = ({ upload }) => {
  // Create callback functions that connect to UploadManager methods
  const handleUpload = async (upload) => {
    console.log('🚀 Starting upload for:', upload.uploadId);
    try {
      await uploadManager.startUpload(upload.uploadId);
    } catch (error) {
      console.error('Error starting upload:', error);
    }
  };

  const handlePause = async (upload) => {
    console.log('⏸️ Pausing upload for:', upload.uploadId);
    try {
      await uploadManager.pauseUpload(upload.uploadId);
    } catch (error) {
      console.error('Error pausing upload:', error);
    }
  };

  const handleResume = async (upload) => {
    console.log('▶️ Resuming upload for:', upload.uploadId);
    try {
      await uploadManager.resumeUpload(upload.uploadId);
    } catch (error) {
      console.error('Error resuming upload:', error);
    }
  };

  const handleCancel = async (upload) => {
    console.log('❌ Canceling upload for:', upload.uploadId);
    try {
      await uploadManager.cancelUpload(upload.uploadId);
    } catch (error) {
      console.error('Error canceling upload:', error);
    }
  };

  return (
    <div className="active-upload">
      <div className="upload-header">
        <h3>{upload.filename}</h3>
        <span className="file-size">
          {(upload.filesize / (1024 * 1024)).toFixed(2)} MB
        </span>
      </div>
      
      <UploadProgress upload={upload} />
      <UploadControls
        upload={upload}
        onUpload={handleUpload}
        onPause={handlePause}
        onResume={handleResume}
        onCancel={handleCancel}
      />
      
      <div className="upload-details">
        <span className={`status-badge status-${upload.status}`}>
          {upload.status.charAt(0).toUpperCase() + upload.status.slice(1)}
        </span>
      </div>
    </div>
  );
};

export default ActiveUpload;