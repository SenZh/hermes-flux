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
import { generatePointCloudBlock } from '../../../scripts/generate-point-cloud-css.mjs';
import {
  ACTIVITY_INDICATOR_STORAGE_KEY,
  ACTIVITY_INDICATOR_VARIANTS,
  DEFAULT_ACTIVITY_INDICATOR_VARIANT,
  POINT_CLOUD_SPECS,
  POINT_CLOUD_SPEC_MAP,
  getPointCloudSpec,
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

test('变体真值表：十八项、首项即默认值、无重复，且 12 套 3D 点云规格一致', () => {
  assert.deepEqual(
    [...ACTIVITY_INDICATOR_VARIANTS],
    [
      'cloud',
      'gyro',
      'orbit',
      'synapse',
      'spring',
      'matrix',
      'abyss-whale',
      'prolate-lattice',
      'infinity-knot',
      'surf-ribbon',
      'twin-vortex',
      'kinetic-helix',
      'whale-compact',
      'torus-mesh',
      'wave-net',
      'sphere-mesh',
      'mobius-band',
      'dipole-vortex',
    ],
  );
  assert.equal(ACTIVITY_INDICATOR_VARIANTS[0], DEFAULT_ACTIVITY_INDICATOR_VARIANT);
  assert.equal(new Set(ACTIVITY_INDICATOR_VARIANTS).size, ACTIVITY_INDICATOR_VARIANTS.length);

  assert.equal(POINT_CLOUD_SPECS.length, 12);
  assert.equal(new Set(POINT_CLOUD_SPECS.map((s) => s.id)).size, 12);
  assert.equal(new Set(POINT_CLOUD_SPECS.map((s) => s.code)).size, 12);
  for (const spec of POINT_CLOUD_SPECS) {
    assert.ok(ACTIVITY_INDICATOR_VARIANTS.includes(spec.id), `点云规格 ${spec.id} 必须登记在变体总表`);
    assert.ok(spec.shape === 'wide' || spec.shape === 'sq');
    assert.ok(spec.dotCount >= 16, `点云 ${spec.id} 至少需 16 颗粒子以保证空间网感`);
    assert.equal(getPointCloudSpec(spec.id), POINT_CLOUD_SPEC_MAP[spec.id]);
  }
  for (const legacy of ['cloud', 'gyro', 'orbit', 'synapse', 'spring', 'matrix']) {
    assert.equal(getPointCloudSpec(legacy), undefined, `原有变体 ${legacy} 不得误入点云分支`);
  }
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

test('getPointCloudSpec：原语非点云与原型链属性名（toString/constructor）严禁误命中', () => {
  for (const dirty of ['toString', 'constructor', 'valueOf', '__proto__', 'hasOwnProperty']) {
    // 测试运行时传入非枚举原型链属性名时的防御边界
    assert.equal(getPointCloudSpec(dirty), undefined, `原型属性 ${dirty} 必须返回 undefined`);
  }
});

/**
 * 设置页预览把十八套动效并排展示，减弱动效/页面隐藏两条降级必须真的压得住，
 * 否则"看起来有降级、实际还在动"——这是最容易在截图审查里蒙混过去的缺陷。
 */
test('reduced-motion 降级与运行规则同权重（覆盖全部十八套变体、点云去合成层提示与瞬态脉冲）', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/styles/conversation.css'), 'utf8');
  const reduceStart = css.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(reduceStart > -1, '必须存在减弱动效块');
  const reduceBlock = css.slice(reduceStart);

  const requiredSelectors = [
    '.flux-cloud-indicator--running .flux-cloud-stream--top',
    '.flux-cloud-indicator--running .flux-cloud-glint',
    '.flux-cloud-indicator--running .flux-cloud-label--running',
    '.flux-cloud-indicator--running .flux-gyro-gimbal',
    '.flux-cloud-indicator--running .flux-gyro-ring--a',
    '.flux-cloud-indicator--running .flux-orbit-plane--a',
    '.flux-cloud-indicator--running .flux-orbit-arm--a',
    '.flux-cloud-indicator--running .flux-synapse-field',
    '.flux-cloud-indicator--running .flux-synapse-branch .flux-synapse-node',
    '.flux-cloud-indicator--running .flux-synapse-branch .flux-synapse-pulse',
    '.flux-cloud-indicator--running .flux-synapse-wave',
    '.flux-cloud-indicator--running .flux-spring-arc--outer',
    '.flux-cloud-indicator--running .flux-vortex-field',
    '.flux-cloud-indicator--running .flux-vortex-arm--outer',
    '.flux-cloud-indicator--running .flux-pc-dot',
    '.flux-cloud-ripple',
    '.flux-cloud-indicator--unread[data-transition="just-completed"] .flux-pc-done-ring',
    '.flux-cloud-indicator--unread[data-transition="just-completed"] .flux-pc-done-spark',
  ];
  for (const selector of requiredSelectors) {
    assert.ok(reduceBlock.includes(selector), `reduced-motion 必须覆盖高权重运行选择器 ${selector}`);
  }

  const stopRuleStart = reduceBlock.indexOf('.flux-cloud-indicator--running .flux-cloud-stream--top');
  const stopRule = reduceBlock.slice(stopRuleStart, reduceBlock.indexOf('}', stopRuleStart) + 1);
  assert.match(stopRule, /animation:\s*none/, '降级声明必须真的停掉动画');
  assert.match(stopRule, /opacity:\s*0\.85/, '减弱动效下静态形态必须保留可辨识度');

  const hidePulseStart = reduceBlock.indexOf('.flux-cloud-indicator--running .flux-synapse-branch .flux-synapse-pulse');
  const hidePulseRule = reduceBlock.slice(hidePulseStart, reduceBlock.indexOf('}', hidePulseStart) + 1);
  assert.match(hidePulseRule, /animation:\s*none/);
  assert.match(hidePulseRule, /opacity:\s*0\s*;/, '减弱动效下突触瞬态电脉冲、波环与完成扩散环必须隐去');

  const pcStopStart = reduceBlock.indexOf('.flux-cloud-indicator--running .flux-pc-dot');
  const pcStopRule = reduceBlock.slice(pcStopStart, reduceBlock.indexOf('}', pcStopStart) + 1);
  assert.match(pcStopRule, /animation:\s*none/, '减弱动效必须停止点云粒子动画');
  assert.match(pcStopRule, /will-change:\s*auto\s*;/, '减弱动效下点云必须释放 will-change 合成层提示');
  assert.equal(/opacity\s*:/.test(pcStopRule), false, '点云降级不得覆写单粒子的静态 3D 景深透明度');
});

test('页面隐藏时全十八套动效的承载节点都必须可暂停，且点云释放 will-change', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/styles/conversation.css'), 'utf8');
  const hiddenStart = css.indexOf(':root[data-page-hidden="true"] .flux-activity-dot--running::after');
  assert.ok(hiddenStart > -1, '必须存在页面隐藏暂停块');
  const hiddenBlock = css.slice(hiddenStart, css.indexOf('@media (prefers-reduced-motion: reduce)', hiddenStart));
  for (const selector of [
    '.flux-cloud-stream',
    '.flux-cloud-glint',
    '.flux-cloud-label--running',
    '.flux-gyro-gimbal',
    '.flux-gyro-ring--a',
    '.flux-orbit-plane--a',
    '.flux-orbit-arm--a',
    '.flux-synapse-field',
    '.flux-synapse-pulse',
    '.flux-synapse-node',
    '.flux-synapse-wave',
    '.flux-spring-arc--outer',
    '.flux-vortex-field',
    '.flux-vortex-arm--outer',
    '.flux-pc-dot',
  ]) {
    assert.ok(hiddenBlock.includes(selector), `页面隐藏必须暂停 ${selector}`);
  }
  assert.match(hiddenBlock, /animation-play-state:\s*paused/);
  assert.match(hiddenBlock, /:root\[data-page-hidden="true"\]\s+\.flux-pc-dot\s*\{\s*will-change:\s*auto;/);
});

test('预览放大必须用 zoom 而不是 transform: scale，且容器锁定 64×36px 容纳宽/方预览', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/tailwind-entry.css'), 'utf8');
  const start = css.indexOf('@utility activity-variant-preview');
  assert.ok(start > -1, '必须存在变体预览 utility');
  const end = css.indexOf('@utility', start + 1);
  const block = css.slice(start, end === -1 ? css.length : end);
  assert.ok(block.includes('zoom:'), '预览必须用 zoom 放大（参与布局）');
  assert.ok(block.includes('& .flux-pc-canvas'), '点云画布必须纳入预览 2x 放大选择器');
  assert.match(block, /width:\s*64px/, '预览槽宽度必须扩大到 64px（4px 网格）以容纳 30px×2 宽幅点云');
  assert.match(block, /height:\s*36px/, '预览槽高度必须锁定 36px（4px 网格）以保持 18 张卡等高');
  assert.equal(/transform:\s*scale/.test(block), false, '预览不得用 transform: scale，放大后会与文字列重叠');
  assert.ok(block.includes('.flux-cloud-label'), '预览必须显式处理运行态状态词，避免与变体名连读');
});

/**
 * 样式半边守卫：状态词轻盈字重、反密集点阵、六套变体多谐波互质周期。
 *
 * 【为什么需要】TSX 结构与样式表共同决定最终观感：
 *   1. 若状态词 `.flux-cloud-label` 回退到 font-weight: 600 或 10px，会重新变粗重发糊；
 *   2. 若样式表残留旧 `.flux-cloud-dot` / `.flux-matrix-dot` / `repeat(4, ...)` 规则，密点可能复辟；
 *   3. 若各变体只有 1~2 个固定动画周期，动效会退化成呆板单调循环。
 */
test('状态词轻盈字重、反密集样式清零与六变体多谐波周期守卫', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/styles/conversation.css'), 'utf8');
  const cleanCss = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // 1. 状态词字阶与字重（跳过 @container 窄宽隐藏块，精确命中顶层 .flux-cloud-label）
  const labelStart = cleanCss.indexOf('\n.flux-cloud-label {');
  assert.ok(labelStart > -1, '缺少顶层 .flux-cloud-label 规则');
  const labelRule = cleanCss.slice(labelStart, cleanCss.indexOf('}', labelStart) + 1);
  assert.match(labelRule, /font-size:\s*var\(--fs-caption,\s*11px\)/, '状态词字号必须对齐 11px caption 阶梯');
  assert.match(labelRule, /font-weight:\s*400\s*;/, '状态词字重必须保持轻盈 regular (400)');
  assert.equal(/font-weight:\s*(?:500|600|700)\b/.test(labelRule), false, '状态词严禁变回粗体');

  // 2. 反密集点阵样式清零
  assert.equal(cleanCss.includes('.flux-cloud-dot'), false, '样式表不得残留旧 .flux-cloud-dot 密点规则');
  assert.equal(cleanCss.includes('.flux-synapse-cell'), false, '样式表不得残留旧 .flux-synapse-cell 密点规则');
  assert.equal(cleanCss.includes('.flux-matrix-dot'), false, '样式表不得残留旧 .flux-matrix-dot 密点规则');
  assert.equal(/grid-template-columns:\s*repeat\(4,/.test(cleanCss), false, '突触不得回退到 4x4 密集网格');

  // 3. 全部 6 套变体必须各自具备 ≥3 个互不相同的运行态动画周期（多谐波持续演进）
  const readRuleDurations = (selectors) => {
    const durations = new Set();
    for (const sel of selectors) {
      const idx = cleanCss.indexOf(`${sel} {`);
      assert.ok(idx > -1, `缺少规则 ${sel}`);
      const block = cleanCss.slice(idx, cleanCss.indexOf('}', idx) + 1);
      const m = /animation:\s*[a-zA-Z0-9_-]+\s+(\d+(?:\.\d+)?m?s)\b/.exec(block);
      assert.ok(m, `规则 ${sel} 必须声明 animation 时长`);
      durations.add(m[1]);
    }
    return durations;
  };

  assert.ok(
    readRuleDurations(['.flux-cloud-stream--top', '.flux-cloud-stream--mid', '.flux-cloud-stream--low', '.flux-cloud-glint']).size >= 4,
    'cloud 四条运动层必须采用互不相同的周期',
  );
  assert.ok(
    readRuleDurations(['.flux-gyro-gimbal', '.flux-gyro-ring--a', '.flux-gyro-ring--b', '.flux-gyro-ring--c', '.flux-gyro-core']).size >= 4,
    'gyro 必须具备 ≥4 个互质进动周期',
  );
  assert.ok(
    readRuleDurations(['.flux-orbit-plane--a', '.flux-orbit-plane--b', '.flux-orbit-arm--a', '.flux-orbit-arm--b', '.flux-orbit-sun']).size >= 4,
    'orbit 必须具备 ≥4 个互质椭圆进动与伴行周期',
  );
  assert.ok(
    readRuleDurations([
      '.flux-synapse-field',
      '.flux-cloud-indicator--running .flux-synapse-branch--a .flux-synapse-pulse',
      '.flux-cloud-indicator--running .flux-synapse-branch--b .flux-synapse-pulse',
      '.flux-cloud-indicator--running .flux-synapse-branch--c .flux-synapse-pulse',
      '.flux-synapse-wave',
      '.flux-synapse-core',
    ]).size >= 5,
    'synapse 必须具备 ≥5 个互质神经脉动周期',
  );
  assert.ok(
    readRuleDurations(['.flux-spring-arc--outer', '.flux-spring-arc--mid', '.flux-spring-arc--inner', '.flux-spring-dot']).size >= 4,
    'spring 四层游丝与核心必须采用互不相同的周期',
  );
  assert.ok(
    readRuleDurations(['.flux-vortex-field', '.flux-vortex-arm--outer', '.flux-vortex-arm--mid', '.flux-vortex-arm--inner', '.flux-vortex-eye']).size >= 4,
    'matrix 旋涡四层流线与奇点必须采用互不相同的周期',
  );
});

/**
 * 3D 点云 CSS 完整性、生成器一致性、负 delay 共享轨道非坍缩分布与纯 Token 守卫。
 *
 * 【为什么必须检验坐标唯一性与共享轨道延迟】
 *   torus-mesh / sphere-mesh / mobius-band 同一环面共享 @keyframes、靠负 delay 错峰成网；
 *   若静态 pose 错写成统一 t=0，减弱动效下会坍缩成 2~4 颗重叠加点，只测 translate3d 存在性完全抓不住该退化。
 */
test('3D 点云 CSS 完整性：生成器逐字同步、全部 12 套 t0 非坍缩唯一坐标、关键帧引用与零硬编码色相', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/styles/conversation.css'), 'utf8');
  const beginMarker = '/* BEGIN GENERATED POINT-CLOUD INDICATORS (scripts/generate-point-cloud-css.mjs) */';
  const endMarker = '/* END GENERATED POINT-CLOUD INDICATORS */';
  const begin = css.indexOf(beginMarker);
  const end = css.indexOf(endMarker);
  assert.ok(begin > -1 && end > begin, 'conversation.css 必须包含点云 CSS 生成区间');

  const rawSection = css.slice(begin, end + endMarker.length);
  assert.equal(
    rawSection.replace(/\r\n/g, '\n'),
    generatePointCloudBlock().replace(/\r\n/g, '\n'),
    'conversation.css 点云生成段必须与 scripts/generate-point-cloud-css.mjs 输出严格一致（防生成器漂移）',
  );

  const cleanSection = rawSection.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(cleanSection), false, '点云样式段严禁任何硬编码色值');

  assert.match(cleanSection, /\.flux-pc-canvas--wide\s*\{\s*width:\s*30px;\s*height:\s*16px;/);
  assert.match(cleanSection, /\.flux-pc-canvas--sq\s*\{\s*width:\s*18px;\s*height:\s*18px;/);

  for (const spec of POINT_CLOUD_SPECS) {
    const keyframesFound = new Set();
    const coordKeys = new Set();
    const xs = [];
    const ys = [];
    const byKeyframe = new Map();

    for (let i = 0; i < spec.dotCount; i += 1) {
      const sel = `.flux-pc-${spec.code}-${i} {`;
      const idx = cleanSection.indexOf(sel);
      assert.ok(idx > -1, `缺少点云粒子规则 ${sel}`);
      const block = cleanSection.slice(idx, cleanSection.indexOf('}', idx) + 1);
      const posMatch = /transform:\s*translate3d\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px,\s*0\)/.exec(block);
      assert.ok(posMatch, `${sel} 必须携带精确静态 3D t0 translate3d(x, y, 0) 坐标`);
      const x = Number(posMatch[1]);
      const y = Number(posMatch[2]);
      const coordKey = `${posMatch[1]},${posMatch[2]}`;
      coordKeys.add(coordKey);
      xs.push(x);
      ys.push(y);

      assert.match(block, /opacity:\s*(?:0?\.\d+|1)\b/, `${sel} 必须携带静态 3D t0 景深透明度`);
      const animMatch = /animation:\s*(fluxPc[A-Za-z0-9]+)\s+(\d+(?:\.\d+)?s)\s+linear\s+(-?\d+(?:\.\d+)?s)\s+infinite/.exec(block);
      assert.ok(animMatch, `${sel} 必须声明合法点云关键帧动画`);
      const kf = animMatch[1];
      const delay = animMatch[3];
      keyframesFound.add(kf);
      const group = byKeyframe.get(kf) ?? [];
      group.push({ delay, coordKey });
      byKeyframe.set(kf, group);
    }

    assert.equal(coordKeys.size, spec.dotCount, `${spec.id} 全部 ${spec.dotCount} 颗粒子的静态 t0 坐标必须互不重合`);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    if (spec.shape === 'wide') {
      assert.ok(spanX >= 20 && spanY >= 3.5, `${spec.id} 宽幅点云静态 t0 分布不得坍缩（实测 ${spanX.toFixed(2)}×${spanY.toFixed(2)}px）`);
    } else {
      assert.ok(spanX >= 10 && spanY >= 6.5, `${spec.id} 紧凑点云静态 t0 分布不得坍缩（实测 ${spanX.toFixed(2)}×${spanY.toFixed(2)}px）`);
    }

    for (const [kf, items] of byKeyframe) {
      assert.ok(cleanSection.includes(`@keyframes ${kf} {`), `缺少关键帧定义 @keyframes ${kf}`);
      if (items.length > 1) {
        const distinctDelays = new Set(items.map((x) => x.delay));
        const distinctCoords = new Set(items.map((x) => x.coordKey));
        assert.equal(distinctDelays.size, items.length, `${spec.id} 共享轨道 ${kf} 各粒子必须携带互异负 delay`);
        assert.equal(distinctCoords.size, items.length, `${spec.id} 共享轨道 ${kf} 必须按 t0=(-delay/dur)%1 展开成独立坐标`);
      }
    }
  }
});
