// ============================================================
// Models - 資料模型定義 (從 Vue Pinia Store 轉換)
// ============================================================

// User 使用者模型
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'researcher' | 'pathologist' | 'admin';
  institution: string;
  avatar?: string;
}

// SlideImage 玻片影像模型
export interface SlideImage {
  id: string;
  name: string;
  stainType: string;
  thumbnailUrl: string;
  dziUrl: string;
  mpp: number;  // microns per pixel
  width: number;
  height: number;
  uploadedAt: string;
}

// PathologyCase 病理案例模型
export interface PathologyCase {
  id: string;
  caseNumber: string;
  patientId: string;
  specimenType: string;
  sampleSite: string;
  clinicalHistory: string;
  status: 'pending' | 'in_progress' | 'reviewed' | 'completed';
  slides: SlideImage[];
  diagnosis?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  assignedTo?: string;
}

// Cloud Storage 雲端儲存配置
export interface OSSConfig {
  region: string;
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
}

export interface S3Config {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  isPublic?: boolean;
}

export type CloudProvider = 'oss' | 's3';

// Upload 上傳相關
export interface UploadFile {
  file: File;
  name: string;
  size: number;
  progress: number;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error';
  url?: string;
  dziUrl?: string;
  thumbnailUrl?: string;
  jobId?: string;
  error?: string;
}

// Feature 首頁功能卡片
export interface Feature {
  icon: string;
  title: string;
  description: string;
}

// Filter Tab
export interface FilterTab {
  label: string;
  value: string;
}
