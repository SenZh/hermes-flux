/**
 * 代码高亮（Shiki，与 OpenChamber 同源）。
 * 【设计意图 (Why)】正则高亮只能识别少量关键字，遇到嵌套模板字符串、泛型、JSX 立刻失真。
 *   OpenChamber 用 Shiki 做词法级高亮，这里对齐同一方案：Shiki 3 + JS 正则引擎 +
 *   CSS 变量主题，颜色全部落到 --shiki-token-* 上，由各皮肤统一提供。
 * 【约束与规则 (Rules)】
 *   1. 同步初始化 + 单例，避免引入 worker 与异步渲染管线（现有模板渲染是同步字符串拼接）；
 *   2. 语言不在白名单内返回 null，由调用方回退到纯文本，禁止抛错；
 *   3. 单块超过 1200 行跳过高亮，防止长日志阻塞主线程。
 */

import { createHighlighterCoreSync, createCssVariablesTheme, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

import langBash from 'shiki/langs/shellscript.mjs';
import langC from 'shiki/langs/c.mjs';
import langCpp from 'shiki/langs/cpp.mjs';
import langCsharp from 'shiki/langs/csharp.mjs';
import langCss from 'shiki/langs/css.mjs';
import langDiff from 'shiki/langs/diff.mjs';
import langDocker from 'shiki/langs/docker.mjs';
import langGo from 'shiki/langs/go.mjs';
import langHtml from 'shiki/langs/html.mjs';
import langJava from 'shiki/langs/java.mjs';
import langJavascript from 'shiki/langs/javascript.mjs';
import langJson from 'shiki/langs/json.mjs';
import langJsx from 'shiki/langs/jsx.mjs';
import langKotlin from 'shiki/langs/kotlin.mjs';
import langMarkdown from 'shiki/langs/markdown.mjs';
import langPhp from 'shiki/langs/php.mjs';
import langPowershell from 'shiki/langs/powershell.mjs';
import langPython from 'shiki/langs/python.mjs';
import langRuby from 'shiki/langs/ruby.mjs';
import langRust from 'shiki/langs/rust.mjs';
import langSql from 'shiki/langs/sql.mjs';
import langSwift from 'shiki/langs/swift.mjs';
import langToml from 'shiki/langs/toml.mjs';
import langTsx from 'shiki/langs/tsx.mjs';
import langTypescript from 'shiki/langs/typescript.mjs';
import langXml from 'shiki/langs/xml.mjs';
import langYaml from 'shiki/langs/yaml.mjs';

const LANGS = [
  langBash,
  langC,
  langCpp,
  langCsharp,
  langCss,
  langDiff,
  langDocker,
  langGo,
  langHtml,
  langJava,
  langJavascript,
  langJson,
  langJsx,
  langKotlin,
  langMarkdown,
  langPhp,
  langPowershell,
  langPython,
  langRuby,
  langRust,
  langSql,
  langSwift,
  langToml,
  langTsx,
  langTypescript,
  langXml,
  langYaml,
];

/** 常见别名 → Shiki 语言 id。 */
const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  jsx: 'jsx',
  tsx: 'tsx',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  shell: 'shellscript',
  ps1: 'powershell',
  pwsh: 'powershell',
  yml: 'yaml',
  md: 'markdown',
  py: 'python',
  rs: 'rust',
  kt: 'kotlin',
  kts: 'kotlin',
  cs: 'csharp',
  'c++': 'cpp',
  h: 'c',
  hpp: 'cpp',
  dockerfile: 'docker',
  makefile: 'make',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  jsonc: 'json',
  sql: 'sql',
  text: 'text',
  plaintext: 'text',
  log: 'text',
  logcat: 'text',
  output: 'text',
};

const HIGHLIGHT_LINE_LIMIT = 1200;

const cssVariablesTheme = createCssVariablesTheme({
  name: 'css-variables',
  variablePrefix: '--shiki-',
  fontStyle: true,
});

let highlighter: HighlighterCore | null = null;
let initFailed = false;
let warmUpScheduled = false;

function createHighlighter(): HighlighterCore | null {
  if (highlighter || initFailed) return highlighter;
  try {
    highlighter = createHighlighterCoreSync({
      themes: [cssVariablesTheme],
      langs: LANGS,
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  // gate-degrade: 高亮引擎初始化失败时降级为纯文本，不让代码块渲染中断
  } catch {
    initFailed = true;
  }
  return highlighter;
}

/**
 * 预热高亮引擎。
 * 【设计意图 (Why)】首次创建引擎要编译 20+ 套语法，耗时约 300ms；
 *   放进首屏渲染会直接击穿 50ms 的渲染预算。因此改为空闲时预热：
 *   首屏先用轻量词法高亮（视觉结构一致），引擎就绪后自动升级为 Shiki。
 * 【约束与规则 (Rules)】只允许宿主入口调用一次；Node（测试）环境不主动预热。
 */
export function warmUpHighlighting(): void {
  if (highlighter || initFailed || warmUpScheduled) return;
  warmUpScheduled = true;
  const run = (): void => {
    createHighlighter();
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 2000 });
  } else if (typeof setTimeout === 'function') {
    setTimeout(run, 300);
  }
}

/** Shiki 是否已就绪；未就绪时调用方应回退到轻量高亮。 */
export function isHighlightReady(): boolean {
  return highlighter !== null;
}

function exceedsLineLimit(code: string): boolean {
  let lines = 1;
  for (let i = 0; i < code.length; i += 1) {
    if (code.charCodeAt(i) === 10 && ++lines > HIGHLIGHT_LINE_LIMIT) return true;
  }
  return false;
}

/**
 * 返回代码块内部 HTML（不含 <pre><code> 外壳）。
 * 语言不支持、超长或初始化失败时返回 null，由调用方回退。
 */
export function highlightCode(code: string, lang: string): string | null {
  const requested = (lang || '').trim().toLowerCase();
  if (!requested || requested === 'text' || requested === 'plaintext') return null;
  if (exceedsLineLimit(code)) return null;

  // 引擎未预热完成时回退轻量高亮，绝不在渲染路径上同步创建
  const engine = highlighter;
  if (!engine) return null;

  const resolved = LANG_ALIASES[requested] ?? requested;
  if (resolved === 'text') return null;
  if (!engine.getLoadedLanguages().includes(resolved)) return null;

  try {
    const html = engine.codeToHtml(code, { lang: resolved, theme: 'css-variables' });
    return html.replace(/^<pre[^>]*><code[^>]*>/, '').replace(/<\/code><\/pre>$/, '');
  // gate-degrade: 单个代码块高亮失败时回退轻量词法高亮，不阻断整段正文
  } catch {
    return null;
  }
}
