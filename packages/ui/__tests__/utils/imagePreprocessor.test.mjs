import test from 'node:test';
import assert from 'node:assert/strict';
import { preprocessImageFile, MAX_IMAGE_SIZE_BYTES, MAX_DIMENSION_LIMIT } from '../../dist/utils/imagePreprocessor.js';

test('imagePreprocessor - 图片预处理与 10MB 门限安全拦截', async (t) => {
  await t.test('1. 负向物理门禁：超出 10MB 的超大文件必须立即抛错拒绝', async () => {
    const oversizeFile = {
      name: 'huge.png',
      size: MAX_IMAGE_SIZE_BYTES + 1024, // 10MB + 1KB
      type: 'image/png',
    };

    await assert.rejects(
      async () => preprocessImageFile(oversizeFile),
      /图片文件超出 10MB 限制/
    );
  });

  await t.test('2. 正常尺寸图片（<=2048px）：保持原始尺寸并安全提取 Base64', async () => {
    // 注入 DOM 模拟环境桩
    const originalFileReader = globalThis.FileReader;
    const originalImage = globalThis.Image;
    const originalURL = globalThis.URL;

    try {
      globalThis.FileReader = class MockFileReader {
        readAsDataURL() {
          setTimeout(() => {
            this.result = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            this.onload?.();
          }, 0);
        }
      };

      globalThis.Image = class MockImage {
        constructor() {
          this.naturalWidth = 800;
          this.naturalHeight = 600;
          setTimeout(() => this.onload?.(), 0);
        }
      };

      globalThis.URL = {
        createObjectURL: (file) => `blob:mock-preview-${file.name}`,
        revokeObjectURL: () => {},
      };

      const file = { name: 'normal.png', size: 1024 * 50, type: 'image/png' };
      const res = await preprocessImageFile(file);

      assert.equal(res.width, 800);
      assert.equal(res.height, 600);
      assert.ok(res.base64.startsWith('iVBORw0KGgo'));
      assert.equal(res.previewUrl, 'blob:mock-preview-normal.png');
    } finally {
      globalThis.FileReader = originalFileReader;
      globalThis.Image = originalImage;
      globalThis.URL = originalURL;
    }
  });

  await t.test('3. 超长边图片（>2048px）：等比自适应下采样到 2048px', async () => {
    const originalFileReader = globalThis.FileReader;
    const originalImage = globalThis.Image;
    const originalDocument = globalThis.document;
    const originalURL = globalThis.URL;

    try {
      globalThis.FileReader = class MockFileReader {
        readAsDataURL() {
          setTimeout(() => {
            this.result = 'data:image/png;base64,mock-raw-huge-data';
            this.onload?.();
          }, 0);
        }
      };

      globalThis.Image = class MockImage {
        constructor() {
          this.naturalWidth = 4096;
          this.naturalHeight = 2048;
          setTimeout(() => this.onload?.(), 0);
        }
      };

      let canvasDrawnWidth = 0;
      let canvasDrawnHeight = 0;

      globalThis.document = {
        createElement: (tag) => {
          if (tag === 'canvas') {
            return {
              width: 0,
              height: 0,
              getContext: () => ({
                drawImage: (img, x, y, w, h) => {
                  canvasDrawnWidth = w;
                  canvasDrawnHeight = h;
                },
              }),
              toDataURL: (type, quality) => 'data:image/jpeg;base64,mock-scaled-base64-data',
            };
          }
          return {};
        },
      };

      globalThis.URL = {
        createObjectURL: (file) => `blob:mock-scaled-${file.name}`,
        revokeObjectURL: () => {},
      };

      const file = { name: '4k-wallpaper.png', size: 1024 * 1024 * 3, type: 'image/png' };
      const res = await preprocessImageFile(file);

      assert.equal(res.width, MAX_DIMENSION_LIMIT, '长边必须等比缩放至 2048px');
      assert.equal(res.height, 1024, '4096x2048 下采样后高度必须为 1024px');
      assert.equal(canvasDrawnWidth, 2048);
      assert.equal(canvasDrawnHeight, 1024);
      assert.equal(res.base64, 'mock-scaled-base64-data');
    } finally {
      globalThis.FileReader = originalFileReader;
      globalThis.Image = originalImage;
      globalThis.document = originalDocument;
      globalThis.URL = originalURL;
    }
  });
});
