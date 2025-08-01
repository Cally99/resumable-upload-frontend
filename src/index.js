import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Wire online/offline listeners and auto-resume on reload
import { useUploadStore } from './stores/uploadStore';
import { uploadActions } from './stores/uploadActions';

const root = ReactDOM.createRoot(document.getElementById('root'));

// Ensure initAfterRehydrate is called AFTER Zustand persist rehydrates
function waitForRehydrate() {
  return new Promise((resolve) => {
    const state = useUploadStore.getState();
    // If middleware added a flag, use it; otherwise poll for uploads presence
    if (state && typeof state.getUploads === 'function') {
      // Small delay to allow rehydrate microtask to complete
      setTimeout(resolve, 0);
    } else {
      // Fallback polling (very unlikely)
      const id = setInterval(() => {
        const s = useUploadStore.getState();
        if (s && typeof s.getUploads === 'function') {
          clearInterval(id);
          resolve();
        }
      }, 10);
    }
  });
}

function initConnectivityHandlers() {
  const { setOffline, setOnline, markAllUploadingAsPaused, getUploads } = useUploadStore.getState();

  const handleOffline = () => {
    setOffline();
    // Pause any actively uploading items and annotate with error
    markAllUploadingAsPaused('offline');
    // Persisted by zustand/persist automatically
  };

  const handleOnline = async () => {
    setOnline();
    // Best-effort: reconcile and attempt resume for paused uploads
    const uploads = getUploads();
    for (const u of uploads) {
      if (u.status === 'paused') {
        try {
          uploadActions.resumeUpload(u.uploadId);
        } catch (e) {
          // per-upload errors recorded in state
        }
      }
    }
  };

  // Initialize based on current navigator status
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    handleOffline();
  }

  // Attach listeners
  window.addEventListener('offline', handleOffline);
  window.addEventListener('online', handleOnline);
}

// Attempt to auto-resume when the tab regains focus (handles crash/restart and server reconnection)
function initVisibilityAutoResume() {
  const onFocus = async () => {
    const { getUploads } = useUploadStore.getState();
    const uploads = getUploads();
    // On focus, reconcile status for all active uploads and resume if online
    for (const u of uploads) {
      if (['pending', 'paused', 'uploading'].includes(u.status)) {
        try {
          await uploadActions.refreshStatus(u.uploadId);
          if (typeof navigator === 'undefined' || navigator.onLine) {
            // If still not completed, ensure we're in uploading and continue
            const refreshed = useUploadStore.getState().getUpload(u.uploadId);
            if (refreshed && refreshed.status !== 'completed') {
              uploadActions.resumeUpload(u.uploadId);
            }
          }
        } catch {
          // Non-fatal; upload holds its own lastError
        }
      }
    }
  };
  window.addEventListener('focus', onFocus);
}

async function bootstrap() {
  initConnectivityHandlers();

  // Wait until store has been rehydrated from localStorage before reconciling
  await waitForRehydrate();

  // Reconcile server state and auto-resume interrupted uploads after refresh/crash
  try {
    await uploadActions.initAfterRehydrate({ autoResumeOnReload: true });
  } catch {
    // Non-fatal; individual uploads carry their own error messages
  }

  // Also resume on tab focus (helps recover after browser restart/crash)
  initVisibilityAutoResume();
}

bootstrap();

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);