import { Injectable, signal, computed } from '@angular/core';
import { OSSConfig, S3Config, CloudProvider } from '../models';

// ============================================================
// Storage Service - 雲端儲存服務 (對應 Vue 的 stores/storage.ts)
// ============================================================

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  // 私有狀態
  private readonly _provider = signal<CloudProvider>('s3');
  private readonly _isConfigured = signal<boolean>(false);
  private readonly _isConnected = signal<boolean>(false);

  private readonly _ossConfig = signal<OSSConfig>({
    region: '',
    endpoint: '',
    bucket: '',
    accessKeyId: '',
    accessKeySecret: ''
  });

  private readonly _s3Config = signal<S3Config>({
    region: '',
    bucket: '',
    accessKeyId: '',
    secretAccessKey: '',
    isPublic: true
  });

  // 公開的唯讀狀態
  readonly provider = this._provider.asReadonly();
  readonly isConfigured = this._isConfigured.asReadonly();
  readonly isConnected = this._isConnected.asReadonly();
  readonly ossConfig = this._ossConfig.asReadonly();
  readonly s3Config = this._s3Config.asReadonly();

  // 計算屬性：當前配置
  readonly currentConfig = computed(() => {
    return this._provider() === 'oss' ? this._ossConfig() : this._s3Config();
  });

  // 設定 Provider
  setProvider(newProvider: CloudProvider): void {
    this._provider.set(newProvider);
  }

  // 配置 OSS
  configureOSS(config: OSSConfig): void {
    this._ossConfig.set(config);
    this._provider.set('oss');
    this._isConfigured.set(true);
  }

  // 配置 S3
  configureS3(config: S3Config): void {
    this._s3Config.set(config);
    this._provider.set('s3');
    this._isConfigured.set(true);
  }

  // 測試連線
  async testConnection(): Promise<{ success: boolean; message: string }> {
    // 模擬連線測試
    return new Promise(resolve => {
      setTimeout(() => {
        this._isConnected.set(true);
        resolve({
          success: true,
          message: 'Connection successful! Cloud storage is accessible.'
        });
      }, 1000);
    });
  }

  // 生成 Signed URL
  async generateSignedUrl(objectKey: string, expiresIn: number = 3600): Promise<string> {
    if (this._provider() === 'oss') {
      const config = this._ossConfig();
      return `https://${config.bucket}.${config.endpoint}/${objectKey}?expires=${expiresIn}`;
    } else {
      const config = this._s3Config();
      return `https://${config.bucket}.s3.${config.region}.amazonaws.com/${objectKey}?expires=${expiresIn}`;
    }
  }
}
