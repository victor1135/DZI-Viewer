import { Injectable, signal, computed } from '@angular/core';

// ============================================================
// Memory Manager Service - 内存管理服务
// 实现 LRU 缓存策略和自动内存释放
// ============================================================

export interface MemoryStats {
  estimatedMemoryMB: number;
  tileCount: number;
  maxCacheSize: number;
  cacheUsagePercent: number;
  lastCleanup: Date | null;
}

@Injectable({
  providedIn: 'root'
})
export class MemoryManagerService {
  // 内存限制配置（MB）
  private readonly MAX_MEMORY_MB = 500; // 最大内存限制 500MB
  private readonly WARNING_THRESHOLD_MB = 400; // 警告阈值 400MB
  private readonly CLEANUP_THRESHOLD_MB = 450; // 自动清理阈值 450MB
  
  // Tile 缓存限制
  private readonly MAX_CACHE_TILES = 2000; // 最大缓存 tile 数量
  private readonly CLEANUP_TILES = 1500; // 清理后保留的 tile 数量
  
  // 状态
  private readonly _memoryStats = signal<MemoryStats>({
    estimatedMemoryMB: 0,
    tileCount: 0,
    maxCacheSize: this.MAX_CACHE_TILES,
    cacheUsagePercent: 0,
    lastCleanup: null
  });

  // 公开的只读状态
  readonly memoryStats = this._memoryStats.asReadonly();
  
  // 计算属性：是否超过警告阈值
  readonly isWarningThreshold = computed(() => 
    this._memoryStats().estimatedMemoryMB >= this.WARNING_THRESHOLD_MB
  );
  
  // 计算属性：是否超过清理阈值
  readonly needsCleanup = computed(() => 
    this._memoryStats().estimatedMemoryMB >= this.CLEANUP_THRESHOLD_MB ||
    this._memoryStats().tileCount >= this.MAX_CACHE_TILES
  );

  // OpenSeadragon viewer 引用
  private viewer: any = null;

  constructor() {
    // 定期检查内存使用情况
    this.startMemoryMonitoring();
  }

  /**
   * 设置 OpenSeadragon viewer 引用
   */
  setViewer(viewer: any): void {
    this.viewer = viewer;
    this.setupViewerMemoryLimits();
  }

  /**
   * 配置 OpenSeadragon 的内存限制
   */
  private setupViewerMemoryLimits(): void {
    if (!this.viewer) return;

    // 设置最大缓存 tile 数量
    if (this.viewer.world && this.viewer.world.getItemAt(0)) {
      const tiledImage = this.viewer.world.getItemAt(0);
      
      // 限制缓存大小
      if (tiledImage._tileCache) {
        tiledImage._tileCache.maxImageCacheCount = this.MAX_CACHE_TILES;
      }
    }

    // 监听 tile 加载事件，更新统计
    this.viewer.addHandler('tile-loaded', () => {
      this.updateMemoryStats();
    });

    this.viewer.addHandler('tile-drawn', () => {
      this.updateMemoryStats();
    });

    // 监听视口变化，触发清理
    this.viewer.addHandler('viewport-change', () => {
      if (this.needsCleanup()) {
        this.cleanupMemory();
      }
    });
  }

  /**
   * 更新内存统计
   */
  private updateMemoryStats(): void {
    if (!this.viewer) return;

    try {
      const tiledImage = this.viewer.world?.getItemAt(0);
      if (!tiledImage) return;

      // 计算当前 tile 数量
      let tileCount = 0;
      let estimatedMemoryMB = 0;

      // 遍历所有已加载的 tile
      if (tiledImage._tileCache && tiledImage._tileCache._images) {
        const cache = tiledImage._tileCache._images;
        tileCount = Object.keys(cache).length;

        // 估算内存使用（每个 tile 256x256x4 bytes = 262KB）
        // 实际压缩后的 JPEG 更小，但未压缩的像素数据更大
        const bytesPerTile = 256 * 256 * 4; // RGBA, 256x256
        estimatedMemoryMB = (tileCount * bytesPerTile) / (1024 * 1024);
      }

      // 更新统计
      this._memoryStats.update(stats => ({
        ...stats,
        estimatedMemoryMB: Math.round(estimatedMemoryMB * 100) / 100,
        tileCount,
        cacheUsagePercent: Math.round((tileCount / this.MAX_CACHE_TILES) * 100)
      }));

      // 如果超过阈值，触发清理
      if (this.needsCleanup()) {
        setTimeout(() => this.cleanupMemory(), 100);
      }
    } catch (error) {
      console.warn('Error updating memory stats:', error);
    }
  }

