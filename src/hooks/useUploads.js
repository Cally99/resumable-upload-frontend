import { useUploadStore } from '../stores/uploadStore';
import { uploadActions } from '../stores/uploadActions';

// Main hook for upload operations
export const useUploads = () => {
  const uploads = useUploadStore(state => state.getUploads());
  const isLoading = useUploadStore(state => state.isLoading);
  const error = useUploadStore(state => state.error);
  
  return {
    uploads,
    isLoading,
    error,
    addUpload: uploadActions.initiateUpload,
    startUpload: uploadActions.startUpload,
    pauseUpload: uploadActions.pauseUpload,
    resumeUpload: uploadActions.resumeUpload,
    cancelUpload: uploadActions.cancelUpload,
    removeUpload: uploadActions.removeUpload
  };
};

// Hook for specific upload
export const useUpload = (uploadId) => {
  const upload = useUploadStore(state => state.getUpload(uploadId));
  
  return {
    upload,
    startUpload: () => uploadActions.startUpload(uploadId),
    pauseUpload: () => uploadActions.pauseUpload(uploadId),
    resumeUpload: () => uploadActions.resumeUpload(uploadId),
    cancelUpload: () => uploadActions.cancelUpload(uploadId),
    removeUpload: () => uploadActions.removeUpload(uploadId)
  };
};

// Hook for active uploads only
export const useActiveUploads = () => {
  const activeUploads = useUploadStore(state => state.getActiveUploads());
  return activeUploads;
};

// Hook for uploads by status
export const useUploadsByStatus = (status) => {
  const uploads = useUploadStore(state => state.getUploadsByStatus(status));
  return uploads;
};