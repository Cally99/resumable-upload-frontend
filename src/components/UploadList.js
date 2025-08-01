import React, { useEffect, useState } from 'react';
import ActiveUpload from './ActiveUpload';
import UploadManager from '../services/UploadManager';
import './UploadList.css';

const UploadList = () => {
  const [uploads, setUploads] = useState([]);

  // Initialize uploads from UploadManager
  useEffect(() => {
    setUploads(UploadManager.getUploads());
    
    // Listen for upload changes
    const handleUploadUpdate = () => {
      setUploads(UploadManager.getUploads());
    };
    
    UploadManager.on('update', handleUploadUpdate);
    
    // Cleanup listener on unmount
    return () => {
      UploadManager.off('update', handleUploadUpdate);
    };
  }, []);

  if (uploads.length === 0) {
    return null;
  }

  return (
    <div className="upload-list">
      <h2>Active Uploads</h2>
      {uploads.map(upload => (
        <ActiveUpload key={upload.uploadId} upload={upload} />
      ))}
    </div>
  );
};

export default UploadList;