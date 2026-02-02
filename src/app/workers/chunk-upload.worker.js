// Web Worker for chunked file upload
// 处理大文件上传，避免阻塞主线程

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
let currentAbortController = null;

self.onmessage = async (event) => {
  const { type, file, chunkSize = DEFAULT_CHUNK_SIZE, apiUrl, formData } = event.data;

  if (type === 'start') {
    await uploadFile(file, chunkSize, apiUrl, formData);
  } else if (type === 'cancel') {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    self.postMessage({ type: 'error', error: 'Upload cancelled' });
  }
};

async function uploadFile(file, chunkSize, apiUrl, formData) {
  currentAbortController = new AbortController();

  try {
    const fileSize = file.size;
    const totalChunks = Math.ceil(fileSize / chunkSize);
    
    // 所有文件都使用切片上传
    if (totalChunks === 1) {
      // 如果文件小于一个切片大小，直接上传
      await uploadSingleChunk(file, 0, 1, apiUrl, formData);
    } else {
      // 多个切片，逐个上传
      await uploadChunked(file, chunkSize, totalChunks, apiUrl, formData);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      self.postMessage({ type: 'error', error: 'Upload cancelled' });
    } else {
      self.postMessage({ type: 'error', error: error.message || 'Upload failed' });
    }
  } finally {
    currentAbortController = null;
  }
}

// 上传单个切片（小文件，小于一个切片大小）
async function uploadSingleChunk(file, chunkIndex, totalChunks, apiUrl, formData) {
  const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  return new Promise((resolve, reject) => {
    const uploadFormData = new FormData();
    uploadFormData.append('chunk', file);
    uploadFormData.append('upload_id', uploadId);
    uploadFormData.append('chunk_index', chunkIndex.toString());
    uploadFormData.append('total_chunks', totalChunks.toString());
    uploadFormData.append('filename', file.name);
    uploadFormData.append('chunk_size', file.size.toString());

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const progress = Math.round((e.loaded / e.total) * 100);
        self.postMessage({
          type: 'progress',
          progress,
          loaded: e.loaded,
          total: e.total,
          chunkIndex: chunkIndex + 1,
          totalChunks
        });
      }
    });

    xhr.addEventListener('load', async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const chunkResult = JSON.parse(xhr.responseText);
          
          // 单个切片上传完成后，立即调用完成端点
          await completeUpload(uploadId, apiUrl, formData);
          
          resolve(chunkResult);
        } catch (e) {
          reject(new Error('Invalid response format: ' + e.message));
        }
      } else {
        reject(new Error(`Upload failed: ${xhr.statusText} (${xhr.status})`));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Network error'));
    });

    currentAbortController.signal.addEventListener('abort', () => {
      xhr.abort();
      reject(new Error('Upload cancelled'));
    });

    xhr.timeout = 10 * 60 * 1000; // 10 minutes
    xhr.addEventListener('timeout', () => {
      reject(new Error('Upload timeout'));
    });

    xhr.open('POST', `${apiUrl}/api/upload/chunk`);
    xhr.send(uploadFormData);
  });
}

// 切片上传（所有文件都使用切片）
async function uploadChunked(file, chunkSize, totalChunks, apiUrl, formData) {
  const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  let totalLoaded = 0;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    if (currentAbortController.signal.aborted) {
      throw new Error('Upload cancelled');
    }

    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);

    const chunkFormData = new FormData();
    chunkFormData.append('chunk', chunk);
    chunkFormData.append('upload_id', uploadId);
    chunkFormData.append('chunk_index', chunkIndex.toString());
    chunkFormData.append('total_chunks', totalChunks.toString());
    chunkFormData.append('filename', file.name);
    chunkFormData.append('chunk_size', chunk.size.toString());

    try {
      const responseText = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            // 计算总体进度
            const chunkLoaded = e.loaded;
            const chunkTotal = e.total;
            const chunkProgress = chunkLoaded / chunkTotal;
            const overallProgress = Math.round(
              ((chunkIndex + chunkProgress) / totalChunks) * 100
            );
            
            self.postMessage({
              type: 'chunk-progress',
              progress: overallProgress,
              loaded: totalLoaded + chunkLoaded,
              total: file.size,
              chunkIndex: chunkIndex + 1,
              totalChunks
            });
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            totalLoaded += chunk.length;
            resolve(xhr.responseText);
          } else {
            reject(new Error(`Chunk ${chunkIndex + 1}/${totalChunks} upload failed: ${xhr.statusText} (${xhr.status})`));
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error(`Chunk ${chunkIndex + 1} network error`));
        });

        currentAbortController.signal.addEventListener('abort', () => {
          xhr.abort();
          reject(new Error('Upload cancelled'));
        });

        xhr.timeout = 5 * 60 * 1000; // 每个切片 5 分钟超时
        xhr.addEventListener('timeout', () => {
          reject(new Error(`Chunk ${chunkIndex + 1} upload timeout`));
        });

        xhr.open('POST', `${apiUrl}/api/upload/chunk`);
        xhr.send(chunkFormData);
      });

      // 解析响应，获取已接收的切片数
      try {
        const chunkResult = JSON.parse(responseText);
        const receivedChunks = chunkResult.received_chunks || (chunkIndex + 1);
        
        // 发送切片进度
        const chunkProgress = Math.round((receivedChunks / totalChunks) * 100);
        self.postMessage({
          type: 'chunk-progress',
          chunkIndex: chunkIndex + 1,
          totalChunks,
          progress: chunkProgress,
          loaded: totalLoaded,
          total: file.size
        });
      } catch (e) {
        // 如果响应不是 JSON，继续
        console.warn('Failed to parse chunk response:', e);
      }

    } catch (error) {
      if (error.name === 'AbortError') {
        throw error;
      }
      throw new Error(`Chunk ${chunkIndex + 1} upload failed: ${error.message}`);
    }
  }

  // 所有切片上传完成，调用完成端点
  await completeUpload(uploadId, apiUrl, formData);
}

// 完成上传
async function completeUpload(uploadId, apiUrl, formData) {
  try {
    const completeFormData = new FormData();
    completeFormData.append('upload_id', uploadId);
    completeFormData.append('provider', formData.provider);
    completeFormData.append('bucket', formData.bucket);
    completeFormData.append('region', formData.region);

    const response = await fetch(`${apiUrl}/api/upload/complete`, {
      method: 'POST',
      body: completeFormData,
      signal: currentAbortController.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Complete upload failed: ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    self.postMessage({
      type: 'complete',
      jobId: result.job_id,
      progress: 100
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Upload cancelled');
    }
    throw new Error(`Failed to complete upload: ${error.message}`);
  }
}
