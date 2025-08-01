import React from 'react';
import './UploadControls.css';

const UploadControls = ({ upload, onUpload, onPause, onResume, onCancel, onRemove }) => {
  const handleStart = () => {
    if (onUpload) onUpload(upload);
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

  const handleRemove = () => {
    if (onRemove) onRemove(upload);
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

      {/* Always show Remove button so user can remove any active upload */}
      <button onClick={handleRemove} className="btn btn-warning">
        Remove
      </button>
    </div>
  );
};

export default UploadControls;