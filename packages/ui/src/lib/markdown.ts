/**
 * Markdown 渲染核心（对标 OpenChamber）。
 * 【设计意图 (Why)】此前 renderMarkdown 是 1200 行正则手写，边界情况（嵌套列表、表格对齐、
 *   流式未闭合、代码块内的特殊字符）持续出 bug，且每种元素各写一套内联样式，排版必然散。
 *   现在解析交给 marked，流式补全交给 remend，XSS 清洗交给 DOMPurify，
 *   我们只保留自己的排版 CSS 与「文件/URL 交互胶囊」这两个业务定制。
 * 【约束与规则 (Rules)】
 *   1. 渲染器只输出语义 HTML + 少量业务类名，禁止输出内联字号/行高/背景色；
 *   2. 行内 code 与文件引用不加底色与边框，类型识别交给文件图标；
 *   3. Node（SSR/测试）环境无 DOM，DOMPurify 不可用时不静默清空内容，直接返回已解析 HTML。
 */

import { marked, type Tokens } from 'marked';
import remend from 'remend';
import DOMPurify from 'dompurify';
import { t } from '../i18n/index.js';
import { escapeHtml, isLikelyFilePath, isLikelyHttpUrl } from './text.js';
import { renderFileTypeIcon } from './fileTypeIcons.js';
import { highlightCode, isHighlightReady } from './highlight.js';

/**
 * 行内代码 / 文件引用 / URL 引用。
 * 【设计意图 (Why)】文件引用靠文件类型图标识别，而不是靠背景色块；普通代码只保留等宽字形。
 */
export function formatInlineCodeOrLink(rawText: string): string {
  const text = rawText.trim();
  const isHttp = isLikelyHttpUrl(text);
  const isFile = !isHttp && isLikelyFilePath(text);

  if (!isHttp && !isFile) {
    return `<code class="md-code">${escapeHtml(rawText)}</code>`;
  }

  const tip = isHttp
    ? t('inspector.clickToOpenLink', { url: text })
    : t('inspector.clickToPreview', { file: text });

  if (isHttp) {
    return `<a class="md-link md-link--url tool-file-link content-interactive-link" data-preview-url="${escapeHtml(
      text
    )}" href="${escapeHtml(text)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(tip)}"><span class="md-link__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></span><span class="md-link__label">${escapeHtml(
      rawText
    )}</span></a>`;
  }

  return `<a class="tool-file-link content-interactive-link" data-preview-file="${escapeHtml(
    text
  )}" title="${escapeHtml(tip)}" style="cursor: pointer;">${renderFileTypeIcon(text)}<span class="md-link__label">${escapeHtml(rawText)}</span></a>`;
}

/** 单遍词法高亮（保留原有实现，shiki 需要异步管线，后续可替换）。 */
export function highlightCodeSyntax(code: string): string {
  if (!code) return '';

  const tokenRegex =
    /(\/\/[^\n]*|\{\/\*[\s\S]*?\*\/\}|\/\*[\s\S]*?\*\/)|(["'`][\s\S]*?["'`])|(<\/?[a-zA-Z0-9_-]+)|(\b[a-zA-Z0-9_-]+(?==))|\b(const|let|var|function|return|if|else|for|while|import|from|export|default|class|async|await|try|catch|type|interface|extends|implements)\b|\b(\d+)\b/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let output = '';

  while ((match = tokenRegex.exec(code)) !== null) {
    if (match.index > lastIndex) {
      output += escapeHtml(code.slice(lastIndex, match.index));
    }

    const [fullMatch, comment, stringLit, jsxTag, jsxAttr, keyword, numberLit] = match;

    if (comment) {
      output += `<span style="color: var(--hl-comment, var(--text-muted)); font-style: italic;">${escapeHtml(comment)}</span>`;
    } else if (stringLit) {
      output += `<span style="color: var(--hl-string, var(--accent));">${escapeHtml(stringLit)}</span>`;
    } else if (jsxTag) {
      output += `<span style="color: var(--hl-keyword, var(--accent)); font-weight: 600;">${escapeHtml(jsxTag)}</span>`;
    } else if (jsxAttr) {
      output += `<span style="color: var(--hl-type, var(--hl-number, var(--text-secondary)));">${escapeHtml(jsxAttr)}</span>`;
    } else if (keyword) {
      output += `<span style="color: var(--hl-keyword, var(--accent-dim)); font-weight: 600;">${escapeHtml(keyword)}</span>`;
    } else if (numberLit) {
      output += `<span style="color: var(--hl-number, var(--text-secondary));">${escapeHtml(numberLit)}</span>`;
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < code.length) {
    output += escapeHtml(code.slice(lastIndex));
  }

  return output;
}

const PLAIN_LANGUAGES = new Set(['log', 'txt', 'text', 'logcat', 'output', 'plaintext']);
const HIGHLIGHT_SIZE_LIMIT = 25000;

/** 代码块：统一的语言条 + 复制按钮 + 可横向滚动的 pre。 */
function renderCodeBlock(code: string, rawLang: string | undefined): string {
  const lang = (rawLang || '').trim().toLowerCase();
  const isPlain = PLAIN_LANGUAGES.has(lang) || code.length > HIGHLIGHT_SIZE_LIMIT;
  // Shiki 覆盖主流语言；不在白名单时回退到轻量词法高亮，最后才纯文本
  const highlighted = isPlain ? null : highlightCode(code, lang);
  const body = highlighted ?? (isPlain ? escapeHtml(code) : highlightCodeSyntax(code));
  const langLabel = escapeHtml(lang || 'text');

  return `<div class="md-codeblock code-block-wrapper" data-lang="${langLabel}"><div class="md-codeblock__bar"><span class="md-codeblock__lang">${langLabel}</span><button type="button" class="md-codeblock__copy" data-md-copy="true">${escapeHtml(
    t('common.copy')
  )}</button></div><pre class="md-pre"><code class="language-${langLabel}">${body}</code></pre></div>`;
}

const parser = marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }: Tokens.Code) {
      return renderCodeBlock(text, lang);
    },
    codespan({ text }: Tokens.Codespan) {
      return formatInlineCodeOrLink(text);
    },
    link({ href, title, tokens }: Tokens.Link) {
      const target = href ?? '';
      const label = this.parser.parseInline(tokens);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';

      if (isLikelyHttpUrl(target)) {
        return `<a class="md-link md-link--url tool-file-link content-interactive-link" data-preview-url="${escapeHtml(
          target
        )}" href="${escapeHtml(target)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${label}</a>`;
      }
      if (isLikelyFilePath(target)) {
        return `<a class="md-link md-link--file tool-file-link content-interactive-link" data-preview-file="${escapeHtml(
          target
        )}" href="${escapeHtml(target)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${renderFileTypeIcon(
          target
        )}${label}</a>`;
      }
      return `<a class="md-link" href="${escapeHtml(target)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${label}</a>`;
    },
  },
});

