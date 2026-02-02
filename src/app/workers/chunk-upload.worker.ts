// Web Worker for chunked file upload
// 处理大文件的切片上传，避免阻塞主线程

interface UploadMessage {
  type: 'start' | 'cancel';
  file: File;
  chunkSize: number;
  apiUrl: string;
  formData: {
    provider: string;
    bucket: string;
    region: string;
  };
}

interface ProgressMessage {
  type: 'progress' | 'chunk-progress' | 'complete' | 'error';
  progress?: number;
  chunkIndex?: number;
  totalChunks?: number;
  loaded?: number;
  total?: number;
  jobId?: string;
  error?: string;
}

// 默认切片大小：5MB
const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

// 当前上传任务
let currentAbortController: AbortController | null = null;

self.onmessage = async (event: MessageEvent<UploadMessage>) => {
  const { type, file, chunkSize = DEFAULT_CHUNK_SIZE, apiUrl, formData } = event.data;

  if (type === 'start') {
    await uploadFileInChunks(file, chunkSize, apiUrl, formData);
  } else if (type === 'cancel') {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    self.postMessage({ type: 'error', error: 'Upload cancelled' } as ProgressMessage);
  }
};

/**
 * 切片上传文件
 */
async function uploadFileInChunks(
  file: File,
  chunkSize: number,
  apiUrl: string,
  formData: { provider: string; bucket: string; region: string }
): Promise<void> {
  const fileSize = file.size;
  const totalChunks = Math.ceil(fileSize / chunkSize);
  
  // 创建 AbortController 用于取消上传
  currentAbortController = new AbortController();

  try {
    // 对于小文件（< 50MB），直接上传
    if (fileSize < 50 * 1024 * 1024) {
      await uploadSingleFile(file, apiUrl, formData, currentAbortController.signal);
      return;
    }

    // 大文件使用切片上传
    // 注意：如果后端不支持切片上传，这里需要先检查后端 API
    // 目前根据文档，后端接受标准的 multipart/form-data，所以我们可以：
    // 1. 直接上传整个文件（推荐，因为后端会处理）
    // 2. 或者实现前端切片上传（如果后端支持）

    // 方案 1：直接上传（后端会处理切片）
    await uploadSingleFile(file, apiUrl, formData, currentAbortController.signal);

    // 方案 2：如果需要前端切片上传，可以取消注释下面的代码
    // await uploadChunked(file, chunkSize, totalChunks, apiUrl, formData, currentAbortController.signal);

  } catch (error: any) {
    if (error.name === 'AbortError') {
      self.postMessage({ type: 'error', error: 'Upload cancelled' } as ProgressMessage);
    } else {
      self.postMessage({ 
        type: 'error', 
        error: error.message || 'Upload failed' 
      } as ProgressMessage);
    }
  } finally {
    currentAbortController = null;
  }
}

/**
 * 单文件上传（带进度）
 */
async function uploadSingleFile(
  file: File,
  apiUrl: string,
  formData: { provider: string; bucket: string; region: string },
  signal: AbortSignal
): Promise<void> {
  const uploadFormData = new FormData();
  uploadFormData.append('file', file);
  uploadFormData.append('provider', formData.provider);
  uploadFormData.append('bucket', formData.bucket);
  uploadFormData.append('region', formData.region);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // 上传进度
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const progress = Math.round((e.loaded / e.total) * 100);
        self.postMessage({
          type: 'progress',
          progress,
          loaded: e.loaded,
          total: e.total
        } as ProgressMessage);
      }
    });

    // 完成
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText);
          self.postMessage({
            type: 'complete',
            jobId: result.job_id,
            progress: 100
          } as ProgressMessage);
          resolve();
        } catch (e) {
          reject(new Error('Invalid response format'));
        }
      } else {
        reject(new Error(`Upload failed: ${xhr.statusText} (${xhr.status})`));
      }
    });

    // 错误
    xhr.addEventListener('error', () => {
      reject(new Error('Network error'));
    });

    // 取消
    signal.addEventListener('abort', () => {
      xhr.abort();
      reject(new Error('Upload cancelled'));
    });

    // 超时（10分钟）
    xhr.timeout = 10 * 60 * 1000;
    xhr.addEventListener('timeout', () => {
      reject(new Error('Upload timeout'));
    });

    // 开始上传
    xhr.open('POST', `${apiUrl}/api/upload`);
    xhr.send(uploadFormData);
  });
}

/**
 * 切片上传（如果后端支持）
 * 注意：这需要后端支持切片上传 API
 */
async function uploadChunked(
  file: File,
  chunkSize: number,
  totalChunks: number,
  apiUrl: string,
  formData: { provider: string; bucket: string; region: string },
  signal: AbortSignal
): Promise<void> {
  // 生成上传 ID
  const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    if (signal.aborted) {
      throw new Error('Upload cancelled');
    }

    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);

    const chunkFormData = new FormData();
    chunkFormData.append('file', chunk, file.name);
    chunkFormData.append('chunk_index', chunkIndex.toString());
    chunkFormData.append('total_chunks', totalChunks.toString());
    chunkFormData.append('upload_id', uploadId);
    chunkFormData.append('provider', formData.provider);
    chunkFormData.append('bucket', formData.bucket);
    chunkFormData.append('region', formData.region);

    try {
      const response = await fetch(`${apiUrl}/api/upload/chunk`, {
        method: 'POST',
        body: chunkFormData,
        signal
      });

      if (!response.ok) {
        throw new Error(`Chunk ${chunkIndex + 1}/${totalChunks} upload failed`);
      }

      // 发送切片进度
      const chunkProgress = Math.round(((chunkIndex + 1) / totalChunks) * 100);
      self.postMessage({
        type: 'chunk-progress',
        chunkIndex: chunkIndex + 1,
        totalChunks,
        progress: chunkProgress
      } as ProgressMessage);

      // 如果是最后一个切片，完成上传
      if (chunkIndex === totalChunks - 1) {
        const result = await response.json();
        self.postMessage({
          type: 'complete',
          jobId: result.job_id,
          progress: 100
        } as ProgressMessage);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw error;
      }
      throw new Error(`Chunk ${chunkIndex + 1} upload failed: ${error.message}`);
    }
  }
}
