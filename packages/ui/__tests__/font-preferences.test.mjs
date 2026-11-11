import test from 'node:test';
import assert from 'node:assert/strict';

import { applyFontPreferences, DEFAULT_FONT_PREFERENCES } from '../dist/tokens/fontPreferences.js';

/**
 * 假 root：只记录 applyFontPreferences 写入的 CSS 变量。
 * 【为什么需要】--ui-text-caption 只在运行时注入，SSR 断言只能看到组件里的变量名，
 *   删掉 fontPreferences 的写入整行测试也不会红；这里直接验证副作用。
 */
function fakeRoot() {
  const props = new Map();
  return {
    props,
    style: {
      setProperty(key, value) {
        props.set(key, value);
      },
    },
  };
}

const cases = [
  ['small', '10px'],
  ['medium', '11px'],
  ['large', '12px'],
];

for (const [sizeScale, expected] of cases) {
  test(`applyFontPreferences：${sizeScale} 档把 --ui-text-caption 收敛为 ${expected}`, () => {
    const root = fakeRoot();
    applyFontPreferences({ ...DEFAULT_FONT_PREFERENCES, sizeScale }, root);
    assert.equal(
      root.props.get('--ui-text-caption'),
      expected,
      'Agent 选择卡的字号必须跟随用户档位，且落在整数 px、不得跌破 10px',
    );
  });
}
