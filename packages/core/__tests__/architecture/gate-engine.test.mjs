/**
 * 门禁引擎自检（反假测试）
 *
 * 设计意图：门禁本身必须被门禁验证。本文件用「故意违规的 fixture」证明
 * 每条规则真的会红，用「合法写法」证明不会误报，避免出现永远绿灯的空壳门禁。
 *
 * 变异检验：把 rules.mjs 里任一 check 改成 return []，本文件必须立刻变红。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { stripComments, hasInlineAllowance } from '../../../../scripts/gates/lib/scanner.mjs';
import { RULES, isSkinSurface } from '../../../../scripts/gates/rules.mjs';

/** 用给定源码构造规则扫描上下文 */
function scan(relPath, source, ruleId) {
  const parsed = stripComments(source);
  const rules = ruleId ? RULES.filter((r) => r.id === ruleId) : RULES;
  assert.ok(rules.length > 0, `规则 ${ruleId} 必须存在`);
  return rules.flatMap((rule) => rule.check(relPath, { ...parsed, relPath, src: source }));
}

const COMPONENT = 'packages/ui/src/components/Probe/Probe.ts';

test('scanner: 注释遮蔽必须保留行号与换行位置', async (t) => {
  await t.test('块注释与行注释被遮蔽，字符串字面量原样保留', () => {
    const src = [
      'const a = 1; // 行注释 #FF0000',
      '/* 块注释',
      '   跨行 #00FF00 */',
      'const b = "#123456";',
    ].join('\n');
    const { stripped, rawLines } = stripComments(src);

    assert.equal(stripped.split('\n').length, rawLines.length, '遮蔽后行数必须与原始一致');
    assert.equal(stripped.length, src.length, '遮蔽后长度必须与原始一致（保证 index 可映射）');
    assert.ok(!stripped.includes('行注释'), '行注释必须被遮蔽');
    assert.ok(!stripped.includes('块注释'), '块注释必须被遮蔽');
    assert.ok(stripped.includes('"#123456"'), '字符串字面量必须保留');
  });

  await t.test('URL 中的 // 不得触发注释遮蔽（历史坑回归）', () => {
    const src = 'const url = "http://127.0.0.1:9119";\nconst x = 1;';
    const { stripped } = stripComments(src);
    assert.ok(stripped.includes('http://127.0.0.1:9119'), 'URL 必须完整保留');
    assert.ok(stripped.includes('const x = 1;'), 'URL 之后的行不得被吞掉');
  });

  await t.test('模板字符串内的 HTML 注释与 CSS 注释必须被遮蔽', () => {
    const src = [
      'const html = `',
      '  <!-- 思考下拉菜单 -->',
      '  <div>{/* 内联注释 */}</div>',
      '`;',
      'const after = 1;',
    ].join('\n');
    const { stripped, rawLines } = stripComments(src);
    assert.ok(!stripped.includes('思考下拉菜单'), 'HTML 注释必须被遮蔽');
    assert.ok(!stripped.includes('内联注释'), 'CSS/JSX 注释必须被遮蔽');
    assert.ok(stripped.includes('const after = 1;'), '注释结束后的代码必须恢复正常解析');
    assert.equal(stripped.split('\n').length, rawLines.length, '遮蔽不得吞掉换行');
  });

  await t.test('转义引号不得提前结束字符串态', () => {
    const src = String.raw`const s = 'it\'s a test'; const y = 2;`;
    const { stripped } = stripComments(src);
    assert.ok(stripped.includes('const y = 2;'), '转义引号后必须仍在字符串态内');
  });
});

/**
 * P0 回归：这三处缺陷曾真实存在且全部"通过"了原始 33 条测试，
 * 说明当时测试未覆盖关键路径。每一条都必须能独立证伪。
 */
