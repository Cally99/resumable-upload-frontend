import React from 'react';
import './UploadControls.css';

const UploadControls = ({ upload, onUpload, onPause, onResume, onCancel }) => {
  const handleStart = () => {
    console.log('🔍 DEBUG: Start button clicked for upload:', upload.uploadId);
    console.log('🔍 DEBUG: onUpload callback provided:', !!onUpload);
    if (onUpload) {
      console.log('🔍 DEBUG: Calling onUpload callback');
      onUpload(upload);
    } else {
      console.error('❌ DEBUG: No onUpload callback provided - this is the bug!');
    }
  };

  const handlePause = () => {
    if (onPause) onPause(upload);
  };

  const handleResume = () => {
    if (onResume) onResume(upload);
  };

  const handleCancel = () => {
    if (onCancel) onCancel(upload);
  };

  return (
    <div className="upload-controls">
      {(upload.status === 'pending' || upload.status === 'paused') && (
        <button
          onClick={upload.status === 'pending' ? handleStart : handleResume}
          className="btn btn-primary"
        >
          {upload.status === 'pending' ? 'Start Upload' : 'Resume'}
        </button>
      )}
      
      {upload.status === 'uploading' && (
        <button onClick={handlePause} className="btn btn-secondary">
          Pause
        </button>
      )}
      
      {(upload.status === 'uploading' || upload.status === 'paused') && (
        <button onClick={handleCancel} className="btn btn-danger">
          Cancel
        </button>
      )}
    </div>
  );
};

export default UploadControls;