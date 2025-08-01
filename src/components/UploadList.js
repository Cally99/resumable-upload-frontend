import React from 'react';
import ActiveUpload from './ActiveUpload';
import { useUploads } from '../hooks/useUploads';
import './UploadList.css';

const UploadList = () => {
  const { uploads } = useUploads();

  if (uploads.length === 0) {
    return null;
  }

  return (
    <div className="upload-list">
      <h2>Active Uploads</h2>
      {uploads.map(upload => (
        <ActiveUpload key={upload.uploadId} uploadId={upload.uploadId} />
      ))}
    </div>
  );
};

export default UploadList;