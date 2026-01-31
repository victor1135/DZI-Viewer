import { Injectable, signal } from '@angular/core';

export interface SlideImage {
  id: string
  name: string
  stainType: string
  thumbnailUrl: string
  dziUrl: string
  mpp: number  // microns per pixel
  width: number
  height: number
  uploadedAt: string
}

export interface PathologyCase {
  id: string
  caseNumber: string
  patientId: string
  specimenType: string
  sampleSite: string
  clinicalHistory: string
  status: 'pending' | 'in_progress' | 'reviewed' | 'completed'
  slides: SlideImage[]
  diagnosis?: string
  notes?: string
  createdAt: string
  updatedAt: string
  assignedTo?: string
}

@Injectable({
  providedIn: 'root',
})
export class Cases {
  private readonly _cases = signal<PathologyCase[]>([]);
  readonly currentCase = signal<PathologyCase | null>(null);
  readonly loading = signal<boolean>(false);

  private _generateCaseNumber(): string {
    const year = new Date().getFullYear()
    const num = String(this._cases().length + 145).padStart(4, '0')
    return `OX-${year}-${num}`    
  }

  createCase(caseData: Partial<PathologyCase>): PathologyCase {
    const newCase: PathologyCase = {
      id: `case_${Date.now()}`,
      caseNumber: this._generateCaseNumber(),
      patientId: caseData.patientId || '',
      specimenType: caseData.specimenType || '',
      sampleSite: caseData.sampleSite || '',
      clinicalHistory: caseData.clinicalHistory || '',
      status: 'pending',
      slides: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    this._cases.update(x => [newCase, ...x]);
    return newCase;
  }

  addSlideToCase(caseId: string, slideData: SlideImage) {
    const caseItem = this._cases().find(c => c.id === caseId);
    if (caseItem) {
      caseItem.slides.push(slideData);
      caseItem.updatedAt = new Date().toISOString();
    }
  }
}
