/**
 * 活动指示器墨色（--flux-activity-ink*）的极性守卫。
 *
 * 【为什么需要】深色皮肤取亮白、浅色皮肤回落蓝，这条口径写在 `styles.css` 的
 *   `:root` 与浅色覆盖块两处手写代码里，身份不在皮肤槽位表内，任何"新增浅色皮肤
 *   忘记登记"或"把深色值改回亮蓝"都不会让既有测试变红——界面只会静默变成
 *   浅底白点（几乎不可见）或深底蓝点（用户已明确否决）。这里把两处真值钉死。
 *
 * 【判据来源】浅色皮肤清单从 `tokens/skins.ts` 的 `variant` 字段派生，不复用手写列表，
 *   保证新增浅色皮肤必须同步覆盖块，否则本条直接红。
 *
 * 【约束与规则】只读取文本与真值表，不启动浏览器；变量名统一为 ink（不再带 blue 前缀）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const CSS_REL = 'packages/desktop/src/renderer/styles.css';
const CSS = fs.readFileSync(path.join(ROOT, CSS_REL), 'utf8');
const CONVERSATION_CSS = fs.readFileSync(path.join(ROOT, 'packages/ui/src/styles/conversation.css'), 'utf8');

function loadSkins() {
  const entry = path.join(ROOT, 'packages/ui/src/tokens/skins.ts').replace(/\\/g, '/');
  const script = `import('file:///${entry}').then(m => process.stdout.write(JSON.stringify(m.SKINS)))`;
  return JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', '-e', script], { encoding: 'utf8' }));
}

const SKINS = loadSkins();
const LIGHT_SKIN_IDS = Object.entries(SKINS)
  .filter(([, skin]) => skin.variant === 'light')
  .map(([id]) => id);
const DARK_SKIN_IDS = Object.entries(SKINS)
  .filter(([, skin]) => skin.variant === 'dark')
  .map(([id]) => id);

/** 取 :root 首个块（基础值）。 */
function rootBlock() {
  const start = CSS.indexOf(':root {');
  assert.ok(start > -1, 'styles.css 缺少 :root 基础块');
  const end = CSS.indexOf('}', start);
  return CSS.slice(start, end + 1);
}

/** 取浅色覆盖块（[data-appearance="light"] 那一组选择器）。 */
function lightBlock() {
  const start = CSS.indexOf('[data-appearance="light"]');
  assert.ok(start > -1, 'styles.css 缺少浅色外观覆盖块');
  const open = CSS.indexOf('{', start);
  const end = CSS.indexOf('}', open);
  return CSS.slice(start, end + 1);
}

const INK_VARS = [
  '--flux-activity-ink',
  '--flux-activity-ink-done',
  '--flux-activity-ink-soft',
  '--flux-activity-ink-label',
];

/**
 * 四档变量必须各自恰好声明一次，且全文件只允许两处声明（深色基础 + 浅色覆盖）。
 * 【为什么】值断言只能证明"存在一条正确声明"：块内追加同名声明时 CSS 后写生效，
 *   块外再开一个 :root 同样后写生效——界面实际已变色而测试仍绿。计数前先剥注释，
 *   避免注释里写到变量名被误判成重复声明。
 */
function assertDeclaredOnce(block, scope) {
  const clean = block.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const name of INK_VARS) {
    const hits = (clean.match(new RegExp(`${name}:`, 'g')) ?? []).length;
    assert.equal(hits, 1, `${scope} 的 ${name} 必须恰好声明一次（重复声明会让后写的值静默生效）`);
  }
}

test('全文件声明面：四档墨色只允许深色基础与浅色覆盖各一份', () => {
  const clean = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const name of INK_VARS) {
    const hits = (clean.match(new RegExp(`${name}:`, 'g')) ?? []).length;
    assert.equal(hits, 2, `${name} 全文件必须恰好声明两次（:root + 浅色覆盖块），块外再声明会覆盖真值`);
  }
});

