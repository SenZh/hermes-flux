/* ------------------------------------------------------------------ *
 * Gate 4e · 视觉契约（React 岛 / 样式表）
 * ------------------------------------------------------------------ */

/**
 * 【设计意图 (Why)】
 *   设计系统（docs/design-system/README.md）把圆角、阴影、字阶、配色收敛成有限语义档位，
 *   但「组件该怎么写类名」此前没有任何门禁约束。AI 生成的组件天然会写 rounded-md /
 *   shadow-lg / text-sm / bg-zinc-800 —— 这几类写法在公开语料里出现频率最高，
 *   于是同一张卡片在不同组件里圆角 4/6/8/12px 混用，硬编码灰阶也无法随皮肤切换。
 *   本组规则把「视觉契约」变成可执行断言：违规即给出目标档位与像素值，让 AI 与人类
 *   在提交前就拿到可直接照做的修复指令，而不是一句抽象的「不符合设计系统」。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 对整文件正则硬扫会把注释里的示例、i18n 文案、正则字面量一起误报，
 *      所以只分析「类名上下文字符串字面量区间」，其余文本一概不看；
 *   2. JSX 的 className={cn( ... )} 是跨行写法，逐行扫描必然漏检，
 *      因此先做全文区间提取、再用字符偏移反查行号（与 perfRules 的 fullTextRe 同口径）；
 *   3. 阻断型规则若上线即命中存量，门禁当天就会变红、随后被 --update-baseline 吃掉，
 *      永久失效。所以「当前存量非零」的两类（任意值 / 小数间距）只走 ctx.warnings：
 *      不阻断但每次运行都可见，既不清零判定也不制造假绿；
 *   4. 兜底值漂移（var(--radius-inner, 6px) 对 :root 的 4px）是最隐蔽的一类：
 *      真值缺失时才生效，本地「看起来没问题」，换皮肤/换客户端才暴露，
 *      所以必须与 :root 真值面逐条比对，而不是只看兜底值本身是否「像个数字」。
 *
 * 【约束与规则 (Rules)】
 *   - 作用域严格限定 React 岛与样式表（见 isVisualSurface），其它路径一律返回空；
 *   - 每条 message 必须同时是诊断 + 可执行修复指令（含目标档位与像素值）；
 *   - 全部支持行内豁免：违规行或其上一行写 `// gate-theme-allow: 理由`；
 *   - 合法档位：rounded-inner|card|panel|window|full、shadow-card|window|dock、
 *     text-hero|title|section|body|aux|caption|micro。
 */

import fs from 'node:fs';
import path from 'node:path';
import { hasInlineAllowance, lineAt, matchAll, REPO_ROOT } from '../lib/scanner.mjs';

/** 视觉契约作用域：React 岛 + 样式表（其余路径一律不管，避免波及存量模板组件） */
export function isVisualSurface(rel) {
  return (
    rel.startsWith('packages/ui/src/components-react/') ||
    rel.startsWith('packages/ui/src/styles/') ||
    rel === 'packages/desktop/src/renderer/styles.css'
  );
}

/** 承载类名字符串的工厂/合并函数：命中这些调用的字面量才算类名上下文 */
const CLASS_CALL_FNS = new Set(['cn', 'cx', 'cva', 'clsx', 'classNames', 'twMerge', 'twJoin', 'tv']);

const QUOTE_CHARS = new Set(["'", '"', '`']);
const isIdentChar = (c) => c !== undefined && /[A-Za-z0-9_$]/.test(c);

/**
 * 字面量文本是否「像一串 Tailwind 类名」。
 * 只用于弱上下文（对象属性值 / 变量赋值）兜底，避免把 i18n key、路径串误判成类名。
 */
function looksLikeClassList(text) {
  for (const raw of text.split(/\s+/)) {
    if (!raw) continue;
    const seg = raw.split(':').pop() ?? raw;
    if (seg.includes('[')) return true;
    if (/^[a-z][a-z0-9]*(?:-[a-z0-9./]+)+$/i.test(seg)) return true;
  }
  return false;
}

