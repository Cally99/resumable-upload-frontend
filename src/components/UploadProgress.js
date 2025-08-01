import React from 'react';
import './UploadProgress.css';

const UploadProgress = ({ upload }) => {
  // Calculate progress percentage
  const progress = upload.progress || 0;
  const uploadedMB = (upload.uploadedBytes / (1024 * 1024)) || 0;
  const totalMB = upload.filesize ? (upload.filesize / (1024 * 1024)) : 0;
  
  return (
    <div className="upload-progress">
      <div className="progress-info">
        <span>{uploadedMB.toFixed(2)} MB / {totalMB.toFixed(2)} MB</span>
        <span>{Math.round(progress)}%</span>
      </div>
      <div className="progress-bar">
        <div 
          className="progress-fill" 
          style={{ width: `${progress}%` }}
        ></div>
      </div>
    </div>
  );
};

export default UploadProgress;