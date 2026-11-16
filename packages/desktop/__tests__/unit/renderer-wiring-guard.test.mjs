/**
 * 渲染器装配完整性守卫（Renderer Wiring Completeness Guard）
 *
 * 【设计意图 (Why)】
 *   commit 0786dfc 把 index.ts 压到 1500 行时，留下了 `let streamViewportManager!: StreamViewportManager;`
 *   这类「非空断言声明」却没有对应赋值。TS 的非空断言让编译器闭嘴，构建、typecheck、全量单测全部绿灯，
 *   直到 render() 首帧调用 `streamViewportManager.captureStreamAnchor()` 才抛 TypeError，界面全黑。
 *   这类缺陷的唯一有效防线是「结构性静态断言」：只要声明了 `!:`，源码里就必须存在赋值。
 *
 * 【防范历史坑（Pitfall）】
 *   stream-viewport-manager.test.mjs 与 desktop-stream-viewport.test.mjs 都直连领域类，
 *   永远绕不到 index.ts 的装配点——删掉装配行它们依然全绿。所以本文件必须读源码本体做断言，
 *   这是唯一能在缺陷复发时真实变红的位置。
 *
 * 【约束规则（Rules）】
 *   1. 断言对象是 TS 源码文本，不是 dist 产物：产物经过压缩会丢失声明形状；
 *   2. 每个 `!:` 声明必须在同一文件中出现 `name = `（非 `==`）赋值，且赋值行号早于任意读取行号；
 *   3. 允许白名单，但白名单条目必须写明「为什么不需要赋值」，不允许静默放行。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.resolve(__dirname, '../../src/renderer/index.ts');

/** 明确不需要赋值的声明（当前为空；新增条目必须写清理由）。 */
const ASSIGNMENT_EXEMPT = new Map([]);

/**
 * 找出所有 `let/const/var NAME!: Type` 形式的非空断言声明。
 *
 * 只匹配带 `!: ` 的延迟初始化声明；普通 `foo: Type` 类型标注与 `foo = value` 都不会命中。
 */
function findDefiniteAssertionDeclarations(source) {
  const declarations = [];
  const lines = source.split('\n');
  // `let a!: T;` / `let a!: T, b!: U;` / `const a!: T`
  const declRe = /(?:^|\s)(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*!:/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!declRe.test(line)) continue;
    // 一行可能有多条声明，全部提取
    const all = line.split(',').map((seg) => seg.trim());
    for (const seg of all) {
      const m = seg.match(/([A-Za-z_$][\w$]*)\s*!:/);
      if (m) declarations.push({ name: m[1], line: i + 1 });
    }
  }
  return declarations;
}

/**
 * 判断某名字是否在源码中拥有独立赋值语句（排除 `==`、`===`、`!==`、属性访问与解构）。
 */
function hasStandaloneAssignment(source, name) {
  const assignRe = new RegExp(
    `(?:^|[^\\w$.])${name.replace(/[$]/g, '\\$')}\\s*=(?!=)`,
    'g',
  );
  let match;
  while ((match = assignRe.exec(source)) !== null) {
    // 排除属性赋值（排除已由前导字符处理）与类型断言中的 `as`
    const after = source.slice(match.index + match[0].length);
    if (/^\s*>/.test(after)) continue; // 排除 =>
    return { found: true, index: match.index };
  }
  return { found: false, index: -1 };
}

/** 把字符偏移换算为 1 基行号。 */
function offsetToLine(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') line += 1;
  }
  return line;
}