/**
 * 判断某个字符串字面量是否处于「类名上下文」。
 *
 * 强上下文：className=/class=/classList= 直接赋值、JSX 花括号表达式内、或处于 cn/cva 等调用实参中；
 * 弱上下文：最近 200 字符内出现 *CLASS / *STYLE / *VARIANT / *TONE 之类的映射表键或赋值
 *          （此时还要求字面量内容确实像类名列表）。
 */
function classContextOf(src, quoteStart, callStack) {
  for (const name of callStack) {
    if (name && CLASS_CALL_FNS.has(name)) return 'strong';
  }
  const back = src.slice(Math.max(0, quoteStart - 200), quoteStart);
  /**
   * `[^{};]*\{?[^{};]*$` 是这里的关键边界：允许跨过**一个**花括号（JSX 表达式 / 对象字面量），
   * 但绝不跨过 `;` 或 `}`，所以判定范围天然被限制在当前语句内——
   * 否则整文件里第一个 className 会把后面所有字符串都判成类名。
   */
  if (/(?:\bclassName|\bclass|\bclassList)\s*[:=]\s*[^{};]*\{?[^{};]*$/.test(back)) return 'strong';
  /**
   * 弱上下文：类名映射表（LEVEL_CLASS / TONE_CLASS / variants / styles 等）与变量赋值。
   * 组件库最常见的写法是 `const LEVEL_CLASS: Record<string, string> = { panel: 'bg-panel' }`，
   * 它既不在 className 属性里也不在 cn() 实参里；不认这一条，
   * AI 只要把类名挪进映射表就能整张绕过门禁。
   * 代价是必须再要求字面量内容「像类名列表」，否则 variant="ghost" / font-style 会被误判。
   */
  if (/\b\w*(?:class|style|variant|tone)\w*\s*[:=]\s*[^{};]*\{?[^{};]*$/i.test(back)) return 'weak';
  return null;
}

/** 判断 pos 处的 `/` 是否开启正则字面量（与 scanner 的判定口径一致） */
function startsRegexLiteral(src, pos) {
  let j = pos - 1;
  while (j >= 0 && /\s/.test(src[j])) j -= 1;
  const prev = j >= 0 ? src[j] : '';
  if (prev === '') return true;
  if (/[(,=:[!&|?{};+\-*%^~<>]/.test(prev)) return true;
  return /\b(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)\s*$/.test(
    src.slice(Math.max(0, j - 12), j + 1),
  );
}

/**
 * 提取全部「类名上下文字符串字面量」区间。
 *
 * 单次线性扫描，同时维护调用栈（识别 cn/cva 实参）、跳过正则字面量（其中的 () 会污染调用栈）、
 * 并在 `;` 处清栈兜底：即便个别语法让栈漂移，污染也局限在单条语句内。
 *
 * @returns {{start: number, end: number, text: string}[]} start/end 为 stripped 中的字符偏移（不含引号）
 */
function collectClassRegions(src) {
  const out = [];
  const n = src.length;
  const callStack = [];
  let lastIdent = '';
  let i = 0;

  while (i < n) {
    const c = src[i];

    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === ';') {
      callStack.length = 0;
      lastIdent = '';
      i += 1;
      continue;
    }
    if (c === '(') {
      callStack.push(lastIdent);
      lastIdent = '';
      i += 1;
      continue;
    }
    if (c === ')') {
      callStack.pop();
      lastIdent = '';
      i += 1;
      continue;
    }
    if (QUOTE_CHARS.has(c)) {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === c) break;
        if (src[j] === '\n' && c !== '`') break; // 未闭合的单/双引号，按行截断
        j += 1;
      }
      const end = Math.min(j, n);
      const text = src.slice(i + 1, end);
      const kind = end > i + 1 ? classContextOf(src, i, callStack) : null;
      if (kind === 'strong' || (kind === 'weak' && looksLikeClassList(text))) {
        out.push({ start: i + 1, end, text });
      }
      i = end + 1;
      lastIdent = '';
      continue;
    }
    if (c === '/' && startsRegexLiteral(src, i)) {
      let k = i + 1;
      let inClass = false;
      let closed = false;
      while (k < n) {
        const ch = src[k];
        if (ch === '\\') {
          k += 2;
          continue;
        }
        if (ch === '\n') break;
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) {
          closed = true;
          break;
        }
        k += 1;
      }
      i = closed ? k + 1 : i + 1;
      lastIdent = '';
      continue;
    }
    if (isIdentChar(c)) {
      let j = i;
      while (j < n && isIdentChar(src[j])) j += 1;
      lastIdent = src.slice(i, j);
      i = j;
      continue;
    }
    lastIdent = '';
    i += 1;
  }

  return out;
}