  /**
   * 清理内存 - LRU 策略
   */
  cleanupMemory(): void {
    if (!this.viewer) return;

    try {
      const tiledImage = this.viewer.world?.getItemAt(0);
      if (!tiledImage || !tiledImage._tileCache) return;

      const cache = tiledImage._tileCache;
      const currentTileCount = this._memoryStats().tileCount;

      // 如果 tile 数量超过限制，清理最旧的
      if (currentTileCount > this.CLEANUP_TILES) {
        const tilesToRemove = currentTileCount - this.CLEANUP_TILES;
        
        // 获取所有 tile 的访问时间
        const tiles: Array<{ key: string; lastAccess: number }> = [];
        
        if (cache._images) {
          Object.keys(cache._images).forEach(key => {
            const tile = cache._images[key];
            // 使用 tile 的加载时间或最后访问时间
            const lastAccess = tile._lastAccessTime || tile._loadTime || 0;
            tiles.push({ key, lastAccess });
          });
        }

        // 按访问时间排序，移除最旧的
        tiles.sort((a, b) => a.lastAccess - b.lastAccess);
        
        // 移除最旧的 tiles
        for (let i = 0; i < Math.min(tilesToRemove, tiles.length); i++) {
          const tileKey = tiles[i].key;
          if (cache._images && cache._images[tileKey]) {
            // 从缓存中移除
            delete cache._images[tileKey];
            
            // 如果 tile 有对应的 DOM 元素，也移除
            const tileElement = document.querySelector(`[data-tile-key="${tileKey}"]`);
            if (tileElement) {
              tileElement.remove();
            }
          }
        }

        // 强制垃圾回收提示（浏览器可能忽略）
        if ((window as any).gc) {
          (window as any).gc();
        }

        console.log(`Memory cleanup: Removed ${tilesToRemove} tiles`);
      }

      // 更新清理时间
      this._memoryStats.update(stats => ({
        ...stats,
        lastCleanup: new Date()
      }));

      // 重新计算统计
      this.updateMemoryStats();
    } catch (error) {
      console.error('Error during memory cleanup:', error);
    }
  }

  /**
   * 强制清理所有非可见区域的 tiles
   */
  forceCleanup(): void {
    if (!this.viewer) return;

    try {
      const tiledImage = this.viewer.world?.getItemAt(0);
      if (!tiledImage || !tiledImage._tileCache) return;

      const viewport = this.viewer.viewport;
      const bounds = viewport.getBounds();
      
      // 获取可见区域的 bounds
      const visibleBounds = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      };

      const cache = tiledImage._tileCache;
      let removedCount = 0;

      if (cache._images) {
        Object.keys(cache._images).forEach(key => {
          const tile = cache._images[key];
          
          // 检查 tile 是否在可见区域
          if (tile.bounds) {
            const tileBounds = tile.bounds;
            const isVisible = 
              tileBounds.x < visibleBounds.x + visibleBounds.width &&
              tileBounds.x + tileBounds.width > visibleBounds.x &&
              tileBounds.y < visibleBounds.y + visibleBounds.height &&
              tileBounds.y + tileBounds.height > visibleBounds.y;

            // 如果不在可见区域，移除
            if (!isVisible) {
              delete cache._images[key];
              removedCount++;
            }
          }
        });
      }

      console.log(`Force cleanup: Removed ${removedCount} non-visible tiles`);
      
      // 更新统计
      this.updateMemoryStats();
    } catch (error) {
      console.error('Error during force cleanup:', error);
    }
  }

  /**
   * 开始内存监控
   */
  private startMemoryMonitoring(): void {
    // 每 5 秒检查一次内存使用情况
    setInterval(() => {
      if (this.viewer) {
        this.updateMemoryStats();
        
        // 如果超过阈值，自动清理
        if (this.needsCleanup()) {
          this.cleanupMemory();
        }
      }
    }, 5000);
  }

  /**
   * 获取内存使用建议
   */
  getMemoryAdvice(): string {
    const stats = this._memoryStats();
    
    if (stats.estimatedMemoryMB >= this.CLEANUP_THRESHOLD_MB) {
      return '内存使用过高，建议清理缓存或缩小视图';
    } else if (stats.estimatedMemoryMB >= this.WARNING_THRESHOLD_MB) {
      return '内存使用较高，请注意';
    } else {
      return '内存使用正常';
    }
  }

  /**
   * 重置统计
   */
  reset(): void {
    this._memoryStats.set({
      estimatedMemoryMB: 0,
      tileCount: 0,
      maxCacheSize: this.MAX_CACHE_TILES,
      cacheUsagePercent: 0,
      lastCleanup: null
    });
  }
}
