/**
 * BOT 头像裁剪（唯一实现）。
 *
 * 【设计意图 (Why)】
 *   网关的 `profiles.set_asset` 接收 data URL / bare base64，且资产会进入每次 profiles.list
 *   的回显链路。原图直接上传会让几十 MB 的截图变成常驻内存与网络负担。
 *   在客户端统一裁剪为 256×256 WebP，既满足头像清晰度，也把体积压到几十 KB。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 只校验扩展名会放过改后缀的非图片文件，解码阶段才炸；必须同时校验 MIME。
 *   2. 等比缩放会让非正方形图片留白或拉伸；头像是圆形裁切，必须居中 cover 裁剪。
 *
 * 【约束与规则 (Rules)】
 *   1. 仅接受 `image/*` 且 ≤2MB；超限抛出带 code 的错误，由界面显示具体原因；
 *   2. 输出固定 256×256，优先 WebP；运行环境不支持 WebP 时浏览器会回落到 PNG data URL；
 *   3. 纯浏览器 API，零网络、零网关调用。
 */

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_SIZE = 256;

export type AvatarErrorCode = 'too-large' | 'invalid-type' | 'decode-failed' | 'canvas-failed';

export class AvatarProcessingError extends Error {
  public readonly code: AvatarErrorCode;

  constructor(code: AvatarErrorCode) {
    super(code);
    this.name = 'AvatarProcessingError';
    this.code = code;
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new AvatarProcessingError('decode-failed'));
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new AvatarProcessingError('decode-failed'));
    };
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new AvatarProcessingError('decode-failed'));
    image.onload = () => resolve(image);
    image.src = dataUrl;
  });
}

/** 把用户选择的文件居中裁剪为 256×256 的 data URL。 */
export async function cropAvatarToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new AvatarProcessingError('invalid-type');
  if (file.size > AVATAR_MAX_BYTES) throw new AvatarProcessingError('too-large');

  const source = await readAsDataUrl(file);
  const image = await loadImage(source);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (sourceWidth <= 0 || sourceHeight <= 0) throw new AvatarProcessingError('decode-failed');

  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new AvatarProcessingError('canvas-failed');

  // cover：短边铺满，长边居中裁掉，保证圆形头像不变形。
  const scale = Math.max(AVATAR_SIZE / sourceWidth, AVATAR_SIZE / sourceHeight);
  const cropWidth = AVATAR_SIZE / scale;
  const cropHeight = AVATAR_SIZE / scale;
  const sourceX = (sourceWidth - cropWidth) / 2;
  const sourceY = (sourceHeight - cropHeight) / 2;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, sourceX, sourceY, cropWidth, cropHeight, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

  return canvas.toDataURL('image/webp', 0.92);
}