/** 类名区间按 ctx 缓存：同一文件 7 条规则共享一次解析（ctx 每次扫描独立创建，WeakMap 天然不串味） */
export const classRegionCache = new WeakMap();
function getClassRegions(ctx) {
  let regions = classRegionCache.get(ctx);
  if (!regions) {
    regions = collectClassRegions(ctx.stripped);
    classRegionCache.set(ctx, regions);
  }
  return regions;
}

/**
 * 在全部类名区间内跑一条正则，命中后换算行号、应用行内豁免并去重（同行同类只报一次）。
 */
function forEachClassMatch(ctx, re, emit) {
  const seen = new Set();
  for (const region of getClassRegions(ctx)) {
    const scan = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    let m;
    while ((m = scan.exec(region.text)) !== null) {
      const token = m[0];
      const lineNo = lineAt(ctx.stripped, region.start + m.index);
      const key = `${lineNo}\u0000${token}`;
      if (seen.has(key)) {
        if (m.index === scan.lastIndex) scan.lastIndex += 1;
        continue;
      }
      seen.add(key);
      if (!hasInlineAllowance(ctx.rawLines, lineNo - 1, 'theme')) {
        emit({ line: lineNo, lineIdx: lineNo - 1, token, groups: m });
      }
      if (m.index === scan.lastIndex) scan.lastIndex += 1;
    }
  }
}

/**
 * 类名 token 型规则的统一工厂（阻断 / 警告共用同一套判定与豁免，避免两套口径）。
 */
export function makeClassTokenRule({ id, title, pattern, buildMessage, severity = 'blocking' }) {
  return {
    id,
    gate: 'Gate 4',
    title,
    check(file, ctx) {
      if (!isVisualSurface(file)) return [];
      if (!ctx.warnings) ctx.warnings = [];
      const out = [];
      const snippetOf = (lineIdx) => (ctx.rawLines[lineIdx] ?? '').trim().slice(0, 110);

      forEachClassMatch(ctx, pattern, (hit) => {
        const message = buildMessage(hit);
        if (severity === 'warning') {
          ctx.warnings.push({
            file,
            line: hit.line,
            lineIdx: hit.lineIdx,
            ruleId: id,
            message: `[${id}] :${hit.line} ${message}`,
          });
          return;
        }
        out.push({
          file,
          line: hit.line,
          lineIdx: hit.lineIdx,
          ruleId: id,
          message,
          snippet: snippetOf(hit.lineIdx),
        });
      });

      return out;
    },
  };
}

/** 原生调色板 → 语义 Token 的修复指引（统一出口，避免每条规则各写一套推荐词） */
const PALETTE_FAMILY =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black';

export const noRawPalette = makeClassTokenRule({
  id: 'visual/no-raw-palette',
  title: '视觉契约 · 禁止 Tailwind 原生调色板（硬编码色相）',
  pattern: new RegExp(
    `\\b(?:bg|text|border|ring|divide|outline|from|via|to|fill|stroke|shadow|accent|caret|decoration|placeholder)-(?:${PALETTE_FAMILY})\\b`,
  ),
  buildMessage: ({ token }) =>
    `禁止原生调色板类 ${token}（硬编码色相，切皮肤后仍是同一块灰）：改用语义 Token 类 bg-card / bg-panel / bg-input / text-foreground / text-muted-foreground / border-border-subtle / text-primary，色板见 docs/design-system/04-tokens-and-design-system-spec.md`,
});

/** 旧圆角档 → 语义档（映射来自 packages/ui/src/tailwind-entry.css 的 --radius-* 桥接，像素值以 styles.css :root 为准） */
const LEGACY_RADIUS_FIX = {
  sm: 'rounded-inner（4px 控件圆角）',
  md: 'rounded-card（6px 卡片圆角）',
  lg: 'rounded-panel（8px 面板圆角）',
  xl: 'rounded-window（12px 窗口/浮层圆角）',
  '2xl': 'rounded-window（12px 窗口/浮层圆角）',
  '3xl': 'rounded-window（12px 窗口/浮层圆角）',
};

