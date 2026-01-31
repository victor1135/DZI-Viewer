import { Routes } from '@angular/router';

export const routes: Routes = [
  // Dashboard (首頁直接導向dashboard)
  {
    path: '',
    loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.Dashboard)
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.Dashboard)
  },
  // Upload
  {
    path: 'upload',
    loadComponent: () => import('./pages/upload/upload').then(m => m.Upload)
  },
  // Slide Viewer (含動態參數 caseId)
  {
    path: 'viewer/:caseId',
    loadComponent: () => import('./pages/slide-viewer/slide-viewer').then(m => m.SlideViewer)
  },
  // Settings
  {
    path: 'settings',
    loadComponent: () => import('./pages/settings/settings').then(m => m.Settings)
  }
];
