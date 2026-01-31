import { Injectable, signal, computed } from '@angular/core';
import { User } from '../models';

// ============================================================
// Auth Service - 認證服務 (對應 Vue 的 stores/auth.ts)
// ============================================================

// 預設 Demo 使用者
const defaultUser: User = {
  id: 'usr_001',
  email: 'demo@ox.ac.uk',
  name: 'Dr. James Richardson',
  role: 'pathologist',
  institution: 'University of Oxford - Department of Pathology',
  avatar: 'https://api.dicebear.com/7.x/personas/svg?seed=james'
};

@Injectable({
  providedIn: 'root'  // 全域單例服務
})
export class AuthService {
  // 私有狀態 (使用 signal)
  private readonly _user = signal<User>(defaultUser);

  // 公開的唯讀狀態
  readonly user = this._user.asReadonly();

  // 計算屬性：是否已認證
  readonly isAuthenticated = computed(() => true);  // Demo 模式，永遠為 true

  // 取得當前使用者
  getUser(): User {
    return this._user();
  }

  // 設定使用者
  setUser(user: User): void {
    this._user.set(user);
  }

  // 更新使用者部分資訊
  updateUser(partial: Partial<User>): void {
    this._user.update(current => ({
      ...current,
      ...partial
    }));
  }

  // 登出
  logout(): void {
    this._user.set(defaultUser);
  }
}
