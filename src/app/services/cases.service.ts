import { Injectable, signal, computed } from '@angular/core';
import { PathologyCase, SlideImage } from '../models';

// ============================================================
// Cases Service - 案例管理服務 (對應 Vue 的 stores/cases.ts)
// ============================================================

@Injectable({
  providedIn: 'root'
})
export class CasesService {
  // 私有狀態
  private readonly _cases = signal<PathologyCase[]>([]);
  private readonly _currentCase = signal<PathologyCase | null>(null);
  private readonly _loading = signal<boolean>(false);

  // 公開的唯讀狀態
  readonly cases = this._cases.asReadonly();
  readonly currentCase = this._currentCase.asReadonly();
  readonly loading = this._loading.asReadonly();

  private readonly STORAGE_KEY = 'pathology_cases';

  constructor() {
    // 從 localStorage 載入資料
    this.loadFromStorage();
  }

  // 從 localStorage 載入資料
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const cases = JSON.parse(stored) as PathologyCase[];
        this._cases.set(cases);
      }
    } catch (error) {
      console.error('Failed to load cases from storage:', error);
    }
  }

  // 儲存到 localStorage
  private saveToStorage(): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this._cases()));
    } catch (error) {
      console.error('Failed to save cases to storage:', error);
    }
  }

  // 生成 Case Number
  private generateCaseNumber(): string {
    const year = new Date().getFullYear();
    const num = String(this._cases().length + 145).padStart(4, '0');
    return `OX-${year}-${num}`;
  }

  // 創建新 Case
  createCase(caseData: {
    patientId?: string;
    specimenType?: string;
    sampleSite?: string;
    clinicalHistory?: string;
  }): PathologyCase {
    const newCase: PathologyCase = {
      id: `case_${Date.now()}`,
      caseNumber: this.generateCaseNumber(),
      patientId: caseData.patientId || 'N/A',
      specimenType: caseData.specimenType || 'Tissue Biopsy',
      sampleSite: caseData.sampleSite || 'Unspecified',
      clinicalHistory: caseData.clinicalHistory || '',
      status: 'pending',
      slides: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this._cases.update(cases => [newCase, ...cases]);
    this.saveToStorage();
    return newCase;
  }

  // 添加 Slide 到 Case
  addSlideToCase(caseId: string, slide: SlideImage): void {
    this._cases.update(cases =>
      cases.map(c => {
        if (c.id === caseId) {
          return {
            ...c,
            slides: [...c.slides, slide],
            updatedAt: new Date().toISOString()
          };
        }
        return c;
      })
    );
    this.saveToStorage();
  }

  // 載入指定 Case
  loadCase(caseId: string): void {
    const found = this._cases().find(c => c.id === caseId) || null;
    this._currentCase.set(found);
  }

  // 更新 Case 狀態
  updateCaseStatus(caseId: string, status: PathologyCase['status']): void {
    this._cases.update(cases =>
      cases.map(c => {
        if (c.id === caseId) {
          return {
            ...c,
            status,
            updatedAt: new Date().toISOString()
          };
        }
        return c;
      })
    );
    this.saveToStorage();
  }

  // 儲存診斷
  saveDiagnosis(caseId: string, diagnosis: string, notes?: string): void {
    this._cases.update(cases =>
      cases.map(c => {
        if (c.id === caseId) {
          return {
            ...c,
            diagnosis,
            notes,
            status: 'reviewed' as const,
            updatedAt: new Date().toISOString()
          };
        }
        return c;
      })
    );

    // 同步更新 currentCase
    if (this._currentCase()?.id === caseId) {
      this._currentCase.update(current => {
        if (current) {
          return { ...current, diagnosis, notes, status: 'reviewed' as const };
        }
        return current;
      });
    }
    this.saveToStorage();
  }

  // 刪除 Case
  deleteCase(caseId: string): void {
    this._cases.update(cases => cases.filter(c => c.id !== caseId));
    
    // 如果刪除的是當前正在查看的 case，清除 currentCase
    if (this._currentCase()?.id === caseId) {
      this._currentCase.set(null);
    }
    
    this.saveToStorage();
  }

  // 清除所有資料
  resetData(): void {
    this._cases.set([]);
    this._currentCase.set(null);
    this.saveToStorage();
  }
}