export const noLegacyRadius = makeClassTokenRule({
  id: 'visual/no-legacy-radius',
  title: '视觉契约 · 禁止 rounded-sm/md/lg/xl 旧档位（无语义圆角）',
  // 方向变体（rounded-t-md 等）与基准档同罪：两者最终都吃同一套无语义数值
  pattern: /\brounded(?:-[trblse]{1,2})?-(2xl|3xl|sm|md|lg|xl)\b/,
  buildMessage: ({ token, groups }) =>
    `禁止 ${token}（无语义圆角档位）：改用 ${LEGACY_RADIUS_FIX[groups[1]] ?? 'rounded-card（6px）'}，其内再嵌一层控件用 rounded-inner（4px 控件圆角）；合法档仅 rounded-inner|card|panel|window|full`,
});

const LEGACY_SHADOW_FIX = {
  '2xs': 'shadow-card（卡片微投影）',
  xs: 'shadow-card（卡片微投影）',
  sm: 'shadow-card（卡片微投影）',
  md: 'shadow-card（卡片微投影）',
  lg: 'shadow-window（窗口/浮层投影）',
  xl: 'shadow-window（窗口/浮层投影）',
  '2xl': 'shadow-window（窗口/浮层投影）',
  inner: '无内阴影档位：改用 border 或 ring（内阴影会压穿 L0~L4 表面阶梯）',
};

export const noShadowScale = makeClassTokenRule({
  id: 'visual/no-shadow-scale',
  title: '视觉契约 · 禁止 shadow-sm/md/lg/xl 旧档位（无语义投影）',
  pattern: /\bshadow-(2xs|xs|sm|md|lg|xl|2xl|inner)\b/,
  buildMessage: ({ token, groups }) =>
    `禁止 ${token}（无语义投影档位）：改用 ${LEGACY_SHADOW_FIX[groups[1]] ?? 'shadow-card'}；合法档仅 shadow-card|window|dock（shadow-none 合法）`,
});

/* ------------------------------------------------------------------ *
 * Gate 4e · 字体族契约
 * ------------------------------------------------------------------ */

/**
 * ui/no-raw-font-family（类名侧）
 *
 * 设计意图 (Why)：
 *   全系统只有两种字体角色：界面字体与代码字体，二者都是皮肤槽位（--font-sans / --font-mono），
 *   由设置页在运行时写进 :root，用户换字体后所有组件必须一起变。
 *   Tailwind 默认的 font-sans / font-serif / font-mono 各自携带一套写死的字体栈，
 *   一旦被使用，该组件就永久脱离用户偏好，且状态栏、代码块、输入框会各自不一致。
 *
 * 防范的历史坑 (Pitfall)：
 *   tailwind-entry.css 已用 `--font-*: initial` 把这些类物理清空，
 *   因此本规则属于第二道防线——防止有人为了"让它有样式"又在 @theme 里把默认栈加回来。
 *
 * 约束与规则 (Rules)：
 *   合法写法只有 font-ui（界面字体）与 font-code（代码字体）；
 *   确需一次性特例时写行内豁免 `// gate-theme-allow: 理由`。
 */
export const noRawFontFamily = makeClassTokenRule({
  id: 'visual/no-raw-font-family',
  title: '视觉契约 · 字体族只允许 font-ui / font-code（禁止写死字体栈）',
  pattern: /\bfont-(sans|serif|mono)\b/,
  buildMessage: ({ token }) =>
    `禁止 ${token}（Tailwind 默认字体栈，绕开用户字体设置）：界面文字用 font-ui，代码/终端/等宽读数用 font-code；两者分别消费皮肤槽位 --font-sans / --font-mono`,
});

/**
 * ui/no-raw-font-family-decl（样式表侧）
 *
 * 设计意图 (Why)：
 *   类名侧只能管 React 岛，遗留样式表里的 `font-family: "JetBrains Mono", ...`
 *   同样会让组件脱离用户偏好。这条规则覆盖 .css 面，要求一律写成 var(--font-*)。
 *
 * 豁免：
 *   1. `@font-face` 块内的 font-family 是字体注册本身，不是消费点；
 *   2. CSS 全局关键字 inherit / initial / unset / revert 属于继承语义，不携带字体真值。
 */
