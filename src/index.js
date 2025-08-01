import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

import { useUploadStore } from './stores/uploadStore';
import { uploadActions } from './stores/uploadActions';

const root = ReactDOM.createRoot(document.getElementById('root'));

function waitForRehydrate() {
  return new Promise((resolve) => {
    const state = useUploadStore.getState();
    if (state && typeof state.getUploads === 'function') {
      // Small delay to allow rehydrate microtask to complete
      setTimeout(resolve, 0);
    } else {
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
    markAllUploadingAsPaused('offline');
  };

  const handleOnline = async () => {
    setOnline();
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

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    handleOffline();
  }

  window.addEventListener('offline', handleOffline);
  window.addEventListener('online', handleOnline);
}

function initVisibilityAutoResume() {
  const onFocus = async () => {
    const { getUploads } = useUploadStore.getState();
    const uploads = getUploads();
    for (const u of uploads) {
      if (['pending', 'paused', 'uploading'].includes(u.status)) {
        try {
          await uploadActions.refreshStatus(u.uploadId);
          if (typeof navigator === 'undefined' || navigator.onLine) {
            const refreshed = useUploadStore.getState().getUpload(u.uploadId);
            if (refreshed && refreshed.status !== 'completed') {
              uploadActions.resumeUpload(u.uploadId);
            }
          }
        } catch {
        }
      }
    }
  };
  window.addEventListener('focus', onFocus);
}

async function bootstrap() {
  initConnectivityHandlers();

  await waitForRehydrate();

  try {
    await uploadActions.initAfterRehydrate({ autoResumeOnReload: true });
  } catch {
  }

  initVisibilityAutoResume();
}

bootstrap();

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);