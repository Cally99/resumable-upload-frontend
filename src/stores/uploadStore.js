import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { UPLOAD_STATUS, UPLOAD_ACTIONS } from './uploadTypes';
import { indexedDBService } from '../services/indexedDBService';

// Initial state
const initialState = {
  uploads: {},
  isLoading: false,
  error: null,
  isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false
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
          // Store file in IndexedDB if it exists and it's not a temporary upload
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
                  // per-upload guard flags
                  isResuming: false,
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
          // Remove file from IndexedDB
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
          // Clear all files from IndexedDB
          indexedDBService.clearAllFiles().catch(error => {
            console.error('Failed to clear files from IndexedDB:', error);
          });

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

        // New: offline/online flags
        setOffline: () => set({ isOffline: true }),
        setOnline: () => set({ isOffline: false }),

        // New: pause all uploading uploads (optionally with reason)
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
        // Persist all upload metadata; files are stored in IndexedDB
        partialize: (state) => {
          const safeUploads = {};
          for (const [id, u] of Object.entries(state.uploads || {})) {
            const { file, isResuming, ...rest } = u; // strip non-serializable file; isResuming is transient UI guard
            safeUploads[id] = rest;
          }
          return { uploads: safeUploads };
        },
        version: 4,
        migrate: (persistedState, version) => {
          // Handle migration from previous versions
          if (persistedState && persistedState.uploads) {
            const cleaned = {};
            for (const [id, u] of Object.entries(persistedState.uploads)) {
              const { file, isResuming, ...rest } = u || {};
              cleaned[id] = rest;
              // For version 4, we no longer need needsFile flag since files are in IndexedDB
              if (version < 4) {
                cleaned[id].needsFile = false;
              }
            }
            persistedState.uploads = cleaned;
          }
          return persistedState;
        },
        // Custom onRehydrate function to restore files from IndexedDB
        onRehydrateStorage: () => (state) => {
          // This function will be called after the state is rehydrated from localStorage
          // We'll use it to restore files from IndexedDB
          if (state && state.uploads) {
            // We'll handle file restoration in the initAfterRehydrate function
            // to ensure proper async handling
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

// Export actions separately for better organization
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
  markAllUploadingAsPaused: useUploadStore.getState().markAllUploadingAsPaused
};