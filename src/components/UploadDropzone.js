import React, { useState, useRef, useCallback } from 'react';
import { useUploads } from '../hooks/useUploads';
import './UploadDropzone.css';

const UploadDropzone = () => {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef(null);
  const { addUpload } = useUploads();

  const handleFileSelect = useCallback(async (file) => {
    // Prevent multiple file selections while processing
    if (isProcessing) return;
    
    // Validate file
    if (!file || file.size === 0) {
      console.error('Invalid file selected');
      return;
    }

    setIsProcessing(true);
    setSelectedFile(file);
    
    try {
      await addUpload(file);
    } catch (error) {
      console.error('Error adding upload:', error);
      // Reset selected file on error
      setSelectedFile(null);
    } finally {
      setIsProcessing(false);
      // Reset file input value to allow selecting the same file again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [addUpload, isProcessing]);

  const handleFileInput = useCallback((e) => {
    const file = e.target.files[0];
    handleFileSelect(file);
  }, [handleFileSelect]);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    handleFileSelect(file);
  }, [handleFileSelect]);

  const handleClick = useCallback(() => {
    if (!isProcessing) {
      fileInputRef.current?.click();
    }
  }, [isProcessing]);

  return (
    <div className="upload-container">
      <div
        className={`dropzone ${isDragging ? 'dragging' : ''} ${isProcessing ? 'processing' : ''}`}
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
          disabled={isProcessing}
        />
        <div className="dropzone-content">
          {isProcessing ? (
            <p>Processing file...</p>
          ) : (
            <>
              <p>Drag & drop a file here, or click to select</p>
              <p className="file-size-limit">Supports files up to 1GB</p>
            </>
          )}
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