/**
 * 右侧检查舱动效与文件下载控制器（Inspector Controller）
 *
 * 【设计意图 (Why)】
 *   将检查舱的宽度折叠动效（attachMotionController）、退场安全收敛至 display:none、
 *   实例防泄漏 detach() 机制，以及工具栏文件另存为逻辑（原生 SaveDialog 与 Web Blob 降级）
 *   从 `renderer/index.ts` 中完全解耦。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 每次重新绑定动效控制器必须先调用前序实例的 `detach()`，防止高频重绘导致事件泄漏；
 *   2. 文件下载必须区分桌面端原生通道（支持大文件二进制流式写入）与浏览器/沙箱 Blob 模拟下载；
 *   3. 远程未下载文件必须正确拼接 `${gatewayUrl}/api/files/download?path=...`，不可静默写空。
 *
 * 【约束与规则 (Rules)】
 *   1. 纯 TypeScript 控制器，所有副作用通过 `InspectorControllerDeps` 注入；
 *   2. 严禁 `as any`，入参严格防御。
 */

import { attachMotionController, type I18nKey } from '@hermes-flux/ui';

export interface InspectorFileItem {
  path: string;
  content: string;
}

export interface InspectorControllerDeps {
  readonly getActiveFile: () => InspectorFileItem | undefined;
  readonly getGatewayUrl: () => string;
  readonly getDesktopApi?: () => {
    saveFile?: (options: { fileName: string; content: string; isBase64: boolean }) => Promise<{ success?: boolean; canceled?: boolean }>;
  } | undefined;
  readonly t: (key: I18nKey, params?: Record<string, string | number>) => string;
}

export class InspectorController {
  private motionController: ReturnType<typeof attachMotionController> | null = null;

  constructor(private readonly deps: InspectorControllerDeps) {}

  public getMotionController(): ReturnType<typeof attachMotionController> | null {
    return this.motionController;
  }

  /**
   * 统一构造并管理 InspectionPod 的动效控制器。
   */
  public bindMotion(el: HTMLElement): ReturnType<typeof attachMotionController> {
    if (this.motionController) {
      this.motionController.detach();
    }
    const controller = attachMotionController(el, {
      triggerProperty: 'width',
      onExited: () => {
        el.style.display = 'none';
        el.classList.add('inspector-collapsed');
      },
    });
    this.motionController = controller;
    return controller;
  }

  /**
   * 绑定工具栏文件下载 / 另存为。
   */
  public async handleDownload(btnDownload: HTMLElement): Promise<void> {
    const activeFile = this.deps.getActiveFile();
    if (!activeFile) return;

    const rawFileName = activeFile.path.split(/[/\\]/).pop() || 'download.txt';
    const isDataUrl = activeFile.content.startsWith('data:');
    const isHttp = activeFile.path.startsWith('http://') || activeFile.path.startsWith('https://');
    const desktopApi = this.deps.getDesktopApi ? this.deps.getDesktopApi() : undefined;
    const gatewayUrl = this.deps.getGatewayUrl();

    // 1. 优先调用桌面端原生 SaveDialog 另存为
    if (desktopApi?.saveFile) {
      try {
        const downloadPayload = isHttp
          ? activeFile.path
          : activeFile.content.includes(this.deps.t('inspector.remoteNotice')) && gatewayUrl
            ? `${gatewayUrl}/api/files/download?path=${encodeURIComponent(activeFile.path)}`
            : activeFile.content;

        const res = await desktopApi.saveFile({
          fileName: rawFileName,
          content: downloadPayload,
          isBase64: isDataUrl,
        });
        if (res.success) {
          this.flashSuccessColor(btnDownload);
          return;
        }
        if (res.canceled) return;
      } catch (e) {
        console.warn('[Desktop Save] Native save dialog failed, fallback to blob:', e);
      }
    }

    // 2. Web 浏览器或降级：Blob / Data URL 模拟下载
    if (isDataUrl) {
      const a = document.createElement('a');
      a.href = activeFile.content;
      a.download = rawFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      const ext = (rawFileName.split('.').pop() || '').toLowerCase();
      let mime = 'text/plain;charset=utf-8';
      if (ext === 'html' || ext === 'htm') mime = 'text/html;charset=utf-8';
      else if (ext === 'json') mime = 'application/json;charset=utf-8';
      else if (ext === 'md' || ext === 'markdown') mime = 'text/markdown;charset=utf-8';

      const blob = new Blob([activeFile.content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = rawFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    this.flashSuccessColor(btnDownload);
  }

  private flashSuccessColor(el: HTMLElement): void {
    el.style.color = 'var(--accent)';
    setTimeout(() => {
      el.style.color = '';
    }, 1200);
  }
}
