import * as React from 'react';
import { t } from '../../i18n/index.js';
import { Button } from '../primitives/Button.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../primitives/Dialog.js';

/**
 * 移除 MCP 服务器二次确认弹窗（「BOT 能力矩阵」与「设置 › 扩展」共用唯一实现）。
 *
 * 【设计意图 (Why)】
 *   MCP 移除属于破坏性操作，两处入口必须共享同一套 Dialog 二次确认容器与
 *   语义属性，彻底消除同构 JSX 复制与属性漂移。
 *
 * 【约束与规则 (Rules)】
 *   1. 使用 `Dialog` 原语 + `portal={false}` + `max-h-modal-sm`；
 *   2. 声明 `data-mcp-remove-dialog="true"` 供 E2E 精确断言；
 *   3. 删除进行中（`busy === true`）禁止外部关闭，避免状态裂脑。
 */
export interface McpRemoveConfirmDialogProps {
  /** 待移除的 MCP 名称；为 null 时不渲染。 */
  serverName: string | null;
  /** 删除请求是否在途。 */
  busy: boolean;
  /** 取消或关闭回调。 */
  onCancel: () => void;
  /** 确认删除回调。 */
  onConfirm: () => void;
}

export function McpRemoveConfirmDialog({
  serverName,
  busy,
  onCancel,
  onConfirm,
}: McpRemoveConfirmDialogProps): React.ReactElement | null {
  if (!serverName) return null;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent
        portal={false}
        data-mcp-remove-dialog="true"
        className="flex max-h-modal-sm w-full max-w-md flex-col gap-0 overflow-hidden rounded-window p-0"
      >
        <div className="border-b border-border-subtle px-4 py-3">
          <DialogTitle className="text-section font-medium text-foreground">
            {t('bot.mcpRemoveConfirmTitle')}
          </DialogTitle>
        </div>
        <div className="px-4 py-3">
          <DialogDescription className="text-caption leading-relaxed text-muted-foreground">
            {t('bot.mcpRemoveConfirmBody', { name: serverName })}
          </DialogDescription>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
          <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={onCancel}>
            {t('settings.cancel')}
          </Button>
          <Button variant="destructive" size="sm" type="button" disabled={busy} onClick={onConfirm}>
            {busy ? t('bot.mcpRemoving') : t('bot.mcpRemoveBtn')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
