import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

// ============================================================
// Chunk Upload Service - 切片上传服务
// 使用 Web Worker 处理大文件上传
// ============================================================

export interface UploadProgress {
  progress: number;
  loaded: number;
  total: number;
  chunkIndex?: number;
  totalChunks?: number;
}

export interface UploadResult {
  jobId: string;
  status: 'completed' | 'error';
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ChunkUploadService {
  private worker: Worker | null = null;
  private progressSubject = new Subject<UploadProgress>();
  private resultSubject = new Subject<UploadResult>();

  constructor() {
    this.initWorker();
  }

  /**
   * 初始化 Web Worker
   */
  private initWorker(): void {
    if (typeof Worker !== 'undefined') {
      try {
        // 尝试使用 import.meta.url（现代浏览器）
        if (import.meta.url) {
          this.worker = new Worker(
            new URL('../workers/chunk-upload.worker.js', import.meta.url),
            { type: 'classic' }
          );
        } else {
          throw new Error('import.meta.url not available');
        }
      } catch (error) {
        console.warn('Failed to create Worker with import.meta.url, trying asset path', error);
        // 备用方案：使用 assets 路径（Worker 文件会被复制到 assets）
        try {
          // 在开发环境中，Worker 文件在 src/app/workers
          // 在生产环境中，Worker 文件在 /workers/（通过 angular.json 配置）
          const workerPath = '/workers/chunk-upload.worker.js';
          this.worker = new Worker(workerPath, { type: 'classic' });
        } catch (fallbackError) {
          console.error('Failed to create Worker:', fallbackError);
          // 如果 Worker 创建失败，服务仍然可以工作，但会在主线程执行
          console.warn('Worker not available, uploads will run on main thread');
        }
      }

      if (this.worker) {
        this.worker.onmessage = (event: MessageEvent) => {
          const { type, progress, loaded, total, chunkIndex, totalChunks, jobId, error } = event.data;

          if (type === 'progress' || type === 'chunk-progress') {
            this.progressSubject.next({
              progress: progress || 0,
              loaded: loaded || 0,
              total: total || 0,
              chunkIndex,
              totalChunks
            });
          } else if (type === 'complete') {
            this.resultSubject.next({
              jobId: jobId || '',
              status: 'completed'
            });
          } else if (type === 'error') {
            this.resultSubject.next({
              jobId: '',
              status: 'error',
              error: error || 'Upload failed'
            });
          }
        };

        this.worker.onerror = (error) => {
          console.error('Worker error:', error);
          this.resultSubject.next({
            jobId: '',
            status: 'error',
            error: error.message || 'Worker error'
          });
        };
      }
    } else {
      console.warn('Web Workers are not supported in this browser');
    }
  }

  /**
   * 上传文件
   */
  uploadFile(
    file: File,
    apiUrl: string,
    options: {
      provider: string;
      bucket: string;
      region: string;
      chunkSize?: number;
    }
  ): { progress$: Observable<UploadProgress>; result$: Observable<UploadResult> } {
    if (!this.worker) {
      throw new Error('Web Worker is not available');
    }

    // 发送上传任务到 Worker
    this.worker.postMessage({
      type: 'start',
      file,
      chunkSize: options.chunkSize || 5 * 1024 * 1024, // 默认 5MB
      apiUrl,
      formData: {
        provider: options.provider,
        bucket: options.bucket,
        region: options.region
      }
    });

    return {
      progress$: this.progressSubject.asObservable(),
      result$: this.resultSubject.asObservable()
    };
  }

  /**
   * 取消上传
   */
  cancelUpload(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'cancel' });
    }
  }

  /**
   * 清理 Worker
   */
  destroy(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.progressSubject.complete();
    this.resultSubject.complete();
  }
}