test('深色基础值：:root 的四档墨色必须精确等于亮白系真值', () => {
  const block = rootBlock();
  // 四档逐值钉死：只断言"存在"时，把 done 改回纯白或把 soft 调浓都能静默通过。
  assert.match(block, /--flux-activity-ink:\s*#FFFFFF;/i, '深色颗粒墨色必须是 #FFFFFF（用户明确要求深色用亮白）');
  assert.match(block, /--flux-activity-ink-done:\s*rgba\(255,\s*255,\s*255,\s*0\.64\)/i, '深色完成态墨色必须是 64% 白（与运行态拉开档位）');
  assert.match(block, /--flux-activity-ink-soft:\s*rgba\(255,\s*255,\s*255,\s*0\.06\)/i, '深色雾层墨色必须是 6% 白（浓了会把稀疏点糊成一团）');
  assert.match(block, /--flux-activity-ink-label:\s*rgba\(255,\s*255,\s*255,\s*0\.88\)/i, '深色状态词必须是 88% 白（比颗粒低一档，不抢标题）');
  assertDeclaredOnce(block, '深色 :root');
});

test('浅色覆盖：外观开关与全部浅色皮肤都被覆盖，且四档回落到蓝系真值', () => {
  const block = lightBlock();
  assert.match(block, /\[data-appearance="light"\]/, '必须覆盖 appearance=light 切换路径');
  for (const id of LIGHT_SKIN_IDS) {
    assert.ok(block.includes(`[data-theme="${id}"]`), `浅色皮肤 ${id} 必须出现在覆盖块，否则会继承深色白点变成浅底白点`);
  }
  assert.match(block, /--flux-activity-ink:\s*#2563EB;/i, '浅色颗粒墨色必须回落为蓝 #2563EB');
  assert.match(block, /--flux-activity-ink-done:\s*#1D4ED8;/i, '浅色完成态墨色必须是深蓝 #1D4ED8（白勾在浅底上不可见）');
  assert.match(block, /--flux-activity-ink-soft:\s*rgba\(37,\s*99,\s*235,\s*0\.14\)/i, '浅色雾层墨色必须是 14% 蓝');
  assert.match(block, /--flux-activity-ink-label:\s*#2563EB;/i, '浅色状态词必须是 #2563EB');
  assertDeclaredOnce(block, '浅色覆盖块');
});

test('深色皮肤不得被浅色覆盖块误伤', () => {
  const block = lightBlock();
  assert.ok(DARK_SKIN_IDS.length >= 1, '真值表必须至少存在一个深色皮肤');
  for (const id of DARK_SKIN_IDS) {
    assert.equal(block.includes(`[data-theme="${id}"]`), false, `深色皮肤 ${id} 不得出现在浅色覆盖块`);
  }
});

test('旧变量名清零：样式表与组件不得再出现 blue 前缀的活动指示器变量', () => {
  assert.equal(CSS.includes('--flux-activity-blue'), false, 'styles.css 仍残留 --flux-activity-blue，值已是白/蓝双极，名字会误导后续维护');
  assert.equal(CONVERSATION_CSS.includes('--flux-activity-blue'), false, 'conversation.css 仍残留 --flux-activity-blue');
});

test('运行状态词走独立档位：不得直接用颗粒主色（满白会抢过会话标题）', () => {
  const start = CONVERSATION_CSS.indexOf('.flux-cloud-label--running {');
  assert.ok(start > -1, '缺少运行状态词规则');
  const end = CONVERSATION_CSS.indexOf('}', start);
  const rule = CONVERSATION_CSS.slice(start, end + 1);
  assert.match(rule, /color:\s*var\(--flux-activity-ink-label\)/, '运行状态词必须走 ink-label 档位');
  assert.equal(/color:\s*var\(--flux-activity-ink\)\s*;/.test(rule), false, '运行状态词不得直接取颗粒主色');
});