export const noRawFontFamilyDecl = {
  id: 'visual/no-raw-font-family-decl',
  gate: 'Gate 4',
  title: '视觉契约 · 样式表不得裸写字体栈（必须 var(--font-*)）',
  cssAware: true,
  check(file, ctx) {
    if (!isVisualSurface(file)) return [];
    if (!/\.css$/.test(file)) return [];

    const CSS_WIDE = /^(?:inherit|initial|unset|revert|revert-layer)$/i;
    const out = [];
    const src = ctx.stripped;
    const re = /font-family\s*:\s*([^;}\n]+)/g;
    let m;

    while ((m = re.exec(src)) !== null) {
      const value = m[1].trim();
      if (value.length === 0) continue;
      if (/\bvar\(\s*--(?:font|conv-font|chat-text)/.test(value)) continue;
      if (CSS_WIDE.test(value)) continue;

      // @font-face 块内是字体注册，不是消费点
      const braceIdx = src.lastIndexOf('{', m.index);
      const header = braceIdx >= 0 ? src.slice(Math.max(0, braceIdx - 60), braceIdx).trimEnd() : '';
      if (/@font-face$/i.test(header)) continue;

      const lineNo = lineAt(src, m.index);
      const lineIdx = lineNo - 1;
      if (hasInlineAllowance(ctx.rawLines, lineIdx, 'theme')) continue;

      out.push({
        file,
        line: lineNo,
        lineIdx,
        ruleId: 'visual/no-raw-font-family-decl',
        message: `裸写字体栈「${value.slice(0, 48)}」不会跟随用户字体设置：改用 var(--font-sans)（界面字体）或 var(--font-mono)（代码字体）`,
        snippet: (ctx.rawLines[lineIdx] ?? '').trim().slice(0, 110),
      });
    }

    return out;
  },
};

/** 原生字阶 → 7 档语义字阶（像素值以 styles.css :root 的 --fs-* 为准） */
const RAW_FONT_FIX = {
  xs: 'text-aux（12px 辅助文字）',
  sm: 'text-section（14px 小节标题）',
  base: 'text-title（16px 标题）',
  lg: 'text-title（16px）或 text-hero（20px 主标题）',
  xl: 'text-hero（20px，仅限页面主标题）',
  '2xl': 'text-hero（20px，仅限页面主标题）',
};

export const noRawFontScale = makeClassTokenRule({
  id: 'visual/no-raw-font-scale',
  title: '视觉契约 · 禁止 text-xs/sm/base/lg/xl 原生字阶',
  pattern: /\btext-(2xl|xs|sm|base|lg|xl)\b/,
  buildMessage: ({ token, groups }) =>
    `禁止 ${token}（Tailwind 原生字阶）：改用 ${RAW_FONT_FIX[groups[1]] ?? 'text-body（13px 正文）'}；合法档仅 text-hero|title|section|body|aux|caption|micro`,
});

/**
 * 小数间距（warning-only）。
 * 设计系统只允许 4px 整数倍：1.5 = 6px 会让同一行里的两个 4px 间距对不齐，
 * 长期累积成「整体差 2px」的视觉漂移。存量 39 处，故只警告不阻断。
 */
const FRACTIONAL_SPACING_RE =
  /(?<![\w-])(?:[a-z-]+:)*-?(?:px|py|pt|pb|pl|pr|p|mx|my|mt|mb|ml|mr|m|gap-x|gap-y|gap|space-x|space-y|size|w|h|top|left|right|bottom|inset-x|inset-y|inset)-\d*\.\d+(?![\w-])/;

