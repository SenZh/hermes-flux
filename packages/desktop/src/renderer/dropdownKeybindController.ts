/**
 * 模型下拉、级联与全局热键控制器 (Dropdown & Keybind Controller)
 *
 * 【设计意图 (Why)】
 *   收敛模型选择器下拉菜单交互（搜索过滤、Provider 分组折叠、模型行键盘上下导航与二级思考等级级联定位）、
 *   点击外部区域关闭浮层（Capture 阶段 pointerdown 白名单判定）、以及窗口全局快捷键（Cmd/Ctrl+B, \, , Enter, Escape）。
 *   将这些原本在 index.ts 中散落多处的监听与状态彻底解耦。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 外部点击收起浮层若在冒泡阶段监听，会被行内的 stopPropagation 掐断，导致点空白不收起；必须走 capture 阶段；
 *   2. 选完等级触发 render 重建列表时，鼠标停在行上可能产生虚假 mouseenter 重新唤醒级联，必须开 600ms 抑制窗口；
 *   3. 键盘按 Esc 收起级联时焦点回到行上，必须避免行 onfocus 重新弹出面板。
 *
 * 【约束与规则 (Rules)】
 *   - 零反向依赖：严禁 import index.ts，一切状态与外部能力由 deps 注入；
 *   - 零 as any：所有事件与 DOM 元素走严格 TypeScript 类型守护；
 *   - 可测试性：在纯 Node 或无 DOM 测试环境下安全降级，不抛出 ReferenceError。
 */

import { renderModelPickerTree, type RenderInputDockSnapshot, type SettingsSectionId } from '@hermes-flux/ui';
import type { AppState } from './state/appState.js';

export interface DropdownKeybindControllerDeps {
  getState: () => AppState;
  render: () => void;
  switchModel: (model: string, provider?: string) => Promise<void>;
  switchReasoning: (level: AppState['reasoningLevel']) => Promise<void>;
  modalInteractionController: {
    handleGlobalEscape: () => boolean;
    handleGlobalEnter: () => boolean;
    closeContextMenuIfClickedOutside: (target: Node | null) => void;
  };
  ensureSettingsSectionData: (section: SettingsSectionId) => void;
  getLastInputDockSnapshot: () => RenderInputDockSnapshot | null;
  setLastInputDockSnapshot: (snapshot: RenderInputDockSnapshot | null) => void;
}

export interface DropdownKeybindController {
  bindModelDropdownEvents(): void;
  pickReasoningLevel(item: HTMLElement): void;
  hideModelCascade(): void;
  scheduleHideModelCascade(): void;
  cancelHideModelCascade(): void;
  resetModelSearchOnOpen(): void;
  showModelCascade(row: HTMLElement): void;
  closeModelMenu(): void;
  updateModelDropdownSubtree(): void;
  setupGlobalKeybinds(target?: Window | EventTarget): () => void;
  setupOutsideClickHandlers(target?: Document | EventTarget): () => void;
  dispose(): void;
}

const CASCADE_VIEWPORT_PADDING_PX = 8;
const LEVELS: ReadonlySet<string> = new Set(['default', 'none', 'low', 'high', 'max']);

