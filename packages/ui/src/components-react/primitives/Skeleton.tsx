import * as React from 'react';

/**
 * 骨架占位块。
 *
 * 设计意图 (Why)：
 *   加载中只表达"这里将出现内容"，绝不伪造默认名称、假头像或默认会话——
 *   伪造出来的默认信息会被用户当成真实数据。
 *
 * 约束与规则 (Rules)：
 *   1. 几何（h-/w-/rounded-）由调用方给，颜色与呼吸动效由 `.flux-skeleton` 单一真值提供；
 *   2. 纯装饰：aria-hidden，不进入无障碍树，也不参与键盘焦点；
 *   3. 尺寸必须与它替换的真实元素一致（微轨 Agent 42px、卡片行 48px、头像 36px），
 *      数据到达时不得产生布局跳动。
 */
export function Skeleton({ className = '', slot = 'block' }: { className?: string; slot?: string }): React.ReactElement {
  return <span aria-hidden="true" data-skeleton={slot} className={`flux-skeleton ${className}`} />;
}
