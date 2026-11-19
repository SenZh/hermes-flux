/**
 * 左轨活动指示器变体偏好（tokens/activityIndicator）。
 *
 * 【为什么需要】变体是用户偏好，脏数据（手改 localStorage、跨版本残留）若漏进类名，
 *   左轨指示器会渲染成 `flux-variant-xxx` 这种不存在的类，视觉上等于"什么都没有"，
 *   而且界面不报错。这里钉住白名单收敛与默认回落。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTIVITY_INDICATOR_STORAGE_KEY,
  ACTIVITY_INDICATOR_VARIANTS,
  DEFAULT_ACTIVITY_INDICATOR_VARIANT,
  loadActivityIndicatorVariant,
  resolveActivityIndicatorVariant,
  saveActivityIndicatorVariant,
} from '../dist/tokens/activityIndicator.js';

const ROOT = path.resolve(import.meta.dirname, '..');

/** 假 localStorage：只记录最后一次写入，并统计读写次数。 */
function installStorage(initial) {
  const store = new Map(Object.entries(initial ?? {}));
  const calls = { reads: 0, writes: [] };
  globalThis.localStorage = {
    getItem(key) {
      calls.reads += 1;
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      calls.writes.push([key, value]);
      store.set(key, value);
    },
  };
  return { store, calls };
}

function restoreStorage() {
  delete globalThis.localStorage;
}

test('变体真值表：六项、首项即默认值、无重复', () => {
  assert.deepEqual(
    [...ACTIVITY_INDICATOR_VARIANTS],
    ['cloud', 'gyro', 'orbit', 'synapse', 'spring', 'matrix'],
  );
  assert.equal(ACTIVITY_INDICATOR_VARIANTS[0], DEFAULT_ACTIVITY_INDICATOR_VARIANT);
  assert.equal(new Set(ACTIVITY_INDICATOR_VARIANTS).size, ACTIVITY_INDICATOR_VARIANTS.length);
});

test('resolve：白名单内原样返回，其余一律回落默认值', () => {
  for (const variant of ACTIVITY_INDICATOR_VARIANTS) {
    assert.equal(resolveActivityIndicatorVariant(variant), variant);
  }
  for (const dirty of ['', 'CLOUD', 'pulse', 'cloud ', null, undefined]) {
    assert.equal(resolveActivityIndicatorVariant(dirty), DEFAULT_ACTIVITY_INDICATOR_VARIANT);
  }
});

test('load：无 localStorage 环境回落默认值（隐私模式/首启）', () => {
  restoreStorage();
  assert.equal(loadActivityIndicatorVariant(), DEFAULT_ACTIVITY_INDICATOR_VARIANT);
});

test('load：读取持久化值，脏值回落默认值', () => {
  const good = installStorage({ [ACTIVITY_INDICATOR_STORAGE_KEY]: 'orbit' });
  assert.equal(loadActivityIndicatorVariant(), 'orbit');
  assert.equal(good.calls.reads, 1);

  installStorage({ [ACTIVITY_INDICATOR_STORAGE_KEY]: 'not-a-variant' });
  assert.equal(loadActivityIndicatorVariant(), DEFAULT_ACTIVITY_INDICATOR_VARIANT);
  restoreStorage();
});

test('save：按固定键写入，并在写入前收敛非法值', () => {
  const { calls } = installStorage();
  saveActivityIndicatorVariant('spring');
  saveActivityIndicatorVariant('bogus-variant');
  assert.deepEqual(calls.writes, [
    [ACTIVITY_INDICATOR_STORAGE_KEY, 'spring'],
    [ACTIVITY_INDICATOR_STORAGE_KEY, DEFAULT_ACTIVITY_INDICATOR_VARIANT],
  ]);
  restoreStorage();
});

test('save/load 往返：写入什么就加载什么', () => {
  installStorage();
  for (const variant of ACTIVITY_INDICATOR_VARIANTS) {
    saveActivityIndicatorVariant(variant);
    assert.equal(loadActivityIndicatorVariant(), variant);
  }
  restoreStorage();
});

test('读写抛错不得让调用方失败（隐私模式）', () => {
  globalThis.localStorage = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
  assert.equal(loadActivityIndicatorVariant(), DEFAULT_ACTIVITY_INDICATOR_VARIANT);
  assert.doesNotThrow(() => saveActivityIndicatorVariant('matrix'));
  restoreStorage();
});

/**
 * 设置页预览把六套动效并排展示，减弱动效/页面隐藏两条降级必须真的压得住，
 * 否则"看起来有降级、实际还在动"——这是最容易在截图审查里蒙混过去的缺陷。
 */
