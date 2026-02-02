import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  ViewChild,
  ElementRef,
  AfterViewInit
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CasesService } from '../../services/cases.service';
import { MemoryManagerService } from '../../services/memory-manager.service';
import { SlideImage, PathologyCase } from '../../models';

// OpenSeadragon 類型宣告
declare const OpenSeadragon: any;

@Component({
  selector: 'app-slide-viewer',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './slide-viewer.html',
  styleUrl: './slide-viewer.scss',
})
export class SlideViewer implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('viewerContainer') viewerContainer!: ElementRef<HTMLDivElement>;

  // 狀態
  private viewer: any = null;
  private mouseTracker: any = null;
  currentSlide = signal<SlideImage | null>(null);
  activeTool = signal<'pan' | 'measure' | 'annotate'>('pan');
  activeTab = signal<'case' | 'diagnosis' | 'performance'>('case');
  currentZoom = signal('1.0');
  rotation = signal(0);
  diagnosisInput = signal('');
  notesInput = signal('');

  // 滑鼠座標
  mouseCoords = signal({ x: 0, y: 0 });
  scaleBarWidth = signal(100);
  scaleBarLabel = signal('100 μm');

  // 畫圓標註相關
  private isDrawing = false;
  private drawStartPoint: { x: number; y: number } | null = null;
  private currentCircleElement: HTMLDivElement | null = null;
  private currentTextElement: HTMLDivElement | null = null;
  private currentCircleData: { centerX: number; centerY: number; radius: number } | null = null;
  private annotations: Array<{
    id: string;
    centerX: number;
    centerY: number;
    radius: number;
    diameter: number;
    circleElement: HTMLDivElement;
    textElement: HTMLDivElement | null;
  }> = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    public casesService: CasesService,
    private memoryManager: MemoryManagerService
  ) {}

  // 當前案例
  readonly currentCase = computed(() => this.casesService.currentCase());

  ngOnInit(): void {
    const caseId = this.route.snapshot.paramMap.get('caseId');
    if (caseId) {
      this.casesService.loadCase(caseId);
    }
  }

  ngAfterViewInit(): void {
    // 等待案例載入後初始化第一張 slide
    setTimeout(() => {
      const currentCase = this.currentCase();
      if (currentCase && currentCase.slides.length > 0) {
        this.selectSlide(currentCase.slides[0]);
      }
    }, 100);
  }

  ngOnDestroy(): void {
    // 清除所有標註
    this.clearAllAnnotations();
    
    // 清除滑鼠追蹤器
    if (this.mouseTracker) {
      this.mouseTracker.destroy();
      this.mouseTracker = null;
    }
    
    // 清理内存
    this.memoryManager.forceCleanup();
    this.memoryManager.reset();
    
    if (this.viewer) {
      this.viewer.destroy();
      this.viewer = null;
    }
  }

  // 初始化 OpenSeadragon Viewer
  async initViewer(dziUrl: string): Promise<void> {
    if (this.viewer) {
      this.viewer.destroy();
      this.viewer = null;
    }

    // 等待 DOM 準備好
    await new Promise(resolve => setTimeout(resolve, 50));

    // 調試：顯示 DZI URL
    console.log('Loading DZI from:', dziUrl);
    
    // 確保 DZI URL 以 .dzi 結尾
    if (!dziUrl.endsWith('.dzi')) {
      console.warn('DZI URL does not end with .dzi:', dziUrl);
      // 如果 URL 不包含 .dzi，嘗試添加
      if (!dziUrl.includes('.dzi')) {
        dziUrl = dziUrl.endsWith('/') ? dziUrl + 'file_example_TIFF_10MB.dzi' : dziUrl + '.dzi';
        console.log('Adjusted DZI URL:', dziUrl);
      }
    }

    const navigatorElement = document.getElementById('navigator-container');

    // 檢查 DZI XML 是否缺少 MaxLevel，如果缺少則檢測實際存在的最大 level
    // 注意：OpenSeadragon 會自動從 XML 讀取配置，如果 XML 缺少 MaxLevel，
    // 它會根據圖片尺寸計算，可能導致請求不存在的 level
    // 我們在 tile-load-failed 事件中處理這種情況

    this.viewer = OpenSeadragon({
      id: 'openseadragon-viewer',
      prefixUrl: 'https://cdnjs.cloudflare.com/ajax/libs/openseadragon/4.0.0/images/',
      tileSources: dziUrl,
      showNavigator: !!navigatorElement,
      navigatorId: navigatorElement ? 'navigator-container' : undefined,
      navigatorPosition: 'ABSOLUTE',
      navigatorAutoResize: false,
      showRotationControl: false,
      showFullPageControl: false,
      showHomeControl: false,
      showZoomControl: false,
      gestureSettingsMouse: {
        clickToZoom: false,
        dblClickToZoom: true,
        dragToPan: true
      },
      animationTime: 0.3,
      minZoomLevel: 0.5,
      maxZoomLevel: 40,
      visibilityRatio: 0.5,
      constrainDuringPan: true,
      // 内存优化配置
      maxImageCacheCount: 2000, // 最大缓存 tile 数量
      imageLoaderLimit: 6, // 并发加载限制
      maxPixelRatio: 2, // 限制高 DPI 屏幕的像素比
      timeout: 30000, // 30 秒超时
      loadTilesWithAjax: false, // 使用标准图片加载
      ajaxWithCredentials: false
    });

    // 追蹤縮放級別
    this.viewer.addHandler('zoom', (e: any) => {
      this.currentZoom.set(e.zoom.toFixed(1));
      // 延遲更新比例尺，確保 viewport 已更新
      setTimeout(() => this.updateScaleBar(), 10);
    });

    // 追蹤視圖變化
    this.viewer.addHandler('pan', () => {
      this.updateScaleBar();
    });

    // 追蹤視圖大小變化
    this.viewer.addHandler('resize', () => {
      this.updateScaleBar();
    });

    // 設置滑鼠追蹤和畫圓功能
    // 使用延遲確保 viewer 完全初始化
    setTimeout(() => {
      this.setupMouseTracker();
    }, 200);

    // 添加錯誤處理
    this.viewer.addHandler('tile-load-failed', (event: any) => {
      const tileUrl = event.tile?.url || '';
      // 檢查是否是請求不存在的 level（例如 level 8 但只有 0-3）
      const levelMatch = tileUrl.match(/_files\/(\d+)\//);
      if (levelMatch) {
        const requestedLevel = parseInt(levelMatch[1]);
        // 如果請求的 level 大於 3，可能是因為 XML 缺少 MaxLevel
        if (requestedLevel > 3) {
          console.warn(`Tile level ${requestedLevel} does not exist (only 0-3 available). This is likely due to missing MaxLevel in DZI XML.`);
          // 靜默處理，不顯示錯誤
          return;
        }
      }
      console.error('Tile load failed:', event);
      console.error('Failed tile URL:', tileUrl);
    });

    this.viewer.addHandler('open-failed', (event: any) => {
      console.error('Failed to open DZI:', event);
      console.error('DZI URL:', dziUrl);
      alert('Failed to load slide image. Please check the DZI file URL and ensure it is accessible.');
    });

    this.viewer.addHandler('open', (event: any) => {
      console.log('DZI opened successfully');
      console.log('Tile source info:', event.source);
      // 延遲更新比例尺，確保所有尺寸都已計算完成
      setTimeout(() => this.updateScaleBar(), 100);
      // 設置滑鼠追蹤
      setTimeout(() => this.setupMouseTracker(), 100);
    });

    // 當圖片完全載入後更新比例尺
    this.viewer.addHandler('tile-drawn', () => {
      // 只在第一次 tile 繪製時更新，避免過於頻繁
      if (!this.scaleBarWidth() || this.scaleBarWidth() === 100) {
        setTimeout(() => this.updateScaleBar(), 50);
      }
    });

    // 设置内存管理器
    this.memoryManager.setViewer(this.viewer);

    // 监听视口变化，定期清理内存
    this.viewer.addHandler('viewport-change', () => {
      // 延迟清理，避免频繁触发
      setTimeout(() => {
        if (this.memoryManager.needsCleanup()) {
          this.memoryManager.cleanupMemory();
        }
      }, 1000);
    });
  }

  // 設置滑鼠追蹤器
  private setupMouseTracker(): void {
    if (!this.viewer || !this.viewer.canvas) {
      console.warn('Cannot setup mouse tracker: viewer or canvas not available');
      console.log('Viewer:', this.viewer);
      if (this.viewer) {
        console.log('Viewer properties:', Object.keys(this.viewer));
        console.log('Viewer.canvas:', this.viewer.canvas);
      }
      return;
    }

    // 使用 viewer.canvas 而非 container
    const element = this.viewer.canvas;
    console.log('Setting up mouse tracker on canvas:', element);

    // 如果已經存在，先清除
    if (this.mouseTracker) {
      try {
        this.mouseTracker.destroy();
      } catch (e) {
        console.warn('Error destroying existing mouse tracker:', e);
      }
      this.mouseTracker = null;
    }

    // 測試原生事件是否觸發
    element.addEventListener('mousedown', (e: MouseEvent) => {
      console.log('Native mousedown on canvas, activeTool:', this.activeTool());
    }, { once: true });

    try {
      this.mouseTracker = new OpenSeadragon.MouseTracker({
        element: element,
        userData: 'measureTracker',
        moveHandler: (e: any) => {
          const slide = this.currentSlide();
          if (slide && this.viewer) {
            const webPoint = e.position;
            const viewportPoint = this.viewer.viewport.pointFromPixel(webPoint);
            const imagePoint = this.viewer.viewport.viewportToImageCoordinates(viewportPoint);

            this.mouseCoords.set({
              x: imagePoint.x * slide.mpp,
              y: imagePoint.y * slide.mpp
            });

            // 如果正在畫圓，更新圓的大小
            if (this.activeTool() === 'measure' && this.isDrawing && this.drawStartPoint) {
              this.updateCircle(imagePoint);
            }
          }
        },
        pressHandler: (e: any) => {
          console.log('pressHandler triggered, activeTool:', this.activeTool());
          if (this.activeTool() === 'measure' && this.viewer) {
            console.log('Mouse pressed in measure mode');
            // 必須在這裡阻止事件傳播
            e.preventDefaultAction = true;
            if (e.stopPropagation) {
              e.stopPropagation();
            }
            
            const webPoint = e.position;
            console.log('Web point:', webPoint);
            const viewportPoint = this.viewer.viewport.pointFromPixel(webPoint);
            console.log('Viewport point:', viewportPoint);
            const imagePoint = this.viewer.viewport.viewportToImageCoordinates(viewportPoint);
            console.log('Image point:', imagePoint);
            this.startDrawing(imagePoint);
            return false; // 回傳 false 阻止後續處理
          }
          return true; // 其他情況允許繼續處理
        },
        releaseHandler: (e: any) => {
          if (this.activeTool() === 'measure' && this.isDrawing) {
            console.log('Mouse released in measure mode');
            e.preventDefaultAction = true;
            this.finishDrawing();
          }
        },
        clickHandler: (e: any) => {
          // 在測量模式下阻止點擊縮放
          if (this.activeTool() === 'measure') {
            e.preventDefaultAction = true;
          }
        }
      });
      
      // 確保我們的 tracker 優先處理
      this.mouseTracker.setTracking(true);
      console.log('Mouse tracker setup complete', this.mouseTracker);
      console.log('Mouse tracker tracking:', this.mouseTracker.getTracking());
    } catch (error) {
      console.error('Error setting up mouse tracker:', error);
      // 如果 MouseTracker 失敗，使用原生 DOM 事件作為備用
      console.log('Falling back to native DOM events');
      this.setupNativeMouseEvents(element);
    }
  }

  // 使用原生 DOM 事件作為備用方案
  private setupNativeMouseEvents(element: HTMLElement): void {
    const handleMouseDown = (e: MouseEvent) => {
      if (this.activeTool() === 'measure' && this.viewer) {
        console.log('Native mouse down in measure mode');
        e.preventDefault();
        e.stopPropagation();
        
        const rect = element.getBoundingClientRect();
        const webPoint = new OpenSeadragon.Point(
          e.clientX - rect.left,
          e.clientY - rect.top
        );
        const viewportPoint = this.viewer.viewport.pointFromPixel(webPoint);
        const imagePoint = this.viewer.viewport.viewportToImageCoordinates(viewportPoint);
        console.log('Image point from native event:', imagePoint);
        this.startDrawing(imagePoint);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const slide = this.currentSlide();
      if (slide && this.viewer) {
        const rect = element.getBoundingClientRect();
        const webPoint = new OpenSeadragon.Point(
          e.clientX - rect.left,
          e.clientY - rect.top
        );
        const viewportPoint = this.viewer.viewport.pointFromPixel(webPoint);
        const imagePoint = this.viewer.viewport.viewportToImageCoordinates(viewportPoint);

        this.mouseCoords.set({
          x: imagePoint.x * slide.mpp,
          y: imagePoint.y * slide.mpp
        });

        if (this.activeTool() === 'measure' && this.isDrawing && this.drawStartPoint) {
          this.updateCircle(imagePoint);
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (this.activeTool() === 'measure' && this.isDrawing) {
        console.log('Native mouse up in measure mode');
        e.preventDefault();
        e.stopPropagation();
        this.finishDrawing();
      }
    };

    element.addEventListener('mousedown', handleMouseDown);
    element.addEventListener('mousemove', handleMouseMove);
    element.addEventListener('mouseup', handleMouseUp);
    
    console.log('Native mouse events attached to element');
  }

  // 更新比例尺
  updateScaleBar(): void {
    const slide = this.currentSlide();
    if (!this.viewer || !slide) {
      console.log('Scale bar update skipped: viewer or slide not available');
      return;
    }

    try {
      const zoom = this.viewer.viewport.getZoom(true);
      const containerSize = this.viewer.viewport.getContainerSize();
      const containerWidth = containerSize.x;
      
      if (!containerWidth || containerWidth === 0) {
        console.log('Scale bar update skipped: container width is 0');
        return;
      }

      const worldItem = this.viewer.world.getItemAt(0);
      if (!worldItem) {
        console.log('Scale bar update skipped: world item not available');
        return;
      }

      const imageSize = worldItem.getContentSize();
      const imageWidth = imageSize.x;
      
      if (!imageWidth || imageWidth === 0) {
        console.log('Scale bar update skipped: image width is 0');
        return;
      }

      // 計算：在當前縮放級別下，1 微米對應多少像素
      // imageWidth (像素) / slide.mpp (微米/像素) = 圖片寬度（微米）
      // containerWidth * zoom = 當前視圖中顯示的圖片寬度（像素）
      // 所以：pixelsPerMicron = (containerWidth * zoom) / (imageWidth / slide.mpp)
      const imageWidthInMicrons = imageWidth / slide.mpp;
      const pixelsPerMicron = (containerWidth * zoom) / imageWidthInMicrons;

      console.log('Scale bar calculation:', {
        zoom,
        containerWidth,
        imageWidth,
        imageWidthInMicrons,
        pixelsPerMicron,
        mpp: slide.mpp
      });

      const targetWidths = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
      let bestWidth = 100;
      let bestLabel = '100 μm';

      for (const target of targetWidths) {
        const barWidth = target * pixelsPerMicron;
        if (barWidth >= 50 && barWidth <= 200) {
          bestWidth = barWidth;
          bestLabel = target >= 1000 ? `${target / 1000} mm` : `${target} μm`;
          break;
        }
      }

      // 如果沒有找到合適的寬度，使用最接近的
      if (bestWidth === 100 && pixelsPerMicron > 0) {
        const defaultTarget = 100;
        bestWidth = defaultTarget * pixelsPerMicron;
        bestLabel = `${defaultTarget} μm`;
      }

      this.scaleBarWidth.set(Math.max(10, Math.min(300, bestWidth))); // 限制在 10-300px 之間
      this.scaleBarLabel.set(bestLabel);
      
      console.log('Scale bar updated:', {
        width: this.scaleBarWidth(),
        label: this.scaleBarLabel()
      });
    } catch (error) {
      console.error('Error updating scale bar:', error);
    }
  }

  // 選擇 Slide
  async selectSlide(slide: SlideImage): Promise<void> {
    this.currentSlide.set(slide);
    console.log('Selected slide:', slide);
    console.log('Slide DZI URL:', slide.dziUrl);
    await this.initViewer(slide.dziUrl);
  }

  // 設定工具
  setTool(tool: 'pan' | 'measure' | 'annotate'): void {
    // 如果切換工具，取消當前的畫圓操作
    if (this.isDrawing) {
      this.cancelDrawing();
    }
    
    // 根據工具切換，更新 OpenSeadragon 的滑鼠導航
    if (this.viewer) {
      if (tool === 'measure') {
        // 測量模式下完全禁用滑鼠導航，以便畫圓
        this.viewer.setMouseNavEnabled(false);
        console.log('Mouse navigation disabled for measure mode');
      } else {
        // 其他模式恢復滑鼠導航
        this.viewer.setMouseNavEnabled(true);
        console.log('Mouse navigation enabled for', tool, 'mode');
      }
    }
    
    this.activeTool.set(tool);
  }

  // 開始畫圓
  private startDrawing(imagePoint: { x: number; y: number }): void {
    if (!this.viewer) return;
    
    this.isDrawing = true;
    this.drawStartPoint = imagePoint;
    console.log('Start drawing circle at:', imagePoint);
  }

  // 更新圓的大小
  private updateCircle(currentPoint: { x: number; y: number }): void {
    if (!this.viewer || !this.drawStartPoint) return;

    // 清除之前的臨時圓 - 使用 element 移除
    if (this.currentCircleElement) {
      try {
        this.viewer.removeOverlay(this.currentCircleElement);
      } catch (e) {
        console.warn('Error removing circle overlay:', e);
      }
      this.currentCircleElement = null;
    }
    if (this.currentTextElement) {
      try {
        this.viewer.removeOverlay(this.currentTextElement);
      } catch (e) {
        console.warn('Error removing text overlay:', e);
      }
      this.currentTextElement = null;
    }

    // 計算圓心和半徑（圖像座標）
    const centerX = (this.drawStartPoint.x + currentPoint.x) / 2;
    const centerY = (this.drawStartPoint.y + currentPoint.y) / 2;
    const dx = currentPoint.x - this.drawStartPoint.x;
    const dy = currentPoint.y - this.drawStartPoint.y;
    const radiusInImagePixels = Math.sqrt(dx * dx + dy * dy) / 2;

    // 保存圓的數據
    this.currentCircleData = { centerX, centerY, radius: radiusInImagePixels };

    // 將圖像座標轉換為 viewport 座標
    const centerViewport = this.viewer.viewport.imageToViewportCoordinates(
      new OpenSeadragon.Point(centerX, centerY)
    );
    
    // 計算 viewport 座標中的半徑
    const edgePoint = this.viewer.viewport.imageToViewportCoordinates(
      new OpenSeadragon.Point(centerX + radiusInImagePixels, centerY)
    );
    const radiusViewport = edgePoint.x - centerViewport.x;

    // 創建圓形元素
    const circleDiv = document.createElement('div');
    circleDiv.className = 'measure-circle-overlay';
    circleDiv.style.cssText = `
      border: 3px solid #00ff00;
      border-radius: 50%;
      box-shadow: 0 0 8px rgba(0,255,0,0.8);
      background-color: rgba(0,255,0,0.1);
      pointer-events: none;
      box-sizing: border-box;
    `;

    // 使用 OpenSeadragon.Rect 定義 overlay 位置和大小（viewport 座標）
    this.viewer.addOverlay({
      element: circleDiv,
      location: new OpenSeadragon.Rect(
        centerViewport.x - radiusViewport,
        centerViewport.y - radiusViewport,
        radiusViewport * 2,
        radiusViewport * 2
      )
    });

    this.currentCircleElement = circleDiv;

    // 計算直徑（微米）並顯示文字
    const slide = this.currentSlide();
    if (slide) {
      const diameterInPixels = radiusInImagePixels * 2;
      const diameterInMicrons = diameterInPixels * slide.mpp;
      const diameterInMm = diameterInMicrons / 1000;

      const textDiv = document.createElement('div');
      textDiv.className = 'measure-text-overlay';
      textDiv.style.cssText = `
        color: #00ff00;
        font-size: 14px;
        font-weight: bold;
        text-shadow: 0 0 4px rgba(0,0,0,0.8);
        white-space: nowrap;
        background-color: rgba(0,0,0,0.7);
        padding: 4px 8px;
        border-radius: 4px;
        pointer-events: none;
      `;

      textDiv.textContent = diameterInMm >= 1
        ? `⌀ ${diameterInMm.toFixed(2)} mm`
        : `⌀ ${diameterInMicrons.toFixed(0)} μm`;

      // 文字位置在圓的上方
      const textViewportY = centerViewport.y - radiusViewport - 0.02; // 稍微上移

      this.viewer.addOverlay({
        element: textDiv,
        location: new OpenSeadragon.Point(centerViewport.x, textViewportY),
        placement: OpenSeadragon.Placement.BOTTOM // 文字底部對齊到指定點
      });

      this.currentTextElement = textDiv;
    }

    console.log('Circle updated:', {
      centerViewport,
      radiusViewport,
      radiusInImagePixels
    });
  }

  // 完成畫圓
  private finishDrawing(): void {
    if (!this.viewer || !this.drawStartPoint || !this.currentCircleElement || !this.currentCircleData) {
      this.cancelDrawing();
      return;
    }

    const { centerX, centerY, radius } = this.currentCircleData;
    const slide = this.currentSlide();
    
    if (!slide) {
      this.cancelDrawing();
      return;
    }

    const diameterInMicrons = radius * 2 * slide.mpp;

    // 保存標註 - 使用 element 參考
    const annotation = {
      id: `annotation_${Date.now()}`,
      centerX,
      centerY,
      radius,
      diameter: diameterInMicrons,
      circleElement: this.currentCircleElement,
      textElement: this.currentTextElement
    };

    this.annotations.push(annotation);

    // 重置狀態（不清除 element，因為要保留顯示）
    this.isDrawing = false;
    this.drawStartPoint = null;
    this.currentCircleElement = null;
    this.currentTextElement = null;
    this.currentCircleData = null;

    console.log('Circle annotation saved:', annotation);
  }

  // 取消畫圓
  private cancelDrawing(): void {
    if (this.currentCircleElement && this.viewer) {
      try {
        this.viewer.removeOverlay(this.currentCircleElement);
      } catch (e) {
        console.warn('Error removing circle overlay:', e);
      }
    }
    if (this.currentTextElement && this.viewer) {
      try {
        this.viewer.removeOverlay(this.currentTextElement);
      } catch (e) {
        console.warn('Error removing text overlay:', e);
      }
    }

    this.isDrawing = false;
    this.drawStartPoint = null;
    this.currentCircleElement = null;
    this.currentTextElement = null;
    this.currentCircleData = null;
  }

  // 清除所有標註
  clearAllAnnotations(): void {
    if (!this.viewer) return;

    this.annotations.forEach(annotation => {
      try {
        if (annotation.circleElement) {
          this.viewer.removeOverlay(annotation.circleElement);
        }
        if (annotation.textElement) {
          this.viewer.removeOverlay(annotation.textElement);
        }
      } catch (e) {
        console.warn('Error removing annotation:', e);
      }
    });

    this.annotations = [];
    this.cancelDrawing();
  }

  // 放大
  zoomIn(): void {
    if (this.viewer) {
      this.viewer.viewport.zoomBy(1.5);
      this.viewer.viewport.applyConstraints();
    }
  }

  // 縮小
  zoomOut(): void {
    if (this.viewer) {
      this.viewer.viewport.zoomBy(0.667);
      this.viewer.viewport.applyConstraints();
    }
  }

  // 重設視圖
  resetView(): void {
    if (this.viewer) {
      this.viewer.viewport.goHome();
    }
  }

  // 左旋轉
  rotateLeft(): void {
    this.rotation.update(r => r - 90);
    if (this.viewer) {
      this.viewer.viewport.setRotation(this.rotation());
    }
  }

  // 右旋轉
  rotateRight(): void {
    this.rotation.update(r => r + 90);
    if (this.viewer) {
      this.viewer.viewport.setRotation(this.rotation());
    }
  }

  // 返回
  goBack(): void {
    this.router.navigate(['/dashboard']);
  }

  // 清理内存
  cleanupMemory(): void {
    this.memoryManager.cleanupMemory();
  }

  // 强制清理内存
  forceCleanupMemory(): void {
    this.memoryManager.forceCleanup();
  }

  // 获取内存统计（用于模板）
  get memoryStats() {
    return this.memoryManager.memoryStats();
  }

  // 获取内存建议
  get memoryAdvice() {
    return this.memoryManager.getMemoryAdvice();
  }

  // 是否显示内存警告
  get showMemoryWarning() {
    return this.memoryManager.isWarningThreshold();
  }

  // 格式化清理时间
  formatCleanupTime(date: Date | null): string {
    if (!date) return 'Never';
    const d = new Date(date);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // 儲存診斷
  saveDiagnosis(): void {
    const currentCase = this.currentCase();
    if (currentCase && this.diagnosisInput()) {
      this.casesService.saveDiagnosis(
        currentCase.id,
        this.diagnosisInput(),
        this.notesInput()
      );
      this.activeTab.set('diagnosis');
    }
  }

  // 設定 Tab
  setTab(tab: 'case' | 'diagnosis' | 'performance'): void {
    this.activeTab.set(tab);
  }
}
