/**
 * 头像尺寸解析器单测（resolveAvatarSizeCss / resolveAvatarSizeAttributes）。
 *
 * 设计意图 (Why)：
 *   把「解析」从 200 行 SVG 字符串里拆出来后，白名单的每个边界都能被直接命中：
 *   合法数字、合法 CSS 长度、非法字符串（属性注入面）、非法数字（NaN/0/负数）。
 *   两个函数是一对契约：CSS 长度决定 style，属性片段决定 width/height，二者必须同步回退。
 *
 * 防范的历史坑 (Pitfall)：
 *   形参从 number 放宽到 number | string 后，字符串会被原样拼进 style；若不校验，
 *   `36px" onerror="alert(1)" data-x="` 能闭合 style 属性并注入事件处理器。
 *
 * 约束与规则 (Rules)：
 *   断言基于返回值本身（不做渲染），保证变异体（放行非法值/改回退值/漏发属性）必然被杀。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AVATAR_SIZE_FALLBACK,
  resolveAvatarPixelSize,
  resolveAvatarSizeAttributes,
  resolveAvatarSizeCss,
} from '../dist/utils/avatarSize.js';

test('数字形态：有限正数统一补 px，属性同步下发', () => {
  for (const [input, expected] of [[36, '36px'], [24, '24px'], [1.5, '1.5px'], [0.5, '0.5px']]) {
    assert.equal(resolveAvatarSizeCss(input), expected, `数字 ${input} 必须补 px`);
    assert.equal(resolveAvatarSizeAttributes(input), ` width="${input}" height="${input}"`);
  }
});

test('数字形态：0 / 负数 / NaN / Infinity 一律回退 36px（不得渗出 NaN 或 0px）', () => {
  for (const bad of [0, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(resolveAvatarPixelSize(bad), undefined, `${String(bad)} 不得被视为合法像素`);
    assert.equal(resolveAvatarSizeCss(bad), AVATAR_SIZE_FALLBACK, `${String(bad)} 必须回退`);
    assert.equal(resolveAvatarSizeAttributes(bad), ' width="36" height="36"', `${String(bad)} 属性必须同步回退`);
  }
});

test('字符串形态白名单：CSS 变量与带单位数值原样放行', () => {
  const allowed = [
    'var(--geo-station-avatar)',
    'var(--geo-station-avatar, 36px)',
    'var(--size,1.5rem)',
    '12px',
    '1.5rem',
    '2em',
    '50%',
    '4vw',
    '3.25vh',
  ];
  for (const ok of allowed) {
    assert.equal(resolveAvatarSizeCss(ok), ok, `白名单形态必须原样下发：${ok}`);
    assert.equal(resolveAvatarSizeAttributes(ok), '', '字符串形态不得下发 SVG 几何属性');
  }
});

test('字符串形态白名单：注入与表达式一律回退 36px', () => {
  const rejected = [
    '36px" onerror="alert(1)" data-x="',
    '36px; background: url(x)',
    '</svg><script>1</script>',
    'calc(100% - 1px)',
    'min(10px, 2vw)',
    'expression(alert(1))',
    'var(--a, var(--b))',
    'url(javascript:1)',
    '36', // 缺单位
    '0',
    '36.5', // 纯数字字符串：必须被"带单位"白名单拦下（Number.isFinite 本身不做 coercion）
    'px',
    '  36px', // 前导空格
    '36PX',
    '',
  ];
  for (const bad of rejected) {
    assert.equal(resolveAvatarSizeCss(bad), AVATAR_SIZE_FALLBACK, `非法字符串必须回退：${bad}`);
    assert.equal(resolveAvatarSizeAttributes(bad), ' width="36" height="36"', `非法字符串属性必须同步回退：${bad}`);
  }
  // 数字字符串不是合法像素：真正拦住它的是"必须带单位"的白名单正则
  // （Number.isFinite('36') 天然返回 false，与 typeof 收口无关）。
  assert.equal(resolveAvatarPixelSize('36'), undefined, '数字字符串不是合法像素');
});

test('回退必须可观测：非法入参要打出可定位的告警文案', () => {
  const warns = [];
  const original = console.warn;
  console.warn = (...args) => { warns.push(args); };
  try {
    assert.equal(resolveAvatarSizeCss('bad-size'), AVATAR_SIZE_FALLBACK);
  } finally {
    console.warn = original;
  }
  assert.equal(warns.length, 1, '非法入参必须且只能告警一次（禁止静默吞掉）');
  assert.match(String(warns[0][0]), /\[botAvatar\].*回退/, '告警必须带模块前缀与"回退"语义，便于现场定位');
  assert.equal(warns[0][1], 'bad-size', '告警必须回显原始入参');
});

test('非字符串/非数字入参：不得因隐式 toString 被当成合法尺寸', () => {
  // 白名单只认真正的字符串字面量。对象若靠 toString 伪装成 '12px'，
  // 一旦 typeof 收口被放手就会原样落进 style（`width: [object Object]` 或注入面）。
  const fake = { toString: () => '12px' };
  assert.equal(resolveAvatarSizeCss(fake), AVATAR_SIZE_FALLBACK, '对象形态必须回退');
  assert.equal(resolveAvatarSizeAttributes(fake), ' width="36" height="36"', '对象形态属性必须同步回退');
  assert.equal(resolveAvatarPixelSize(fake), undefined, '对象不得被视为合法像素');
});

test('回退值必须是 36px 单一真值（禁止两处各写各的）', () => {
  assert.equal(AVATAR_SIZE_FALLBACK, '36px');
  assert.equal(resolveAvatarSizeCss(Number.NaN), AVATAR_SIZE_FALLBACK);
  assert.equal(resolveAvatarSizeCss('not-a-length'), AVATAR_SIZE_FALLBACK);
});