test('渲染器非空断言声明必须有对应赋值（防「只声明未装配」缺陷复发）', async (t) => {
  const source = readFileSync(INDEX_PATH, 'utf8');

  await t.test('1. 本仓库确实存在非空断言声明（守卫不能空转）', () => {
    const declarations = findDefiniteAssertionDeclarations(source);
    assert.ok(
      declarations.length > 0,
      '未扫描到任何 `x!: T` 声明：说明守卫正则失效或 index.ts 已被重构，必须同步更新守卫，否则它在空转',
    );
  });

  await t.test('2. 每个 `!: ` 声明都存在赋值，且赋值早于首次读取', () => {
    const declarations = findDefiniteAssertionDeclarations(source);
    const problems = [];

    for (const decl of declarations) {
      if (ASSIGNMENT_EXEMPT.has(decl.name)) continue;
      const { found, index } = hasStandaloneAssignment(source, decl.name);
      if (!found) {
        problems.push(`「${decl.name}」(第 ${decl.line} 行) 只有声明没有赋值 —— render 首帧必然 TypeError，界面全黑`);
        continue;
      }
      const assignLine = offsetToLine(source, index);
      if (assignLine < decl.line) {
        problems.push(`「${decl.name}」(第 ${decl.line} 行) 的赋值在第 ${assignLine} 行，早于声明，等于没装配`);
      }
    }

    assert.deepEqual(problems, [], `存在未装配的非空断言声明：\n${problems.join('\n')}`);
  });

  await t.test('3. 本缺陷的原始攻击面已闭环：streamViewportManager 被真实装配', () => {
    // 直接钉死原始缺陷特征，防止后人「优化」时把装配改回仅声明
    assert.ok(
      /streamViewportManager\s*=\s*createDesktopStreamViewport\(/.test(source),
      'streamViewportManager 必须由 createDesktopStreamViewport 装配，不得退化为仅声明',
    );
    // 反向攻击：确保没有把装配误写成类型断言或空实现
    assert.ok(
      !/let\s+streamViewportManager\s*!:\s*StreamViewportManager\s*;?\s*$/m.test(source) ||
        /streamViewportManager\s*=\s*createDesktopStreamViewport\(/.test(source),
      '不允许只保留非空断言声明而没有装配调用',
    );
  });

  await t.test('4. 装配顺序：视口管理器必须在 promptNavigatorManager 之后（依赖 isJumpSettling）', () => {
    const viewportAssign = source.indexOf('streamViewportManager = createDesktopStreamViewport(');
    const promptNavCreate = source.indexOf('const promptNavigatorManager = new PromptNavigatorManager(');
    assert.ok(viewportAssign > 0, '未找到视口管理器装配行');
    assert.ok(promptNavCreate > 0, '未找到 promptNavigatorManager 构造行');
    assert.ok(
      viewportAssign > promptNavCreate,
      '视口管理器装配必须晚于 promptNavigatorManager，否则 isPromptJumpSettling 闭包读到未初始化对象',
    );
  });

  await t.test('5. 落定状态真值源唯一：index.ts 不得再声明独立副本', () => {
    // 三个状态若在 index.ts 里重新变成模块级 let，就与 streamSettleState 双份真值，贴底会抖动
    assert.ok(
      !/^let\s+initialBottomSettling\s*=/m.test(source),
      'initialBottomSettling 必须由 streamSettleState 持有，不得在 index.ts 重新声明模块级副本',
    );
    assert.ok(
      !/^let\s+settleMinFrames\s*=/m.test(source),
      'settleMinFrames 必须由 streamSettleState 持有',
    );
    assert.ok(
      !/^let\s+settledLayoutSignature\s*=/m.test(source),
      'settledLayoutSignature 必须由 streamSettleState 持有',
    );
  });

  await t.test('6. 提示词导航器挂载后必须回注 update 句柄（否则导航轨永不显示）', () => {
    /**
     * 【反向攻击的缺陷】
     *   Batch 5/7 把导航器挂载搬进 renderCoordinator 时，只把 React 的 update 赋给本地
     *   `updateReactPromptNavigator`，忘了调用 setUpdateHandler 回注给 PromptNavigatorManager。
     *   管理器 sync() 首行 `if (!this.updateReactPromptNavigator) return;` 因此静默短路，
     *   导航轨在所有会话下都不出现，且全程零报错、零日志——极难定位。
     *
     * 【约束】
     *   断言的是「挂载点之后确实调用了回注」，而不是调用顺序无关的任意位置出现，
     *   因此要求回注出现在 mountPromptNavigator( 之后。
     */
    const coordinatorSource = readFileSync(
      path.resolve(__dirname, '../../src/renderer/renderCoordinator.ts'),
      'utf8',
    );

    const mountAt = coordinatorSource.indexOf('mountPromptNavigator(');
    assert.ok(mountAt > 0, '未找到 mountPromptNavigator 挂载点');

    const regateAt = coordinatorSource.indexOf('deps.setPromptNavigatorUpdateHandler?.(');
    assert.ok(
      regateAt > 0,
      '挂载后必须调用 deps.setPromptNavigatorUpdateHandler 回注 update 句柄；缺失会让导航轨静默消失',
    );
    assert.ok(
      regateAt > mountAt,
      '回注必须发生在挂载之后（挂载成功才有 update 句柄可回注）',
    );

    // 管理器侧必须真的把句柄接上，否则回注等于丢进黑洞
    const managerSource = readFileSync(
      path.resolve(__dirname, '../../src/renderer/navigation/promptNavigatorManager.ts'),
      'utf8',
    );
    assert.match(
      managerSource,
      /public setUpdateHandler\(handler: \(\(\) => void\) \| null\): void \{\s*this\.updateReactPromptNavigator = handler;/,
      'setUpdateHandler 必须把句柄存进 updateReactPromptNavigator，否则 sync() 永远短路',
    );

    // index.ts 必须把 deps 回调接到真实管理器上，不能是空实现
    assert.match(
      source,
      /setPromptNavigatorUpdateHandler:\s*\(handler\)\s*=>\s*promptNavigatorManager\.setUpdateHandler\(handler\)/,
      'index.ts 必须把 setPromptNavigatorUpdateHandler 接到 promptNavigatorManager，禁止空实现',
    );
  });
});
