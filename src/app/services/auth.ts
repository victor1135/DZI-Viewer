import { computed, Injectable, signal } from '@angular/core';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'researcher' | 'pathologist' | 'admin';
  institution: string;
  avatar?: string;
}

  // 預設使用者
  const defaultUser: User = {
    id: 'usr_001',
    email: 'demo@ox.ac.uk',
    name: 'Dr. James Richardson',
    role: 'pathologist',
    institution: 'University of Oxford',
    avatar: 'https://api.dicebear.com/7.x/personas/svg?seed=james'
  };

@Injectable({
  providedIn: 'root',
})
export class Auth {
  private readonly _user = signal<User>(defaultUser);
  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => !!this.user());
  setUser(user: User): void {
    this._user.set(user);
  }
  updateUser(updates: Partial<User>): void {
    this._user.update(user => ({ ...user, ...updates }));
  }
  // 取得當前值（非響應式）
  getCurrentUser(): User {
    return this._user();  // signal 像函數一樣呼叫取得值
  }
}
