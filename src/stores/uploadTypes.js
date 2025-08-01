// Upload status constants
export const UPLOAD_STATUS = {
  INITIATING: 'initiating',
  PENDING: 'pending',
  UPLOADING: 'uploading',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELED: 'canceled'
};

// Upload action types for better debugging
export const UPLOAD_ACTIONS = {
  ADD_UPLOAD: 'ADD_UPLOAD',
  UPDATE_UPLOAD: 'UPDATE_UPLOAD',
  REMOVE_UPLOAD: 'REMOVE_UPLOAD',
  UPDATE_PROGRESS: 'UPDATE_PROGRESS',
  SET_STATUS: 'SET_STATUS',
  CLEAR_ALL: 'CLEAR_ALL'
};