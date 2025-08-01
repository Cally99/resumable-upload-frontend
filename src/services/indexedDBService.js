// IndexedDB service for storing File objects
const DB_NAME = 'ResumableUploadDB';
const DB_VERSION = 1;
const STORE_NAME = 'files';

class IndexedDBService {
  constructor() {
    this.db = null;
    this.initPromise = null;
  }

  // Initialize the database
  async init() {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject(event.target.error);
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'uploadId' });
          store.createIndex('filename', 'filename', { unique: false });
          store.createIndex('filesize', 'filesize', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });

    return this.initPromise;
  }

  // Store a file in IndexedDB
  async storeFile(uploadId, file) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      const fileData = {
        uploadId,
        file,
        filename: file.name,
        filesize: file.size,
        filetype: file.type,
        createdAt: new Date().toISOString()
      };

      const request = store.put(fileData);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Retrieve a file from IndexedDB
  async getFile(uploadId) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      
      const request = store.get(uploadId);

      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          resolve(result.file);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Delete a file from IndexedDB
  async deleteFile(uploadId) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      const request = store.delete(uploadId);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Get all files from IndexedDB
  async getAllFiles() {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      
      const request = store.getAll();

      request.onsuccess = () => {
        const files = {};
        request.result.forEach(item => {
          files[item.uploadId] = item.file;
        });
        resolve(files);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Clear all files from IndexedDB
  async clearAllFiles() {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      const request = store.clear();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Clean up old files (older than specified days)
  async cleanupOldFiles(days = 7) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      
      const request = store.index('createdAt').openCursor(IDBKeyRange.upperBound(cutoffDate.toISOString()));
      
      const deletedKeys = [];
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          deletedKeys.push(cursor.value.uploadId);
          cursor.delete();
          cursor.continue();
        } else {
          resolve(deletedKeys);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }
}

// Export singleton instance
export const indexedDBService = new IndexedDBService();
export default indexedDBService;