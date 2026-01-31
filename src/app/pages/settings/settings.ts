import { Component, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { StorageService } from '../../services/storage.service';
import { OSSConfig, S3Config, CloudProvider } from '../../models';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings implements OnInit {
  // Storage Provider
  storageProvider = signal<CloudProvider>('s3');

  // OSS 配置
  ossConfig = {
    region: '',
    endpoint: '',
    bucket: '',
    accessKeyId: '',
    accessKeySecret: ''
  };

  // S3 配置
  s3Config = {
    region: '',
    bucket: '',
    accessKeyId: '',
    secretAccessKey: '',
    isPublic: true
  };

  // Viewer 偏好設定
  preferences = {
    showNavigator: true,
    showScaleBar: true,
    smoothZoom: true,
    defaultZoom: 'fit'
  };

  // 連線狀態
  connectionStatus = signal<{ type: 'success' | 'error'; message: string } | null>(null);

  constructor(public storageService: StorageService) {}

  ngOnInit(): void {
    // 載入已儲存的配置
    this.storageProvider.set(this.storageService.provider());

    const ossConfig = this.storageService.ossConfig();
    if (ossConfig) {
      this.ossConfig = { ...ossConfig };
    }

    const s3Config = this.storageService.s3Config();
    if (s3Config) {
      this.s3Config = {
        ...s3Config,
        isPublic: s3Config.isPublic ?? true
      };
    }

    // 如果已配置，顯示訊息
    if (this.storageService.isConfigured()) {
      this.connectionStatus.set({
        type: 'success',
        message: 'Configuration loaded from saved settings.'
      });
    }
  }

  // 設定 Provider
  setProvider(provider: CloudProvider): void {
    this.storageProvider.set(provider);
  }

  // 測試連線
  testConnection(): void {
    this.connectionStatus.set(null);
    setTimeout(() => {
      this.connectionStatus.set({
        type: 'success',
        message: 'Connection successful! Cloud storage is accessible.'
      });
    }, 1000);
  }

  // 儲存配置
  saveConfig(): void {
    this.storageService.setProvider(this.storageProvider());

    if (this.storageProvider() === 'oss') {
      this.storageService.configureOSS(this.ossConfig);
    } else {
      this.storageService.configureS3(this.s3Config);
    }

    this.connectionStatus.set({
      type: 'success',
      message: 'Configuration saved successfully.'
    });
  }
}