test('扫描器 P0 回归（变异检验：对应实现缺陷复现则测试必红）', async (t) => {
  await t.test('嵌套模板字符串内的行注释不得吞掉后续源码', () => {
    const src = 'const a = `outer ${inner(`nested // x`)} tail`;\nconst b = "#38BDF8";';
    const { stripped, codeLines } = stripComments(src);
    assert.ok(stripped.includes('tail'), '`)} tail` 整段不得丢失');
    assert.equal(codeLines.length, 2, '换行数必须保持');
    assert.ok(stripped.includes('#38BDF8'), '后续真实代码必须保留');
  });

  await t.test('正则字面量内的反引号不得被当作模板字符串边界', () => {
    const src = [
      'const clean = text',
      "  .replace(/`([^`]+)`/g, '$1')",
      "  .trim();",
      '// 这行注释必须被剥离',
      "const color = '#38BDF8';",
    ].join('\n');
    const { codeLines } = stripComments(src);
    assert.ok(
      !codeLines[3].trim().startsWith('//'),
      '正则字面量之后的行注释必须被正确剥离（正则内反引号不得开启模板态）',
    );
  });

  await t.test('字符串态闭合必须还原进入前状态（状态栈不得被丢弃）', () => {
    // 模板内插值里再套字符串，字符串闭合后必须回到 interpolation，而非 code
    const src = "const a = `${obj['key']} tail`;\n// 行注释\nconst b = 1;";
    const { codeLines } = stripComments(src);
    assert.ok(!codeLines[1].trim().startsWith('//'), '模板内插值闭合后行注释必须仍被剥离');
    assert.ok(codeLines[2].includes('const b = 1'), '后续代码必须留在代码态');
  });

  await t.test('4 位十六进制色值必须被检出（曾全部漏报）', () => {
    const rule = RULES.find((r) => r.id === 'theme');
    // 注意：#fffc / #0008 是「纯白/纯黑 + 4 位短写 alpha」，属于中性遮蔽色，必须放行。
    // 只有带色相的 4 位值才应拦截。
    for (const c of ['#ABCD', '#f00f', '#38B4', '#0908', '#abcD']) {
      const parsed = stripComments(`const c = '${c}';`);
      const v = rule.check(COMPONENT, { ...parsed, src: '' });
      assert.equal(v.length, 1, `带色相的 4 位色值 ${c} 必须被拦截`);
    }
  });

  await t.test('8 位与空格语法的中性遮蔽色必须放行（曾全量误报）', () => {
    const rule = RULES.find((r) => r.id === 'theme');
    for (const c of ['#00000080', '#FFFFFF1A', '#fffc', '#0008', 'rgb(0 0 0)', 'rgb(0 0 0 / 50%)', 'rgba(255 255 255 / 0.1)']) {
      const parsed = stripComments(`const c = '${c}';`);
      const v = rule.check(COMPONENT, { ...parsed, src: '' });
      assert.equal(v.length, 0, `中性遮蔽色 ${c} 不得误报`);
    }
  });

  await t.test('跨行书写的 infinite 动画必须被检出（曾漏报）', () => {
    const rule = RULES.find((r) => r.id === 'perf');
    const src = ["el.style.animation = 'pulse 2s';", 'el.style.animationIterationCount = "infinite";'].join('\n');
    const parsed = stripComments(src);
    const v = rule.check(COMPONENT, { ...parsed, src });
    assert.ok(v.some((x) => x.ruleId === 'perf/infinite-animation'), '跨行 infinite 必须命中');
  });
});

test('Gate 0 架构规则', async (t) => {
  await t.test('core 依赖 ui 必须被拦截', () => {
    const v = scan('packages/core/src/probe.ts', "import { x } from '@hermes-flux/ui';\n");
    assert.equal(v.length, 1, '必须产生 1 条违规');
    assert.equal(v[0].ruleId, 'arch/layer-direction');
  });

  await t.test('ui 依赖 electron 必须被拦截', () => {
    const v = scan('packages/ui/src/probe.ts', "import { ipc } from 'electron';\n");
    assert.equal(v.length, 1);
    assert.equal(v[0].ruleId, 'arch/layer-direction');
  });

  await t.test('as any 类型逃逸必须被拦截', () => {
    const v = scan('packages/core/src/probe.ts', 'const a = payload as any;\n');
    assert.equal(v.length, 1);
    assert.equal(v[0].ruleId, 'arch/type-escape');
  });

  await t.test('渲染层自建裸 fetch 必须被拦截', () => {
    const v = scan('packages/desktop/src/renderer/index.ts', 'const r = await fetch("http://x");\n');
    assert.equal(v.length, 1);
    assert.equal(v[0].ruleId, 'arch/no-bare-transport');
  });

  await t.test('显式豁免注释必须生效', () => {
    const src = '// gate-arch-allow: 该处为迁移期兼容桥接\nconst a = payload as any;\n';
    const v = scan('packages/core/src/probe.ts', src);
    assert.equal(v.length, 0, '带显式豁免注释的违规必须放行');
  });
});

