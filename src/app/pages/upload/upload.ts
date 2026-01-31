import { Component, signal, computed, ViewChild, ElementRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { StorageService } from '../../services/storage.service';
import { CasesService } from '../../services/cases.service';
import { UploadFile, PathologyCase } from '../../models';

@Component({
  selector: 'app-upload',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './upload.html',
  styleUrl: './upload.scss',
})
export class Upload {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  // 後端 API 地址
  readonly BACKEND_URL = ' https://dzi-conversion-production.up.railway.app';

  // 上傳模式: direct (直接到S3) 或 backend (通過後端轉DZI)
  uploadMode = signal<'direct' | 'backend'>('backend');

  // 拖放狀態
  isDragging = signal(false);
  isUploading = signal(false);

  // 上傳佇列
  uploadQueue = signal<UploadFile[]>([]);

  // 案例分配
  assignmentMode = signal<'new' | 'existing'>('new');
  selectedCaseId = signal('');
  stainType = signal('H&E');

  // 新案例資料
  newCase = {
    patientId: '',
    specimenType: '',
    sampleSite: '',
    clinicalHistory: ''
  };

  constructor(
    public storageService: StorageService,
    public casesService: CasesService
  ) {}

  // 現有案例列表
  readonly existingCases = computed(() => this.casesService.cases());

  // 觸發檔案選擇
  triggerFileInput(): void {
    this.fileInput?.nativeElement?.click();
  }

  // 處理檔案選擇
  handleFileSelect(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.files) {
      this.addFilesToQueue(Array.from(target.files));
    }
  }

  // 處理拖放
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
    if (event.dataTransfer?.files) {
      this.addFilesToQueue(Array.from(event.dataTransfer.files));
    }
  }

  // 添加檔案到佇列
  addFilesToQueue(files: File[]): void {
    const validExtensions = ['.svs', '.tiff', '.tif', '.ndpi', '.mrxs', '.vms', '.vmu', '.scn', '.bif', '.png', '.jpg', '.jpeg', '.gif'];

    files.forEach(file => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (validExtensions.includes(ext)) {
        this.uploadQueue.update(queue => [
          ...queue,
          {
            file,
            name: file.name,
            size: file.size,
            progress: 0,
            status: 'pending'
          }
        ]);
      }
    });
  }

  // 從佇列移除
  removeFromQueue(index: number): void {
    this.uploadQueue.update(queue => queue.filter((_, i) => i !== index));
  }

  // 清空佇列
  clearQueue(): void {
    this.uploadQueue.set([]);
  }

  // 格式化檔案大小
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // 開始上傳
  async startUpload(): Promise<void> {
    if (this.uploadMode() === 'direct' && !this.storageService.isConfigured()) {
      alert('Please configure cloud storage in Settings first');
      return;
    }

    this.isUploading.set(true);

    for (let i = 0; i < this.uploadQueue().length; i++) {
      const item = this.uploadQueue()[i];
      if (item.status === 'completed') continue;

      if (this.uploadMode() === 'backend') {
        await this.uploadViaBackend(i);
      } else {
        await this.uploadDirect(i);
      }
    }

    this.isUploading.set(false);
  }

  // 通過後端 API 上傳
  private async uploadViaBackend(index: number): Promise<void> {
    this.updateItemStatus(index, 'uploading', 0);

    try {
      const item = this.uploadQueue()[index];
      const formData = new FormData();
      formData.append('file', item.file);
      formData.append('provider', this.storageService.provider());
      formData.append('bucket', this.storageService.provider() === 's3'
        ? this.storageService.s3Config().bucket
        : this.storageService.ossConfig().bucket);
      formData.append('region', this.storageService.provider() === 's3'
        ? this.storageService.s3Config().region
        : this.storageService.ossConfig().region);

      // 創建 AbortController 用於超時控制
      const controller = new AbortController();
      const uploadTimeout = setTimeout(() => controller.abort(), 10 * 60 * 1000); // 10分鐘上傳超時

      const uploadResponse = await fetch(`${this.BACKEND_URL}/api/upload`, {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });
      
      clearTimeout(uploadTimeout);

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.statusText}`);
      }

      const { job_id } = await uploadResponse.json();
      this.updateItemProgress(index, 30);
      this.updateItemStatus(index, 'processing', 30);

      await this.pollConversionStatus(index, job_id);
    } catch (error) {
      this.updateItemStatus(index, 'error', 0);
      console.error('Upload error:', error);
    }
  }

  // 輪詢轉換狀態
  private async pollConversionStatus(index: number, jobId: string): Promise<void> {
    // 使用時間基礎的超時（30分鐘），而不是嘗試次數
    const maxTimeout = 30 * 60 * 1000; // 30分鐘（毫秒）
    const pollInterval = 2000; // 每2秒輪詢一次
    const startTime = Date.now();
    let lastProgress = 0;
    let noProgressCount = 0;

    while (Date.now() - startTime < maxTimeout) {
      try {
        const response = await fetch(`${this.BACKEND_URL}/api/status/${jobId}`, {
          // 添加超時設置，避免單次請求卡住太久
          signal: AbortSignal.timeout(10000) // 10秒超時
        });
        
        if (!response.ok) {
          throw new Error(`Status check failed: ${response.statusText}`);
        }
        
        const status = await response.json();

        // 更新進度
        if (status.progress !== undefined) {
          this.updateItemProgress(index, status.progress);
          
          // 檢查進度是否有變化
          if (status.progress === lastProgress) {
            noProgressCount++;
            // 如果30秒沒有進度變化，顯示警告但繼續等待
            if (noProgressCount > 15) {
              console.warn(`No progress update for ${noProgressCount * pollInterval / 1000} seconds`);
            }
          } else {
            noProgressCount = 0;
            lastProgress = status.progress;
          }
        }

        if (status.status === 'completed') {
          this.uploadQueue.update(queue => {
            const newQueue = [...queue];
            newQueue[index] = {
              ...newQueue[index],
              status: 'completed',
              dziUrl: status.dzi_url,
              thumbnailUrl: status.thumbnail_url,
              url: status.dzi_url
            };
            return newQueue;
          });

          // 添加到 Case
          await this.addSlideToSelectedCase(index, status.dzi_url, status.thumbnail_url);
          console.log(`Conversion completed for job ${jobId} after ${(Date.now() - startTime) / 1000} seconds`);
          return;
        }

        if (status.status === 'failed') {
          this.updateItemStatus(index, 'error', 0);
          console.error(`Conversion failed for job ${jobId}:`, status.error || 'Unknown error');
          return;
        }

        // 等待後繼續輪詢
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error: any) {
        console.error('Status check error:', error);
        
        // 如果是超時錯誤，繼續重試
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
          console.warn('Request timeout, retrying...');
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
        }
        
        // 其他錯誤也繼續重試，但增加等待時間
        await new Promise(resolve => setTimeout(resolve, pollInterval * 2));
      }
    }

    // 超時處理
    const elapsedMinutes = (Date.now() - startTime) / 1000 / 60;
    console.error(`Conversion timeout after ${elapsedMinutes.toFixed(1)} minutes for job ${jobId}`);
    this.updateItemStatus(index, 'error', 0);
    alert(`轉換超時（已等待 ${elapsedMinutes.toFixed(1)} 分鐘）。請檢查後端服務是否正常運行，或檔案是否過大。`);
  }

  // 直接上傳到 S3/OSS
  private async uploadDirect(index: number): Promise<void> {
    this.updateItemStatus(index, 'uploading', 0);

    // 模擬上傳進度
    for (let progress = 0; progress <= 100; progress += 10) {
      this.updateItemProgress(index, progress);
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    this.updateItemStatus(index, 'completed', 100);
  }

  // 添加 Slide 到選定的 Case
  private async addSlideToSelectedCase(index: number, dziUrl: string, thumbnailUrl: string): Promise<void> {
    let targetCaseId = '';
    const item = this.uploadQueue()[index];

    if (this.assignmentMode() === 'new') {
      // 總是創建新 case，即使沒有填寫 Patient ID
      const createdCase = this.casesService.createCase({
        patientId: this.newCase.patientId,
        specimenType: this.newCase.specimenType,
        sampleSite: this.newCase.sampleSite,
        clinicalHistory: this.newCase.clinicalHistory
      });
      targetCaseId = createdCase.id;
    } else {
      targetCaseId = this.selectedCaseId();
    }

    if (targetCaseId) {
      this.casesService.addSlideToCase(targetCaseId, {
        id: `slide_${Date.now()}_${index}`,
        name: item.name.replace(/\.[^/.]+$/, ''),
        stainType: this.stainType(),
        thumbnailUrl: thumbnailUrl,
        dziUrl: dziUrl,
        mpp: 0.25,
        width: 1950,
        height: 1301,
        uploadedAt: new Date().toISOString()
      });
    }
  }

  // 更新項目狀態
  private updateItemStatus(index: number, status: UploadFile['status'], progress: number): void {
    this.uploadQueue.update(queue => {
      const newQueue = [...queue];
      newQueue[index] = { ...newQueue[index], status, progress };
      return newQueue;
    });
  }

  // 更新項目進度
  private updateItemProgress(index: number, progress: number): void {
    this.uploadQueue.update(queue => {
      const newQueue = [...queue];
      newQueue[index] = { ...newQueue[index], progress };
      return newQueue;
    });
  }

  // 設定分配模式
  setAssignmentMode(mode: 'new' | 'existing'): void {
    this.assignmentMode.set(mode);
  }
}
