/**
 * PR-3a 双审七项清偿的守卫测试。
 *
 * 每项对应一条复审登记项，全部断言"机器可判定的事实"而不是文案：
 *   ① SKIN_IDS 必须由 SKINS ∪ SKIN_ALIASES 派生，禁止第三份手写注册表
 *   ② 连接绿灯必须由 data-status 驱动，禁止 :has([title="在线"]) 文案选择器
 *   ③ 顶栏不得再有 gatewayLatencyMs 死字段与 profile 下拉
 *   ④ 呼吸动效不得裸 infinite；孤儿 keyframes 必须删除或接入集中时钟
 *   ⑤ react-shell 断言不得锁死中文字面量
 *   ⑥ Tailwind @source 白名单收紧，产物不得混入 arbitrary 垃圾 utility
 *   ⑦ barrel 裸浏览器导入必须有探针守卫
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

test('① SKIN_IDS 由 SKINS ∪ SKIN_ALIASES 派生，不得手写第三份注册表', () => {
  const skins = read('packages/ui/src/tokens/skins.ts');
  const skinIdsLine = /export const SKIN_IDS[\s\S]*?;/.exec(skins);
  assert.ok(skinIdsLine, '必须存在导出的 SKIN_IDS');
  assert.doesNotMatch(skinIdsLine[0], /\[[^\]]*'[a-z-]+'\s*,/, 'SKIN_IDS 不得再手写字面量皮肤名');
  assert.match(skinIdsLine[0], /Object\.keys\(\s*SKINS\s*\)/, 'SKIN_IDS 必须从 SKINS 派生');
  assert.match(skinIdsLine[0], /Object\.keys\(\s*SKIN_ALIASES\s*\)/, 'SKIN_IDS 必须并入别名键');
});

test('① resolveSkinId 的取值集合与 SKINS/别名完全一致', async () => {
  const { SKINS, SKIN_ALIASES, SKIN_IDS, resolveSkinId } = await import('../dist/tokens/skins.js');
  const expected = [...Object.keys(SKINS), ...Object.keys(SKIN_ALIASES)].sort();
  assert.deepEqual([...SKIN_IDS].sort(), expected, 'SKIN_IDS 必须覆盖全部皮肤与别名');
  for (const id of expected) assert.equal(resolveSkinId(id), id, `${id} 必须被原样接受`);
  assert.equal(resolveSkinId('ghost-skin'), 'obsidian-gold', '未知皮肤必须回退默认皮肤');
});

test('② 连接绿灯由 data-status 驱动，禁止 :has([title="..."]) 文案选择器', () => {
  const styles = read('packages/desktop/src/renderer/styles.css');
  assert.doesNotMatch(styles, /:has\([^)]*title\s*=/, ':has 依赖标题文案的样式选择器已废弃，必须改 data-status');
  assert.match(styles, /\.status-dot\[data-status="connected"\]/, '状态点必须由 data-status 属性着色');
  assert.match(styles, /\.session-live-pulse\[data-connected="true"\]/, '顶栏脉冲必须由 data-connected 属性着色');

  const titlebar = read('packages/ui/src/components-react/Titlebar.tsx');
  assert.match(titlebar, /data-connected=\{gatewayConnected\}/, 'React 顶栏必须输出 data-connected 属性');
});

test('③ 顶栏已无 profile 下拉与 gatewayLatencyMs 死字段', () => {
  const titlebar = read('packages/ui/src/components-react/Titlebar.tsx');
  assert.doesNotMatch(titlebar, /profileName\s*[?:]/, '顶栏快照不得再带 profileName');
  assert.doesNotMatch(titlebar, /gatewayLatencyMs/, '顶栏不得再带延迟字段（状态栏是唯一延迟读数面）');
  assert.doesNotMatch(titlebar, /onSwitchProfile/, '顶栏不得再持有身份切换回调');

  const mountBridge = read('packages/ui/src/components-react/mount-shell-components.tsx');
  assert.doesNotMatch(mountBridge, /onSwitchProfile/, '挂载桥不得再转发身份切换');

  const styles = read('packages/desktop/src/renderer/styles.css');
  assert.doesNotMatch(styles, /\.titlebar-profile-select/, '已删除组件的样式必须同步清理');
});

test('④ 左轨活动指示器不得裸 infinite；样式表不得有孤儿 keyframes', () => {
  const rail = read('packages/ui/src/components-react/LeftRail.tsx');
  // 呼吸动效本轮不恢复（集中时钟任务另行接入），因此左轨禁止出现任何 infinite 动画
  assert.doesNotMatch(rail, /infinite/, '左轨不得引入无休止 CSS 动画，必须等集中时钟接入');

  const styles = read('packages/desktop/src/renderer/styles.css');
  const defined = [...styles.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
  const used = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'release', '__tests__'].includes(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|css)$/.test(entry.name)) continue;
      if (full.endsWith(path.join('renderer', 'styles.css'))) continue;
      const src = fs.readFileSync(full, 'utf8');
      for (const name of defined) if (new RegExp(`\\b${name}\\b`).test(src)) used.add(name);
    }
  };
  walk(path.join(REPO, 'packages'));

  const orphans = defined.filter((name) => !used.has(name));
  assert.deepEqual(orphans, [], `存在无人引用的孤儿 keyframes：${orphans.join(', ')}`);
  // 正向对照：仍有消费者时必须保留定义，不能靠"全删"通过
  assert.ok(defined.includes('flux-fade-in'), '正向对照：flux-fade-in 仍被多个组件消费，必须保留');
});

test('⑤ react-shell 断言不得锁死中文字面量文案', () => {
  const shellTest = read('packages/ui/__tests__/react-shell.test.mjs');
  const cjkInAssertions = shellTest
    .split('\n')
    .filter((line) => /assert\.(match|includes|equal)/.test(line))
    .filter((line) => /[\u4e00-\u9fa5]/.test(line) && !/['"`]/.test(line));
  assert.deepEqual(cjkInAssertions, [], '断言行里的中文只允许出现在失败提示里，禁止作为被断言的字面量');

  // 结构性断言必须存在：属性、ID、类名远比文案稳定
  assert.match(shellTest, /data-testid="react-titlebar"|react-titlebar/, '必须断言稳定的 data-testid');
  assert.match(shellTest, /toggle-inspector-btn/, '必须断言稳定 ID');
  // 状态文案必须改为断言 data 属性而非渲染后的中文串
  assert.match(shellTest, /data-status/, '连接态断言必须落在 data-status 上');
});

test('⑥ Tailwind 扫描面收紧：产物只含 React 岛用到的工具类', () => {
  const cssPath = path.join(REPO, 'packages/desktop/dist/renderer/tailwind.css');
  assert.ok(fs.existsSync(cssPath), '必须先 build:desktop 再跑本断言（产物缺失）');
  const css = fs.readFileSync(cssPath, 'utf8');

  // 正向对照：正常语义工具类必须存在，避免"产物为空所以通过"的假绿
  assert.ok(css.includes('.text-caption'), '正向对照：语义字号工具类必须存在');
  assert.ok(css.includes('.bg-sidebar'), '正向对照：皮肤语义背景必须存在');
  assert.ok(css.includes('.gap-2'), '正向对照：间距工具类必须存在');

  // 反向对照：docs/prototypes 里的原型任意值 class 不得泄漏进生产产物
  const prototypeLeaks = ['220px', '380px', '740px', '21px'].filter((size) => css.includes(`\\[${size}\\]}`));
  assert.deepEqual(prototypeLeaks, [], `原型页的任意值 class 泄漏进产物：${prototypeLeaks.join(', ')}`);

  const entry = read('packages/ui/src/tailwind-entry.css');
  assert.match(entry, /source\(none\)/, '必须显式关闭自动检测，改用白名单 @source');
  assert.match(entry, /@source\s+["']\.\/components-react\/\*\*\/\*\.tsx["']/, '必须只扫 React 组件目录');
  // 唯一的 @source 必须就是上面那条白名单，禁止额外追加宽泛扫描面
  const sources = [...entry.matchAll(/@source\s+["']([^"']+)["']/g)].map((m) => m[1]);
  assert.deepEqual(sources, ['./components-react/**/*.tsx'], `扫描面只允许一条白名单，当前：${sources.join(', ')}`);
});

test('⑦ barrel 裸浏览器导入探针：禁止在浏览器侧模块裸导入 ui barrel', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'release', '__tests__'].includes(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mjs|js)$/.test(entry.name)) continue;
      const src = fs.readFileSync(full, 'utf8');
      // HTML harness 与 CDP lane 直接以 <script type="module"> 加载的模块不得 import 裸 barrel
      if (/from\s+['"]@hermes-flux\/ui['"]/.test(src) && /harness|cdp-lane/.test(full)) {
        offenders.push(path.relative(REPO, full).split(path.sep).join('/'));
      }
    }
  };
  walk(path.join(REPO, 'packages'));
  assert.deepEqual(offenders, [], `浏览器侧模块禁止裸导入 ui barrel（须用组件直路径）：${offenders.join(', ')}`);

  // barrel 自身必须显式声明该边界，避免下一个人重犯
  const barrel = read('packages/ui/src/index.ts');
  assert.match(barrel, /仅供打包消费者使用/, 'barrel 必须保留边界声明');
});