export const fractionalSpacing = makeClassTokenRule({
  id: 'visual/fractional-spacing',
  title: '视觉契约 · 小数间距落在 4px 网格外（警告）',
  pattern: FRACTIONAL_SPACING_RE,
  severity: 'warning',
  buildMessage: ({ token }) => {
    // token 可能带变体前缀（after:-inset-1.5），建议值必须把变体原样带回去，否则照抄会丢语义
    const cut = token.lastIndexOf(':') + 1;
    const variant = token.slice(0, cut);
    const utility = token.slice(cut);
    const value = Number(utility.match(/(\d*\.\d+)$/)?.[1]);
    const px = value * 4;
    const lo = Math.floor(px / 4);
    const hi = Math.ceil(px / 4);
    const prefix = utility.slice(0, utility.lastIndexOf('-', utility.length - 1) + 1);
    return `小数间距 ${token} 偏离 4px 网格（${px}px）：改用 ${variant}${prefix}${lo}（${lo * 4}px）或 ${variant}${prefix}${hi}（${hi * 4}px）；设计系统只允许 4px 整数倍`;
  },
});

/**
 * 任意值（warning-only）。
 * `w-[212px]` / `h-[min(...)]` 直接绕过 Token，是「AI 写出来的样式不合规范」的最高频形态；
 * 但 data-[state=open] / aria-[...] / has-[...] / content-[''] 是 Radix 变体语法，必须豁免，
 * 否则一次误伤就会让整组规则被注释掉。
 */