/**
 * 把 TSV 表格转成 GFM 管道表格。
 * 【设计意图 (Why)】Agent 经常直接输出制表符分隔的对比表，marked 只认管道表格。
 * 【约束与规则 (Rules)】跳过围栏代码块内部；行首有缩进（列表/代码）不参与转换。
 */
function convertTsvTables(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inFence = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      out.push(line);
      i += 1;
      continue;
    }
    if (inFence) {
      out.push(line);
      i += 1;
      continue;
    }

    const isTsvRow = (value: string): boolean =>
      value.includes('\t') && !/^\s/.test(value) && value.trim().length > 0;

    if (!isTsvRow(line)) {
      out.push(line);
      i += 1;
      continue;
    }

    const block: string[] = [];
    while (i < lines.length && isTsvRow(lines[i])) {
      block.push(lines[i]);
      i += 1;
    }

    if (block.length < 2) {
      out.push(...block);
      continue;
    }

    const toRow = (value: string): string =>
      '| ' +
      value
        .split('\t')
        .map((cell) => cell.trim().replace(/\|/g, '\\|'))
        .join(' | ') +
      ' |';
    const columnCount = block[0].split('\t').length;

    out.push(toRow(block[0]));
    out.push('| ' + Array.from({ length: columnCount }, () => '---').join(' | ') + ' |');
    for (const row of block.slice(1)) out.push(toRow(row));
  }

  return out.join('\n');
}

/** 流式未闭合围栏补全：只有检测到奇数个 ``` 时才交给 remend，避免影响完整文本。 */
function healStreamingMarkdown(md: string): string {
  const fences = md.match(/```/g);
  if (!fences || fences.length % 2 === 0) return md;
  return remend(md);
}

const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  ADD_TAGS: ['use'],
  ADD_ATTR: ['href', 'xlink:href', 'target', 'data-preview-file', 'data-preview-url', 'data-icon'],
  FORBID_TAGS: ['script', 'style'],
  FORBID_CONTENTS: ['script'],
};

/**
 * 清洗解析结果。
 * 【设计意图 (Why)】marked 允许内联 HTML，直接注入 innerHTML 存在 XSS 风险。
 * 【约束与规则 (Rules)】浏览器内必须清洗；Node（无 DOM）环境返回原 HTML，
 *   因为该路径只用于 SSR 字符串断言，不会进入真实 DOM。
 */
function sanitize(html: string): string {
  if (!DOMPurify.isSupported) return html;
  // DOMPurify 在 returnTrustedTypes 未开启时返回 string；String() 兼顾两种类型定义
  return String(DOMPurify.sanitize(html, SANITIZE_CONFIG));
}

const markdownRenderCache = new Map<string, string>();
const MARKDOWN_CACHE_MAX = 500;

export function renderMarkdownCore(md: string): string {
  if (!md) return '';

  const cached = markdownRenderCache.get(md);
  if (cached !== undefined) return cached;

  const normalized = convertTsvTables(healStreamingMarkdown(md));
  const parsed = parser.parse(normalized) as string;
  const withClasses = parsed
    .replace(/<table>/g, '<table class="md-table">')
    .replace(/<blockquote>/g, '<blockquote class="md-quote">')
    .replace(/<hr>/g, '<hr class="md-hr">');
  const result = sanitize(withClasses);

  // 引擎未预热时不要用回退高亮的 HTML 污染缓存，否则预热完成后仍会命中旧结果
  if (isHighlightReady()) {
    if (markdownRenderCache.size >= MARKDOWN_CACHE_MAX) {
      const oldestKey = markdownRenderCache.keys().next().value;
      if (oldestKey) markdownRenderCache.delete(oldestKey);
    }
    markdownRenderCache.set(md, result);
  }

  return result;
}
