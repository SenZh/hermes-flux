/**
 * Markdown 代码块复制逻辑
 *
 * 【设计意图 (Why)】
 *   renderMarkdown 只产出纯 HTML 字符串（`<button data-md-copy="true">`），
 *   由本模块在宿主容器的 click 委托中统一完成文本提取、双通道剪贴板写入与按钮反馈状态切换。
 *
 * 【防范的历史坑 (Pitfall)】
 *   此前仅在 CSS/HTML 模板中渲染了复制按钮，容器未绑定事件处理，导致点击完全无响应；
 *   且非 HTTPS 的浏览器直跑场景下 `navigator.clipboard` 可能受限，必须降级到 `execCommand('copy')`。
 *
 * 【约束与规则 (Rules)】
 *   1. 空代码块或非复制按钮点击直接返回 false，不触碰剪贴板；
 *   2. 双通道均失败时严禁将按钮标记为「已复制」。
 */

import { t } from '../i18n/index.js';

interface CopyButtonElement {
  textContent: string | null;
  dataset: Record<string, string | undefined>;
  closest: (selector: string) => CopyWrapperElement | null;
}

interface CopyWrapperElement {
  querySelector: (selector: string) => { textContent: string | null } | null;
}

function execCommandCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(textarea);
  return ok;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  // gate-degrade: 主剪贴板通道不可用时降级到 execCommand
  } catch {}

  try {
    return execCommandCopy(text);
  // gate-degrade: 剪贴板降级通道失败时返回 false 由调用方处理
  } catch {
    return false;
  }
}

export async function handleCodeBlockCopyClick(target: EventTarget | null): Promise<boolean> {
  if (!target) return false;
  const candidate = target as { closest?: (selector: string) => CopyButtonElement | null };
  if (typeof candidate.closest !== 'function') return false;

  const copyBtn = candidate.closest('button[data-md-copy="true"]');
  if (!copyBtn) return false;

  const wrapper = copyBtn.closest('.md-codeblock');
  if (!wrapper) return false;

  const codeEl = wrapper.querySelector('pre > code') ?? wrapper.querySelector('pre');
  if (!codeEl) return false;

  const text = codeEl.textContent ?? '';
  if (!text) return false;

  const ok = await copyTextToClipboard(text);
  if (!ok) return false;

  copyBtn.textContent = t('common.copied');
  copyBtn.dataset.copied = 'true';
  globalThis.setTimeout(() => {
    copyBtn.textContent = t('common.copy');
    delete copyBtn.dataset.copied;
  }, 1500);
  return true;
}
