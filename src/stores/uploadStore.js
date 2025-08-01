import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { UPLOAD_STATUS, UPLOAD_ACTIONS } from './uploadTypes';
import { indexedDBService } from '../services/indexedDBService';

// Initial state for persistent data
const initialPersistentState = {
  uploads: {}
};

// Initial state for transient UI state
const initialUIState = {
  isLoading: false,
  error: null,
  isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
  isResuming: false,
  dragOver: false
};

export const useUploadStore = create(
  devtools(
    persist(
      (set, get) => ({
        // Persistent data
        ...initialPersistentState,
        
        // Transient UI state
        ui: { ...initialUIState },

        // Simplified selectors
        getUploads: () => Object.values(get().uploads),
        getUpload: (uploadId) => get().uploads[uploadId] || null,
        getUploadsByStatus: (status) =>
          Object.values(get().uploads).filter(upload => upload.status === status),
        getActiveUploads: () =>
          Object.values(get().uploads).filter(upload =>
            [UPLOAD_STATUS.UPLOADING, UPLOAD_STATUS.PENDING, UPLOAD_STATUS.PAUSED].includes(upload.status)
          ),
        
        getUIState: () => get().ui,
        getIsResuming: () => get().ui.isResuming,
        getDragOver: () => get().ui.dragOver,

        updateUpload: (uploadId, updates) =>
          set(state => ({
            uploads: {
              ...state.uploads,
              [uploadId]: { ...state.uploads[uploadId], ...updates }
            }
          }), false, { type: UPLOAD_ACTIONS.UPDATE_UPLOAD, uploadId, updates }),

        addUpload: (upload) => {
          if (upload.file && !upload.uploadId.startsWith('temp_')) {
            indexedDBService.storeFile(upload.uploadId, upload.file).catch(error => {
              console.error('Failed to store file in IndexedDB:', error);
            });
          }

          set(
            (state) => ({
              uploads: {
                ...state.uploads,
                [upload.uploadId]: {
                  needsFile: false,
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

        removeUpload: (uploadId) => {
          indexedDBService.deleteFile(uploadId).catch(error => {
            console.error('Failed to delete file from IndexedDB:', error);
          });

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
          const actualUploadedBytes = uploadedChunks.reduce((total, chunkIndex) => {
            const chunkStart = chunkIndex * chunkSize;
            const chunkEnd = Math.min(chunkStart + chunkSize, filesize);
            return total + (chunkEnd - chunkStart);
          }, 0);

          const progress = Math.min((actualUploadedBytes / filesize) * 100, 100);

          set(
            (state) => ({
              uploads: {
                ...state.uploads,
                [uploadId]: {
                  ...state.uploads[uploadId],
                  uploadedChunks: [...uploadedChunks].sort((a, b) => a - b),
                  uploadedBytes: actualUploadedBytes,
                  progress
                }
              }
            }),
            false,
            { type: UPLOAD_ACTIONS.UPDATE_PROGRESS, uploadId }
          );
        },

        setUploadStatus: (uploadId, status) =>
          set(state => ({
            uploads: {
              ...state.uploads,
              [uploadId]: { ...state.uploads[uploadId], status }
            }
          }), false, { type: UPLOAD_ACTIONS.SET_STATUS, uploadId, status }),

        clearAllUploads: () => {
          indexedDBService.clearAllFiles().catch(error => {
            console.error('Failed to clear files from IndexedDB:', error);
          });

          set(
            { uploads: {} },
            false,
            { type: UPLOAD_ACTIONS.CLEAR_ALL }
          );
        },

        // UI state actions
        updateUIState: (updates) =>
          set(state => ({ ui: { ...state.ui, ...updates } })),
          
        setResuming: (isResuming) =>
          set(state => ({ ui: { ...state.ui, isResuming } })),
          
        setDragOver: (dragOver) =>
          set(state => ({ ui: { ...state.ui, dragOver } })),
          
        setLoading: (isLoading) =>
          set(state => ({ ui: { ...state.ui, isLoading } })),
          
        setError: (error) =>
          set(state => ({ ui: { ...state.ui, error } })),
          
        clearError: () =>
          set(state => ({ ui: { ...state.ui, error: null } })),
          
        setOffline: () =>
          set(state => ({ ui: { ...state.ui, isOffline: true } })),
          
        setOnline: () =>
          set(state => ({ ui: { ...state.ui, isOffline: false } })),

        markAllUploadingAsPaused: (reason = 'offline') => {
          set((state) => {
            const updated = { ...state.uploads };
            Object.values(updated).forEach(u => {
              if (u.status === UPLOAD_STATUS.UPLOADING) {
                updated[u.uploadId] = {
                  ...u,
                  status: UPLOAD_STATUS.PAUSED,
                  lastError: reason,
                  lastErrorAt: new Date().toISOString()
                };
              }
            });
            return { uploads: updated };
          });
        },

        clearStaleUploads: (file) => {
          const staleCutoff = Date.now() - (24 * 60 * 60 * 1000);

          set(
            (state) => {
              const filteredUploads = Object.fromEntries(
                Object.entries(state.uploads).filter(([uploadId, upload]) => {
                  const isSameFile = upload.filename === file.name && upload.filesize === file.size;
                  const isStale = new Date(upload.createdAt).getTime() < staleCutoff;
                  const isFailedOrCanceled = [UPLOAD_STATUS.FAILED, UPLOAD_STATUS.CANCELED].includes(upload.status);

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
        name: 'resumable-uploads',
        partialize: (state) => {
          // Only persist uploads data, not UI state
          const safeUploads = {};
          for (const [id, u] of Object.entries(state.uploads || {})) {
            const { file, ...rest } = u;
            safeUploads[id] = rest;
          }
          return { uploads: safeUploads };
        },
        version: 5,
        migrate: (persistedState, version) => {
          if (persistedState && persistedState.uploads) {
            const cleaned = {};
            for (const [id, u] of Object.entries(persistedState.uploads)) {
              const { file, isResuming, ...rest } = u || {};
              cleaned[id] = rest;
              if (version < 4) {
                cleaned[id].needsFile = false;
              }
            }
            persistedState.uploads = cleaned;
          }
          
          // Initialize UI state if migrating from older version
          if (version < 5) {
            persistedState.ui = initialUIState;
          }
          
          return persistedState;
        },
        onRehydrateStorage: () => (state) => {
          if (state && state.uploads) {
            // Ensure UI state is properly initialized
            if (!state.ui) {
              state.ui = { ...initialUIState };
            }
          }
          return state;
        }
      }
    ),
    {
      name: 'upload-store', // DevTools name
      enabled: process.env.NODE_ENV === 'development'
    }
  )
);

export const uploadStoreActions = {
  addUpload: useUploadStore.getState().addUpload,
  updateUpload: useUploadStore.getState().updateUpload,
  removeUpload: useUploadStore.getState().removeUpload,
  updateProgress: useUploadStore.getState().updateProgress,
  setUploadStatus: useUploadStore.getState().setUploadStatus,
  clearAllUploads: useUploadStore.getState().clearAllUploads,
  clearStaleUploads: useUploadStore.getState().clearStaleUploads,
  setOffline: useUploadStore.getState().setOffline,
  setOnline: useUploadStore.getState().setOnline,
  markAllUploadingAsPaused: useUploadStore.getState().markAllUploadingAsPaused,
  updateUIState: useUploadStore.getState().updateUIState,
  setResuming: useUploadStore.getState().setResuming,
  setDragOver: useUploadStore.getState().setDragOver
};