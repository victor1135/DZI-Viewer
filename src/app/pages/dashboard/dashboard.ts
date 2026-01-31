import { Component, computed, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { CasesService } from '../../services/cases.service';
import { PathologyCase, FilterTab } from '../../models';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  // 搜尋和篩選
  searchQuery = signal('');
  activeFilter = signal('all');

  // 篩選標籤
  filterTabs: FilterTab[] = [
    { label: 'All', value: 'all' },
    { label: 'Pending', value: 'pending' },
    { label: 'In Progress', value: 'in_progress' },
    { label: 'Reviewed', value: 'reviewed' },
    { label: 'Completed', value: 'completed' }
  ];

  constructor(
    private router: Router,
    public authService: AuthService,
    public casesService: CasesService
  ) {}

  // 格式化日期
  get formattedDate(): string {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    };
    return now.toLocaleDateString('en-US', options);
  }

  // 統計數據
  readonly pendingCount = computed(() =>
    this.casesService.cases().filter(c => c.status === 'pending').length
  );

  readonly inProgressCount = computed(() =>
    this.casesService.cases().filter(c => c.status === 'in_progress').length
  );

  readonly reviewedCount = computed(() =>
    this.casesService.cases().filter(c => c.status === 'reviewed').length
  );

  readonly completedCount = computed(() =>
    this.casesService.cases().filter(c => c.status === 'completed').length
  );

  // 篩選後的案例
  readonly filteredCases = computed(() => {
    let cases = this.casesService.cases();

    // 狀態篩選
    if (this.activeFilter() !== 'all') {
      cases = cases.filter(c => c.status === this.activeFilter());
    }

    // 搜尋篩選
    const query = this.searchQuery().toLowerCase();
    if (query) {
      cases = cases.filter(c =>
        c.caseNumber.toLowerCase().includes(query) ||
        c.specimenType.toLowerCase().includes(query) ||
        c.sampleSite.toLowerCase().includes(query)
      );
    }

    return cases;
  });

  // 格式化狀態顯示
  formatStatus(status: string): string {
    return status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  // 格式化日期
  formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  // 開啟案例
  openCase(caseId: string): void {
    console.log('Opening case:', caseId);
    const caseItem = this.casesService.cases().find(c => c.id === caseId);
    if (!caseItem) {
      console.error('Case not found:', caseId);
      return;
    }
    if (caseItem.slides.length === 0) {
      alert('此案例沒有 slides，無法開啟查看器。');
      return;
    }
    this.router.navigate(['/viewer', caseId]);
  }

  // 刪除案例
  deleteCase(caseId: string, event: Event): void {
    event.stopPropagation(); // 阻止事件冒泡，避免觸發 openCase
    
    const caseItem = this.casesService.cases().find(c => c.id === caseId);
    if (caseItem) {
      const confirmed = confirm(`確定要刪除案例 ${caseItem.caseNumber} 嗎？\n此操作無法復原。`);
      if (confirmed) {
        this.casesService.deleteCase(caseId);
      }
    }
  }

  // 設定篩選
  setFilter(value: string): void {
    this.activeFilter.set(value);
  }

  // 更新搜尋
  onSearchChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchQuery.set(input.value);
  }
}
