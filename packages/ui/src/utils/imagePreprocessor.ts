/**
 * Image Preprocessor & Clipboard Utility (packages/ui/src/utils/imagePreprocessor.ts)
 *
 * 【设计意图 (Why)】
 * 1. 用户通过 Ctrl+V 粘贴系统截图或外部大图时，避免高分辨率超大 Base64 打爆 IPC 与网关传输；
 * 2. 纯 UI 表现层负责 DOM Canvas 交互，彻底隔离 packages/core（保证 Core 零 DOM 依赖）。
 *
 * 【约束与规则 (Rules)】
 * - 单张图片物理大小硬门限：10MB (10 * 1024 * 1024 bytes)；
 * - 超过 10MB 必须显式报错拦截，绝不静默吞掉异常；
 * - 长边超过 2048px 时，使用 HTMLCanvasElement 进行等比自适应下采样；
 * - 纯异步返回 Promise<{ base64: string; width: number; height: number; sizeBytes: number; previewUrl: string }>。
 */

export interface PreprocessedImageResult {
  base64: string;
  width: number;
  height: number;
  sizeBytes: number;
  previewUrl: string;
}

export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_DIMENSION_LIMIT = 2048; // 长边最大 2048px

/**
 * 处理剪贴板或选择的文件图片
 */
export async function preprocessImageFile(file: File): Promise<PreprocessedImageResult> {
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(`图片文件超出 10MB 限制（当前大小：${(file.size / 1024 / 1024).toFixed(1)}MB）`);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片文件失败'));
    reader.onload = () => {
      // SAFETY: [invariant] reader.readAsDataURL 保证 result 在成功加载后恒为 string
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onerror = () => reject(new Error('解码图片数据失败'));
      img.onload = () => {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        // 如果未超过尺寸限制，直接返回原始 Base64
        if (width <= MAX_DIMENSION_LIMIT && height <= MAX_DIMENSION_LIMIT) {
          const rawBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
          const previewUrl = URL.createObjectURL(file);
          resolve({
            base64: rawBase64,
            width,
            height,
            sizeBytes: file.size,
            previewUrl,
          });
          return;
        }

        // 计算等比下采样尺寸
        if (width > height) {
          height = Math.round((height * MAX_DIMENSION_LIMIT) / width);
          width = MAX_DIMENSION_LIMIT;
        } else {
          width = Math.round((width * MAX_DIMENSION_LIMIT) / height);
          height = MAX_DIMENSION_LIMIT;
        }

        try {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('获取 Canvas 渲染上下文失败');
          }

          ctx.drawImage(img, 0, 0, width, height);
          const scaledDataUrl = canvas.toDataURL('image/jpeg', 0.9);
          const scaledBase64 = scaledDataUrl.split(',')[1];
          const approxBytes = Math.round((scaledBase64.length * 3) / 4);
          const previewUrl = URL.createObjectURL(file);

          resolve({
            base64: scaledBase64,
            width,
            height,
            sizeBytes: approxBytes,
            previewUrl,
          });
        } catch (err) {
          reject(err);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}
