import React from 'react';
import UploadControls from './UploadControls';
import UploadProgress from './UploadProgress';
import { useUpload } from '../hooks/useUploads';
import './ActiveUpload.css';

const ActiveUpload = ({ uploadId }) => {
  const { upload, startUpload, pauseUpload, resumeUpload, cancelUpload, removeUpload } = useUpload(uploadId);

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
    try {
      await resumeUpload();
    } catch (error) {
      console.error('Error resuming upload:', error);
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
        onRemove={handleRemove}
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