const ARBITRARY_EXEMPT =
  /(?:^|:)(?:group-|peer-)?data-\[|(?:^|:)aria-\[|(?:^|:)has-\[|(?:^|:)supports-\[|(?:^|:)content-\[/;

export const arbitraryValue = {
  id: 'visual/no-arbitrary-value',
  gate: 'Gate 4',
  title: '视觉契约 · 禁止任意值类绕过 Token（警告）',
  check(file, ctx) {
    if (!isVisualSurface(file)) return [];
    if (!ctx.warnings) ctx.warnings = [];
    const seen = new Set();

    for (const region of getClassRegions(ctx)) {
      const bracketRe = /\[[^\]]*\]/g;
      let m;
      while ((m = bracketRe.exec(region.text)) !== null) {
        // 把 [..] 向两侧扩到空白/引号边界，得到完整 token（如 hover:bg-[#fff]）
        let s = m.index;
        while (s > 0 && !/[\s"'`]/.test(region.text[s - 1])) s -= 1;
        let e = m.index + m[0].length;
        while (e < region.text.length && !/[\s"'`]/.test(region.text[e])) e += 1;
        const token = region.text.slice(s, e);
        if (ARBITRARY_EXEMPT.test(token)) continue;

        const lineNo = lineAt(ctx.stripped, region.start + s);
        const key = `${lineNo}\u0000${token}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (hasInlineAllowance(ctx.rawLines, lineNo - 1, 'theme')) continue;

        ctx.warnings.push({
          file,
          line: lineNo,
          lineIdx: lineNo - 1,
          ruleId: 'visual/no-arbitrary-value',
          message: `[visual/no-arbitrary-value] :${lineNo} 任意值 ${token} 绕过设计 Token：优先改用语义类（如 h-dock / w-window）或把尺寸收敛到 packages/ui/src/tokens 的 DIMENSIONS；确属一次性特例须在上一行写 // gate-theme-allow: 理由`,
        });
      }
    }

    return [];
  },
};

/* ---------------- 兜底值漂移（阻断） ---------------- */

/** 缓存 :root 纯 px 真值面（样式表是权威源，每次进程只读一次） */
let cachedRootPxTokens = null;

/**
 * 解析 :root 真值面（只认 :root，不认皮肤块与局部作用域）。
 *
 * 为什么只认 :root：皮肤块 [data-theme="x"] 定义的是色相，局部作用域（.conversation-pod）
 * 定义的是组件私有别名，二者的 px 兜底比对会把「作用域私有默认值」误判成漂移。
 * 只比较纯 px 值：clamp()/color-mix()/var() 等复合值无法静态判等，交给 theme/ghost-token。
 */
export function getRootPxTokens() {
  if (cachedRootPxTokens) return cachedRootPxTokens;
  const map = new Map();
  const targets = [];
  const stylesDir = path.join(REPO_ROOT, 'packages/ui/src/styles');
  if (fs.existsSync(stylesDir)) {
    for (const e of fs.readdirSync(stylesDir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.css')) targets.push(path.join(stylesDir, e.name));
    }
  }
  targets.push(path.join(REPO_ROOT, 'packages/desktop/src/renderer/styles.css'));

  for (const abs of targets) {
    if (!fs.existsSync(abs)) continue;
    let src = '';
    try {
      src = fs.readFileSync(abs, 'utf8');
      // gate-degrade: 单个样式表读取失败时跳过该文件，其余样式表仍构成真值面
    } catch {
      continue;
    }
    // 必须先剥块注释：注释里的示例值（如 `--radius-card` 的反例）不得进入真值面
    const clean = src.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const block of clean.matchAll(/:root\s*\{([\s\S]*?)\}/g)) {
      for (const m of block[1].matchAll(/(--[a-z0-9-]+)\s*:\s*(-?\d+(?:\.\d+)?)px\s*(?:!important\s*)?;/gi)) {
        map.set(m[1], Number(m[2]));
      }
    }
  }

  cachedRootPxTokens = map;
  return map;
}

export const tokenFallbackDrift = {
  id: 'visual/token-fallback-drift',
  gate: 'Gate 4',
  title: '视觉契约 · var() 兜底值必须等于 :root 真值',
  /**
   * 样式表专项标记。
   *
   * 设计意图 (Why)：
   *   这条规则的真值面（:root 定义）与主要违规面（组件样式表里的 var(--x, Npx)）都在 .css 文件中，
   *   而默认扫描域只收 ts/tsx/js/mjs。若不额外声明，规则在全量门禁里恒为空跑 ——
   *   实测 167 个扫描目标中 .css 数量为 0，规则只是在单测里活着。
   *
   * 约束与规则 (Rules)：
   *   只有显式声明 cssAware 的规则才会进入 run.mjs 的样式表专项扫描，
   *   换肤与 i18n 规则不得声明，否则会把整片遗留样式表一次性报红。
   */
  cssAware: true,
  check(file, ctx) {
    if (!isVisualSurface(file)) return [];
    if (!ctx.warnings) ctx.warnings = [];
    const defs = getRootPxTokens();
    if (defs.size === 0) {
      // 失败不可静默：真值面读不到时绝不假装「零漂移」
      ctx.warnings.push({
        file,
        line: 1,
        ruleId: 'visual/token-fallback-drift',
        message: '[visual/token-fallback-drift] :1 未解析到任何 :root 纯 px 真值，兜底漂移比对本次未生效',
      });
      return [];
    }

    const out = [];
    const seen = new Set();
    const re = /var\(\s*(--[a-z0-9-]+)\s*,\s*(-?\d+(?:\.\d+)?px)\s*\)/gi;
    let m;
    while ((m = re.exec(ctx.stripped)) !== null) {
      const name = m[1];
      const fallback = Number.parseFloat(m[2]);
      const truth = defs.get(name);
      if (truth === undefined || truth === fallback) continue;

      const lineNo = lineAt(ctx.stripped, m.index);
      const key = `${lineNo}\u0000${m[0]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (hasInlineAllowance(ctx.rawLines, lineNo - 1, 'theme')) continue;

      out.push({
        file,
        line: lineNo,
        lineIdx: lineNo - 1,
        ruleId: 'visual/token-fallback-drift',
        message: `${m[0]} 的兜底值 ${m[2]} 与 :root 真值 --${name.slice(2)}: ${truth}px 不一致：兜底必须等于真值（或直接省略兜底写 var(${name})），否则 Token 缺失时会静默渲染成另一套圆角/字号且无任何报错`,
        snippet: (ctx.rawLines[lineNo - 1] ?? '').trim().slice(0, 110),
      });
    }

    return out;
  },
};

/** Gate 4e 规则组（按 id 独立成条，byRule 才能给出逐规则命中数） */
/**
 * Gate 4e 视觉契约规则组。
 *
 * 【设计意图 (Why)】按 id 独立成条，run.mjs 的 byRule 统计才能给出逐规则命中数；
 *   若合并成一个大规则，"哪条契约在退化"就不可观测。
 */
export const visualRules = [
  noRawPalette,
  noLegacyRadius,
  noShadowScale,
  noRawFontScale,
  noRawFontFamily,
  noRawFontFamilyDecl,
  tokenFallbackDrift,
  arbitraryValue,
  fractionalSpacing,
];
