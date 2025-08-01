import React, { useState, useRef } from 'react';
import { useUploads } from '../hooks/useUploads';
import './UploadDropzone.css';

const UploadDropzone = () => {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);
  const { addUpload } = useUploads();

  const handleFileSelect = async (file) => {
    if (file && file.size > 0) {
      setSelectedFile(file);
      try {
        await addUpload(file);
      } catch (error) {
        console.error('Error adding upload:', error);
      }
    }
  };

  const handleFileInput = (e) => {
    const file = e.target.files[0];
    handleFileSelect(file);
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    handleFileSelect(file);
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="upload-container">
      <div
        className={`dropzone ${isDragging ? 'dragging' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileInput}
          className="file-input"
          aria-label="Select file to upload"
        />
        <div className="dropzone-content">
          <p>Drag & drop a file here, or click to select</p>
          <p className="file-size-limit">Supports files up to 1GB</p>
        </div>
      </div>
      
      {selectedFile && (
        <div className="selected-file">
          <p>Selected: {selectedFile.name} ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)</p>
        </div>
      )}
    </div>
  );
};

export default UploadDropzone;