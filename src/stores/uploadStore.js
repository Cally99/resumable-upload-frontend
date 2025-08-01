import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { UPLOAD_STATUS, UPLOAD_ACTIONS } from './uploadTypes';

// Initial state
const initialState = {
  uploads: {},
  isLoading: false,
  error: null
};

// Create the upload store
export const useUploadStore = create(
  devtools(
    persist(
      (set, get) => ({
        // State
        ...initialState,

        // Selectors
        getUploads: () => Object.values(get().uploads),
        getUpload: (uploadId) => get().uploads[uploadId] || null,
        getUploadsByStatus: (status) => 
          Object.values(get().uploads).filter(upload => upload.status === status),
        getActiveUploads: () => 
          Object.values(get().uploads).filter(upload => 
            [UPLOAD_STATUS.UPLOADING, UPLOAD_STATUS.PENDING, UPLOAD_STATUS.PAUSED].includes(upload.status)
          ),

        // Actions
        addUpload: (upload) => {
          set(
            (state) => ({
              uploads: {
                ...state.uploads,
                [upload.uploadId]: {
                  ...upload,
                  createdAt: upload.createdAt || new Date().toISOString(),
                  uploadedChunks: upload.uploadedChunks || [],
                  progress: upload.progress || 0,
                  uploadedBytes: upload.uploadedBytes || 0
                }
              }
            }),
            false,
            { type: UPLOAD_ACTIONS.ADD_UPLOAD, uploadId: upload.uploadId }
          );
        },

        updateUpload: (uploadId, updates) => {
          set(
            (state) => {
              if (!state.uploads[uploadId]) return state;
              
              return {
                uploads: {
                  ...state.uploads,
                  [uploadId]: {
                    ...state.uploads[uploadId],
                    ...updates
                  }
                }
              };
            },
            false,
            { type: UPLOAD_ACTIONS.UPDATE_UPLOAD, uploadId, updates }
          );
        },

        removeUpload: (uploadId) => {
          set(
            (state) => {
              const { [uploadId]: removed, ...remainingUploads } = state.uploads;
              return { uploads: remainingUploads };
            },
            false,
            { type: UPLOAD_ACTIONS.REMOVE_UPLOAD, uploadId }
          );
        },

        updateProgress: (uploadId, uploadedChunks, chunkSize, filesize) => {
          set(
            (state) => {
              if (!state.uploads[uploadId]) return state;

              // Calculate accurate progress
              const actualUploadedBytes = uploadedChunks.reduce((total, chunkIndex) => {
                const chunkStart = chunkIndex * chunkSize;
                const chunkEnd = Math.min(chunkStart + chunkSize, filesize);
                return total + (chunkEnd - chunkStart);
              }, 0);

              const progress = Math.min((actualUploadedBytes / filesize) * 100, 100);

              return {
                uploads: {
                  ...state.uploads,
                  [uploadId]: {
                    ...state.uploads[uploadId],
                    uploadedChunks: [...uploadedChunks].sort((a, b) => a - b),
                    uploadedBytes: actualUploadedBytes,
                    progress: progress
                  }
                }
              };
            },
            false,
            { type: UPLOAD_ACTIONS.UPDATE_PROGRESS, uploadId }
          );
        },

        setUploadStatus: (uploadId, status) => {
          set(
            (state) => {
              if (!state.uploads[uploadId]) return state;
              
              return {
                uploads: {
                  ...state.uploads,
                  [uploadId]: {
                    ...state.uploads[uploadId],
                    status
                  }
                }
              };
            },
            false,
            { type: UPLOAD_ACTIONS.SET_STATUS, uploadId, status }
          );
        },

        clearAllUploads: () => {
          set(
            { uploads: {} },
            false,
            { type: UPLOAD_ACTIONS.CLEAR_ALL }
          );
        },

        setLoading: (isLoading) => {
          set({ isLoading });
        },

        setError: (error) => {
          set({ error });
        },

        clearError: () => {
          set({ error: null });
        },

        // Utility actions
        clearStaleUploads: (file) => {
          const staleCutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
          
          set(
            (state) => {
              const filteredUploads = Object.fromEntries(
                Object.entries(state.uploads).filter(([uploadId, upload]) => {
                  const isSameFile = upload.filename === file.name && upload.filesize === file.size;
                  const isStale = new Date(upload.createdAt).getTime() < staleCutoff;
                  const isFailedOrCanceled = [UPLOAD_STATUS.FAILED, UPLOAD_STATUS.CANCELED].includes(upload.status);
                  
                  // Keep upload if it's NOT the same file OR NOT stale AND NOT failed/canceled
                  return !(isSameFile && (isStale || isFailedOrCanceled));
                })
              );
              
              return { uploads: filteredUploads };
            },
            false,
            { type: 'CLEAR_STALE_UPLOADS', filename: file.name }
          );
        }
      }),
      {
        name: 'resumable-uploads', // localStorage key
        partialize: (state) => ({ uploads: state.uploads }), // Only persist uploads
        version: 1,
        migrate: (persistedState, version) => {
          // Handle migration from old localStorage format if needed
          if (version === 0) {
            // Migration logic for old format
            return persistedState;
          }
          return persistedState;
        }
      }
    ),
    {
      name: 'upload-store', // DevTools name
      enabled: process.env.NODE_ENV === 'development'
    }
  )
);

// Export actions separately for better organization
export const uploadStoreActions = {
  addUpload: useUploadStore.getState().addUpload,
  updateUpload: useUploadStore.getState().updateUpload,
  removeUpload: useUploadStore.getState().removeUpload,
  updateProgress: useUploadStore.getState().updateProgress,
  setUploadStatus: useUploadStore.getState().setUploadStatus,
  clearAllUploads: useUploadStore.getState().clearAllUploads,
  clearStaleUploads: useUploadStore.getState().clearStaleUploads
};