test('Gate 4a 换肤规则', async (t) => {
  await t.test('带色相硬编码色必须被拦截', () => {
    const v = scan(COMPONENT, "const c = '#38BDF8';\n");
    assert.equal(v.length, 1);
    assert.equal(v[0].ruleId, 'theme/no-hardcoded-color');
    assert.match(v[0].message, /#38BDF8/);
  });

  await t.test('中性遮蔽色（纯黑白叠层）必须放行', () => {
    const src = [
      "const a = 'rgba(0, 0, 0, 0.45)';",
      "const b = 'rgba(255,255,255,0.10)';",
      "const c = '#000';",
      "const d = '#fff';",
    ].join('\n');
    const v = scan(COMPONENT, src);
    assert.equal(v.length, 0, `中性遮蔽色不得误报，实际 ${v.length} 条`);
  });

  await t.test('HTML 实体 &#039; 不得被误判为 3 位色值', () => {
    const v = scan(COMPONENT, ".replace(/'/g, '&#039;');\n");
    assert.equal(v.length, 0, 'HTML 实体不是颜色字面量');
  });

  await t.test('Design Tokens 权威柜台（tokens 目录）不参与扫描', () => {
    const v = scan('packages/ui/src/tokens/tokens.ts', "const accent = '#F59E0B';\n");
    assert.equal(v.length, 0, '调色板定义本身就是颜色权威源');
  });

  await t.test('CSS 变量引用必须放行', () => {
    const v = scan(COMPONENT, 'color: var(--accent); background: var(--bg-card);\n');
    assert.equal(v.length, 0, 'Token 引用不得误报');
  });

  await t.test('注释中的色值示例不得误报', () => {
    const v = scan(COMPONENT, '// 例如旧实现写死 #090A0F，现在必须走 var(--bg-window)\nconst x = 1;\n');
    assert.equal(v.length, 0, '注释里的示例色值不是真实违规');
  });
});

test('Gate 4b i18n 规则', async (t) => {
  await t.test('硬编码中文文案必须被拦截', () => {
    const v = scan(COMPONENT, "const s = '已连接';\n");
    assert.equal(v.length, 1);
    assert.equal(v[0].ruleId, 'i18n/no-hardcoded-text');
  });

  await t.test('字典权威源文件必须豁免', () => {
    const v = scan('packages/ui/src/i18n/index.ts', "export const zhDict = { a: '已连接' };\n");
    assert.equal(v.length, 0, '字典本身必须允许中文');
  });

  await t.test('模板字符串中的 HTML 注释文案不得误报', () => {
    const v = scan(COMPONENT, 'const h = `<!-- 思考下拉菜单 --><div></div>`;\n');
    assert.equal(v.length, 0, 'HTML 注释里的中文不是 UI 文案');
  });

  await t.test('t() 调用必须放行', () => {
    const v = scan(COMPONENT, 'const s = t("status.connected");\n');
    assert.equal(v.length, 0);
  });

  await t.test('i18n 豁免注释必须生效', () => {
    const v = scan(COMPONENT, "// gate-i18n-allow: 该字符串用于网关协议错误码匹配\nconst s = '认证失败';\n");
    assert.equal(v.length, 0);
  });
});

test('Gate 4c 性能规则', async (t) => {
  await t.test('无限动画必须被拦截', () => {
    const v = scan(COMPONENT, "el.style.animation = 'pulse 2s infinite ease-in-out';\n");
    assert.equal(v.length, 1);
    assert.equal(v[0].ruleId, 'perf/infinite-animation');
  });

  await t.test('scroll-behavior smooth 必须被拦截', () => {
    const v = scan(COMPONENT, '.stream { scroll-behavior: smooth; }\n');
    assert.equal(v.length, 1);
    assert.equal(v[0].ruleId, 'perf/smooth-scroll');
  });

  await t.test('content-visibility 高度估算必须被拦截', () => {
    const v = scan(COMPONENT, '.row { content-visibility: auto; contain-intrinsic-size: 100px; }\n');
    assert.ok(v.length >= 1, '必须命中估算高度规则');
    assert.equal(v[0].ruleId, 'perf/estimated-height');
  });

  await t.test('渲染热路径 Intl 格式化必须被拦截', () => {
    const v = scan(COMPONENT, 'const s = new Date().toLocaleTimeString();\n');
    assert.equal(v.length, 1);
    assert.equal(v[0].ruleId, 'perf/intl-in-hot-path');
  });

  await t.test('纯算术时间格式化必须放行', () => {
    const v = scan(COMPONENT, 'const pad = (n) => String(n).padStart(2, "0");\n');
    assert.equal(v.length, 0);
  });
});

test('规则作用域边界', async (t) => {
  await t.test('core 包不属于换肤面，不应触发主题/i18n 规则', () => {
    assert.equal(isSkinSurface('packages/core/src/rpc/client.ts'), false);
    const v = scan('packages/core/src/rpc/client.ts', "const c = '#38BDF8';\nconst s = '已连接';\n");
    assert.equal(v.length, 0, 'core 是平台无关逻辑层，不参与 UI 门禁');
  });

  await t.test('豁免注释只对相邻违规行生效', () => {
    const rawLines = ['// gate-theme-allow: 说明', '', "const c = '#38BDF8';"];
    assert.equal(hasInlineAllowance(rawLines, 2, 'theme'), false, '中间隔空行不得继承豁免');
    assert.equal(hasInlineAllowance(rawLines, 1, 'theme'), true, '相邻上一行必须生效');
  });
});
