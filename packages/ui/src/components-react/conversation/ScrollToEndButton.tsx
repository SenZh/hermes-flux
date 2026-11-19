/**
 * 「回到底部」按钮原语。
 *
 * 【设计意图 (Why)】
 *   滚动入口是交互控件，必须与只读的 AgentPresence 物理分离；形态（32px 圆钮 /
 *   箭头 + 文案胶囊）完全由宿主 `.dock-actionbar[data-presence-layout]` 控制，
 *   组件始终渲染同一套结构，避免 React props 与命令式 DOM 状态双写。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 不在 JSX 里声明 `aria-hidden` / `tabindex`：这两个属性由 scrollEndController
 *      命令式维护，写进 JSX 会在语言切换重渲染时覆盖命令式状态；
 *   2. 不接收 `visible` prop：显隐由 `data-at-bottom` 驱动，React 不参与；
 *   3. `onCommit` 只在提交后通知宿主重推无障碍态，不得在渲染期间读 DOM。
 *
 * 【约束与规则 (Rules)】
 *   1. 文案与 aria-label 100% 由调用方传入（i18n 字典），组件内禁止字面量；
 *   2. 禁止内联 style 与裸色值，几何全部由 conversation.css 承担。
 */

import * as React from 'react';

export interface ScrollToEndButtonProps {
  readonly label: string;
  readonly ariaLabel: string;
  readonly onClick: () => void;
  /** React 提交后通知宿主把 aria-hidden / tabindex 重写到新按钮节点 */
  readonly onCommit?: () => void;
}

export function ScrollToEndButton({
  label,
  ariaLabel,
  onClick,
  onCommit,
}: ScrollToEndButtonProps): React.ReactElement {
  const commitRef = React.useRef(onCommit);
  commitRef.current = onCommit;

  React.useLayoutEffect(() => {
    commitRef.current?.();
  });

  return (
    <button type="button" className="scroll-end" aria-label={ariaLabel} onClick={onClick}>
      <span className="scroll-end__icon" aria-hidden="true">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="12" y1="4" x2="12" y2="20" />
          <polyline points="5 13 12 20 19 13" />
        </svg>
      </span>
      <span className="scroll-end__label">{label}</span>
    </button>
  );
}
