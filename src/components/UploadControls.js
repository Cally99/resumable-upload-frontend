import React from 'react';
import './UploadControls.css';

const UploadControls = ({ upload, onUpload, onPause, onResume, onCancel, onRemove, isResuming }) => {
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

  // Disable buttons when resuming to prevent multiple actions
  const isDisabled = isResuming || upload.status === 'initiating';

  return (
    <div className="upload-controls">
      {(upload.status === 'pending' || upload.status === 'paused') && (
        <button
          onClick={upload.status === 'pending' ? handleStart : handleResume}
          className="btn btn-primary"
          disabled={isDisabled}
        >
          {isResuming ? (
            <>
              <span className="spinner"></span>
              Resuming...
            </>
          ) : upload.status === 'pending' ? (
            'Start Upload'
          ) : (
            'Resume'
          )}
        </button>
      )}

      {upload.status === 'uploading' && (
        <button onClick={handlePause} className="btn btn-secondary" disabled={isDisabled}>
          Pause
        </button>
      )}

      {(upload.status === 'uploading' || upload.status === 'paused') && (
        <button onClick={handleCancel} className="btn btn-danger" disabled={isDisabled}>
          Cancel
        </button>
      )}

      {/* Always show Remove button so user can remove any active upload */}
      <button onClick={handleRemove} className="btn btn-warning" disabled={isDisabled}>
        Remove
      </button>
    </div>
  );
};

export default UploadControls;