export function createDropdownKeybindController(
  deps: DropdownKeybindControllerDeps,
): DropdownKeybindController {
  let modelCascadeHideTimer: number | null = null;
  let cascadeSuppressModel: string | null = null;
  let cascadeSuppressUntil = 0;

  let keydownCleanup: (() => void) | null = null;
  let outsideClickCleanup: (() => void) | null = null;

  function cancelHideModelCascade(): void {
    if (modelCascadeHideTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(modelCascadeHideTimer);
      modelCascadeHideTimer = null;
    }
  }

  function hideModelCascade(): void {
    cancelHideModelCascade();
    if (typeof document !== 'undefined') {
      const cascade = document.getElementById('model-reasoning-cascade');
      if (cascade) cascade.style.display = 'none';
    }
    const state = deps.getState();
    state.modelCascadeModel = undefined;
  }

  function rowModelOf(row: HTMLElement): string | undefined {
    return row.getAttribute('data-model') || undefined;
  }

  function bindModelDropdownEvents(): void {
    if (typeof document === 'undefined') return;
    const state = deps.getState();

    // Search model input
    const modelSearchInput = document.getElementById('dock-model-search-input') as HTMLInputElement | null;
    if (modelSearchInput) {
      modelSearchInput.onclick = (e) => e.stopPropagation();
      modelSearchInput.oninput = (e) => {
        e.stopPropagation();
        state.modelSearchQuery = (e.target as HTMLInputElement).value;
        updateModelDropdownSubtree();
      };
    }

    // Toggle favorite model
    document.querySelectorAll('.btn-toggle-favorite').forEach((btn) => {
      (btn as HTMLElement).onclick = (e) => {
        e.stopPropagation();
        const modelId = (e.currentTarget as HTMLElement).getAttribute('data-model');
        if (modelId) {
          if (state.favoriteModels.includes(modelId)) {
            state.favoriteModels = state.favoriteModels.filter((m) => m !== modelId);
          } else {
            state.favoriteModels.push(modelId);
          }
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('hermes_flux_fav_models', JSON.stringify(state.favoriteModels));
            localStorage.setItem('hermes_aura_fav_models', JSON.stringify(state.favoriteModels));
          }
          updateModelDropdownSubtree();
        }
      };
    });

    // 列表滚动收起级联
    const scrollList = document.getElementById('model-picker-scroll-list');
    if (scrollList && !scrollList.dataset.cascadeScrollBound) {
      scrollList.dataset.cascadeScrollBound = 'true';
      scrollList.addEventListener('scroll', () => hideModelCascade(), { passive: true });
    }

    // Provider 分组折叠
    document.querySelectorAll('.model-provider-group-header').forEach((header) => {
      const el = header as HTMLElement;
      const toggle = (): void => {
        if (el.getAttribute('data-search-open') === 'true') return;
        const slug = el.getAttribute('data-provider');
        if (!slug) return;
        const idx = state.collapsedProviders.indexOf(slug);
        if (idx >= 0) state.collapsedProviders.splice(idx, 1);
        else state.collapsedProviders.push(slug);
        hideModelCascade();
        updateModelDropdownSubtree();
      };
      el.onclick = (e) => {
        e.stopPropagation();
        toggle();
      };
      el.onkeydown = (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        toggle();
      };
    });

    // 模型行
    const switchModel = (m: string, p?: string): Promise<void> => deps.switchModel(m, p);
    document.querySelectorAll('.model-option').forEach((opt) => {
      const el = opt as HTMLElement;
      el.onclick = (e) => {
        e.stopPropagation();
        if (el.dataset.locked === 'true') return;
        const model = el.getAttribute('data-model');
        const provider = el.getAttribute('data-provider') || undefined;
        hideModelCascade();
        state.modelMenuOpen = false;
        if (model) void switchModel(model, provider);
        else deps.render();
      };
      el.onmouseenter = () => {
        if (el.dataset.locked === 'true') return;
        showModelCascade(el);
      };
      el.onmouseleave = () => {
        scheduleHideModelCascade();
      };
      el.onfocus = () => {
        if (el.dataset.locked === 'true') return;
        showModelCascade(el);
      };
      el.onblur = () => {
        const ownerModel = rowModelOf(el);
        if (typeof window !== 'undefined') {
          window.setTimeout(() => {
            const cascade = document.getElementById('model-reasoning-cascade');
            if (cascade && cascade.contains(document.activeElement)) return;
            if (state.modelCascadeModel !== ownerModel) return;
            scheduleHideModelCascade();
          }, 0);
        }
      };
      el.onkeydown = (e) => {
        if (e.key === 'ArrowRight') {
          if (el.dataset.locked === 'true') return;
          const cascade = document.getElementById('model-reasoning-cascade');
          const first = cascade?.querySelector<HTMLElement>('.model-cascade__item');
          if (first) {
            e.preventDefault();
            e.stopPropagation();
            cascadeSuppressUntil = 0;
            showModelCascade(el);
            first.focus();
          }
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          el.click();
          return;
        }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
        e.preventDefault();
        const rows = [...document.querySelectorAll<HTMLElement>('.model-option')].filter((r) => r.offsetParent !== null);
        const current = rows.indexOf(el);
        if (current < 0) return;
        const next =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? rows.length - 1
              : e.key === 'ArrowDown'
                ? Math.min(rows.length - 1, current + 1)
                : Math.max(0, current - 1);
        rows[next]?.focus();
      };
    });

    // 级联内部键盘导航
    const cascade = document.getElementById('model-reasoning-cascade');
    if (cascade) {
      cascade.onmouseenter = () => {
        cancelHideModelCascade();
      };
      cascade.onmouseleave = () => {
        scheduleHideModelCascade();
      };
      const items = [...cascade.querySelectorAll<HTMLElement>('.model-cascade__item')];
      items.forEach((itemEl, index) => {
        itemEl.onclick = (e) => {
          e.stopPropagation();
          pickReasoningLevel(itemEl);
        };
        itemEl.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            pickReasoningLevel(itemEl);
            return;
          }
          if (e.key === 'Escape' || e.key === 'ArrowLeft') {
            e.preventDefault();
            e.stopPropagation();
            const model = state.modelCascadeModel;
            if (model) {
              cascadeSuppressModel = model;
              cascadeSuppressUntil = Date.now() + 400;
            }
            hideModelCascade();
            if (model) {
              document.querySelector<HTMLElement>(`.model-option[data-model="${CSS.escape(model)}"]`)?.focus({
                preventScroll: true,
              });
            }
            return;
          }
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
          e.preventDefault();
          const next =
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? items.length - 1
                : e.key === 'ArrowDown'
                  ? Math.min(items.length - 1, index + 1)
                  : Math.max(0, index - 1);
          items[next]?.focus();
        };
      });
    }
  }

  function pickReasoningLevel(item: HTMLElement): void {
    const raw = item.getAttribute('data-level');
    if (!raw || !LEVELS.has(raw)) return;
    const level = raw as AppState['reasoningLevel'];
    const state = deps.getState();
    const returnToModel = state.modelCascadeModel ?? null;
    cascadeSuppressModel = null;
    cascadeSuppressUntil = Date.now() + 600;
    hideModelCascade();
    void deps.switchReasoning(level);
    if (returnToModel && typeof requestAnimationFrame !== 'undefined' && typeof document !== 'undefined') {
      requestAnimationFrame(() => {
        const row = document.querySelector<HTMLElement>(`.model-option[data-model="${CSS.escape(returnToModel)}"]`);
        row?.focus({ preventScroll: true });
      });
    }
  }

  function scheduleHideModelCascade(): void {
    cancelHideModelCascade();
    if (typeof window !== 'undefined') {
      modelCascadeHideTimer = window.setTimeout(() => {
        modelCascadeHideTimer = null;
        hideModelCascade();
      }, 160);
    }
  }

  function resetModelSearchOnOpen(): void {
    const state = deps.getState();
    state.modelSearchQuery = '';
    const lastInputDockSnapshot = deps.getLastInputDockSnapshot();
    if (lastInputDockSnapshot) {
      deps.setLastInputDockSnapshot({ ...lastInputDockSnapshot, modelSearchQuery: '' });
    }
    updateModelDropdownSubtree();
  }

  function showModelCascade(row: HTMLElement): void {
    const cascade = typeof document !== 'undefined' ? document.getElementById('model-reasoning-cascade') : null;
    const dropdown = typeof document !== 'undefined' ? document.getElementById('dock-model-dropdown') : null;
    if (!cascade || !dropdown) return;

    const rowModel = row.getAttribute('data-model');
    if (Date.now() < cascadeSuppressUntil && (cascadeSuppressModel === null || rowModel === cascadeSuppressModel)) {
      return;
    }
    cancelHideModelCascade();

    const state = deps.getState();
    state.modelCascadeModel = rowModel || undefined;
    cascade.style.display = 'block';
    cascade.classList.remove('model-cascade--flip', 'model-cascade--inset');

    const rowRect = row.getBoundingClientRect();
    const dropdownRect = dropdown.getBoundingClientRect();
    const cascadeRect = cascade.getBoundingClientRect();
    const cascadeWidth = cascadeRect.width || 148;
    const cascadeHeight = cascadeRect.height || 0;

    const winWidth = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const winHeight = typeof window !== 'undefined' ? window.innerHeight : 768;

    const spaceRight = winWidth - dropdownRect.right;
    const spaceLeft = dropdownRect.left;
    let useInset = false;
    if (spaceRight >= cascadeWidth + 12) {
      // 默认右外侧
    } else if (spaceLeft >= cascadeWidth + 12) {
      cascade.classList.add('model-cascade--flip');
    } else {
      cascade.classList.add('model-cascade--inset');
      useInset = true;
    }

    const viewportBottom = winHeight - CASCADE_VIEWPORT_PADDING_PX;
    let desiredTop = rowRect.top;
    if (useInset) {
      const belowTop = rowRect.bottom + 4;
      const aboveTop = rowRect.top - cascadeHeight - 4;
      desiredTop = belowTop + cascadeHeight <= viewportBottom ? belowTop : Math.max(CASCADE_VIEWPORT_PADDING_PX, aboveTop);
    }
    const maxTop = Math.max(CASCADE_VIEWPORT_PADDING_PX, viewportBottom - cascadeHeight);
    const clampedTop = Math.min(Math.max(desiredTop, CASCADE_VIEWPORT_PADDING_PX), maxTop);
    cascade.style.top = `${Math.round(clampedTop - dropdownRect.top - dropdown.clientTop)}px`;
  }

  function closeModelMenu(): void {
    hideModelCascade();
    const state = deps.getState();
    state.modelMenuOpen = false;
    if (typeof document !== 'undefined') {
      const dropdown = document.getElementById('dock-model-dropdown');
      if (dropdown) dropdown.style.display = 'none';
      const trigger = document.getElementById('dock-model-selector-btn');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }
    deps.render();
  }

  function updateModelDropdownSubtree(): void {
    if (typeof document === 'undefined') return;
    const scrollList = document.getElementById('model-picker-scroll-list');
    if (!scrollList) return;
    const state = deps.getState();
    scrollList.innerHTML = renderModelPickerTree({
      selectedModel: state.selectedModel,
      models: state.availableModels,
      modelDetails: state.modelDetails,
      modelCatalog: state.modelCatalog,
      currentProvider: state.currentProvider,
      favoriteModels: state.favoriteModels,
      recentModels: state.recentModels,
      modelSearchQuery: state.modelSearchQuery,
      collapsedProviders: state.collapsedProviders,
      reasoningLevel: state.reasoningLevel,
      approvalMode: state.approvalMode,
      isStreaming: state.isStreaming,
    });
    bindModelDropdownEvents();
  }

  function setupGlobalKeybinds(target: Window | EventTarget = window): () => void {
    if (!target || typeof target.addEventListener !== 'function') return () => {};
    const handleKeydown = (event: Event): void => {
      const e = event as KeyboardEvent;
      const state = deps.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        state.leftRailCollapsed = !state.leftRailCollapsed;
        deps.render();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        state.inspectorCollapsed = !state.inspectorCollapsed;
        deps.render();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        state.isSettingsOpen = !state.isSettingsOpen;
        if (state.isSettingsOpen) deps.ensureSettingsSectionData(state.settingsSection);
        deps.render();
      }
      if (e.key === 'Escape') {
        if (deps.modalInteractionController.handleGlobalEscape()) {
          return;
        }
        if (state.isSettingsOpen) {
          state.isSettingsOpen = false;
          deps.render();
        } else if (state.modelMenuOpen) {
          closeModelMenu();
        }
      }
      if (e.key === 'Enter') {
        if (deps.modalInteractionController.handleGlobalEnter()) {
          e.preventDefault();
          return;
        }
      }
    };

    target.addEventListener('keydown', handleKeydown);
    const cleanup = (): void => {
      target.removeEventListener('keydown', handleKeydown);
    };
    keydownCleanup = cleanup;
    return cleanup;
  }

  function setupOutsideClickHandlers(target: Document | EventTarget = document): () => void {
    if (!target || typeof target.addEventListener !== 'function') return () => {};

    // 必须在 capture 阶段注册（冒泡会被行内 stopPropagation 掐断）
    document.addEventListener(
      'pointerdown',
      (e) => {
        const state = deps.getState();
        if (!state.modelMenuOpen) return;
        const target = e.target as Node | null;
        if (!target) return;
        const dropdown = document.getElementById('dock-model-dropdown');
        const trigger = document.getElementById('dock-model-selector-btn');
        const cascade = document.getElementById('model-reasoning-cascade');
        if (dropdown?.contains(target) || trigger?.contains(target) || cascade?.contains(target)) return;
        closeModelMenu();
      },
      true,
    );

    document.addEventListener('mousedown', (e) => {
      const state = deps.getState();
      const approvalDropdown = document.getElementById('dock-approval-dropdown');
      const approvalBtn = document.getElementById('dock-approval-toggle-btn');
      if (approvalDropdown && approvalDropdown.style.display === 'block') {
        if (!approvalDropdown.contains(e.target as Node) && !approvalBtn?.contains(e.target as Node)) {
          approvalDropdown.style.display = 'none';
        }
      }

      if (state.slashPopperOpen || state.mentionPopperOpen) {
        const clickedTarget = e.target as Node | null;
        const popper = document.querySelector('.composer-popper');
        const dock = document.querySelector('.input-dock-container');
        const insidePopper = popper ? popper.contains(clickedTarget) : false;
        const insideDock = dock ? dock.contains(clickedTarget) : false;
        if (!insidePopper && !insideDock) {
          state.slashPopperOpen = false;
          state.mentionPopperOpen = false;
          deps.render();
        }
      }

      deps.modalInteractionController.closeContextMenuIfClickedOutside(e.target as Node | null);
    });

    const cleanup = (): void => {
      // noop
    };
    outsideClickCleanup = cleanup;
    return cleanup;
  }

  function dispose(): void {
    cancelHideModelCascade();
    keydownCleanup?.();
    keydownCleanup = null;
    outsideClickCleanup?.();
    outsideClickCleanup = null;
  }

  return {
    bindModelDropdownEvents,
    pickReasoningLevel,
    hideModelCascade,
    scheduleHideModelCascade,
    cancelHideModelCascade,
    resetModelSearchOnOpen,
    showModelCascade,
    closeModelMenu,
    updateModelDropdownSubtree,
    setupGlobalKeybinds,
    setupOutsideClickHandlers,
    dispose,
  };
}