test('reduced-motion 降级与运行规则同权重（单类名压不住双类名声明）', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/styles/conversation.css'), 'utf8');
  const reduceStart = css.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(reduceStart > -1, '必须存在减弱动效块');
  const reduceBlock = css.slice(reduceStart);
  assert.ok(
    reduceBlock.includes('.flux-cloud-indicator--running .flux-synapse-cell'),
    'synapse 的 animation 声明在双类选择器上，降级规则必须同样带父选择器',
  );
  assert.ok(
    reduceBlock.includes('.flux-cloud-indicator--running .flux-matrix-dot'),
    'matrix 的 animation 声明在双类选择器上，降级规则必须同样带父选择器',
  );
  // 光有选择器不算降级：声明必须真的把动画停掉，并保留可辨识的静态可见度。
  const stopRuleStart = reduceBlock.indexOf('.flux-cloud-indicator--running .flux-synapse-cell');
  const stopRule = reduceBlock.slice(stopRuleStart, reduceBlock.indexOf('}', stopRuleStart) + 1);
  assert.match(stopRule, /animation:\s*none/, '降级声明必须真的停掉动画');
  assert.match(stopRule, /opacity:\s*0\.85/, '减弱动效下静态点阵必须保留与流云同档的可见度');
});

test('页面隐藏时六套动效的承载节点都必须可暂停', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/styles/conversation.css'), 'utf8');
  const hiddenStart = css.indexOf(':root[data-page-hidden="true"] .flux-gyro-ring--a');
  assert.ok(hiddenStart > -1, '必须存在页面隐藏暂停块');
  const hiddenBlock = css.slice(hiddenStart, css.indexOf('@media (prefers-reduced-motion: reduce)', hiddenStart));
  for (const selector of ['.flux-synapse-cell', '.flux-matrix-dot', '.flux-orbit-arm--a', '.flux-spring-arc--outer']) {
    assert.ok(hiddenBlock.includes(selector), `页面隐藏必须暂停 ${selector}`);
  }
});

test('预览放大必须用 zoom 而不是 transform: scale（后者不参与 flex 布局，会压住文字列）', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/tailwind-entry.css'), 'utf8');
  const start = css.indexOf('@utility activity-variant-preview');
  assert.ok(start > -1, '必须存在变体预览 utility');
  const end = css.indexOf('@utility', start + 1);
  const block = css.slice(start, end === -1 ? css.length : end);
  assert.ok(block.includes('zoom:'), '预览必须用 zoom 放大（参与布局）');
  assert.equal(/transform:\s*scale/.test(block), false, '预览不得用 transform: scale，放大后会与文字列重叠');
  assert.ok(block.includes('.flux-cloud-label'), '预览必须显式处理运行态状态词，避免与变体名连读');
});

/**
 * 「不密集」是一条完整口径，横跨 TSX 与样式表两半边：
 *   TSX 决定颗数/直径（已有几何守卫），样式表决定雾层与呼吸峰值。
 * 只改一侧达不成观感，而样式表被改回时此前完全静默——这里把那一半钉住。
 */
test('稀疏云团与两套点阵的样式半边：雾层内缩、峰值收敛、颗粒直径锁定', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/styles/conversation.css'), 'utf8');

  const blockOf = (marker) => {
    const start = css.indexOf(marker);
    assert.ok(start > -1, `样式表缺少 ${marker}`);
    const end = css.indexOf('@keyframes', start + marker.length);
    const nextRule = css.indexOf('\n.', start + marker.length);
    const cut = [end === -1 ? css.length : end, nextRule === -1 ? css.length : nextRule].sort((a, b) => a - b)[0];
    return css.slice(start, cut === undefined ? css.length : cut);
  };

  const fogRule = blockOf('.flux-cloud-fog {');
  assert.match(fogRule, /inset:\s*3px 2px/, '雾层必须内缩，铺满整块 19×14 画布会把 13 颗点糊回一团');
  assert.match(fogRule, /animation:\s*fluxCloudFogBreathe/, '雾层必须保留慢速呼吸（内缩后仍靠明度起伏提供体积感）');

  const breathe = blockOf('@keyframes fluxCloudFogBreathe');
  assert.match(breathe, /50%\s*\{[^}]*opacity:\s*0\.62/, '雾层呼吸峰值必须收敛到 0.62（旧 0.95 在稀疏点阵上会糊成蓝/白光斑）');

  const drift = blockOf('@keyframes fluxCloudDrift');
  assert.match(drift, /50%\s*\{[^}]*opacity:\s*0\.92/, '颗粒漂移峰值必须收敛到 0.92（纯白点 0.98 偏刺眼）');

  const synapseGrid = blockOf('.flux-motif-synapse {');
  assert.match(synapseGrid, /grid-template-columns:\s*repeat\(4,\s*2px\)/, '突触网格列宽必须与颗粒直径同档');
  const synapseCell = blockOf('.flux-synapse-cell {');
  assert.match(synapseCell, /width:\s*2px/, '突触颗粒直径必须为 2px');
  assert.match(synapseCell, /height:\s*2px/, '突触颗粒必须正圆');

  const matrixDot = blockOf('.flux-matrix-dot {');
  assert.match(matrixDot, /width:\s*1\.8px/, '旋涡颗粒直径必须为 1.8px');
  assert.match(matrixDot, /height:\s*1\.8px/, '旋涡颗粒必须正圆');
});
