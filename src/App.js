import React from 'react';
import UploadDropzone from './components/UploadDropzone';
import UploadList from './components/UploadList';
import './App.css';

function App() {
  return (
    <div className="App">
      <div className="container">
        <h1>Resumable File Upload</h1>
        <UploadDropzone />
        <UploadList />
      </div>
    </div>
  );
}

export default App;