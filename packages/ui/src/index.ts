// 此 barrel 仅供打包消费者使用（例如 esbuild bundle）。裸浏览器模块环境禁止直接导入，避免解析 react/jsx-runtime 等裸依赖失败。
export * from './tokens/tokens.js';
export * from './tokens/types.js';
export * from './tokens/skins.js';
export * from './i18n/index.js';
export * from './components/Titlebar/Titlebar.js';
export {
  buildLeftRailModel,
  toSnippet,
  formatLeftRailTime,
  isSessionFocused,
  isGroupFocused,
  isBotFocused,
  type LeftRailTab,
  type LeftRailModel,
  type LeftRailModelInput,
  type LeftRailSession,
  type LeftRailGroupRoom,
  type LeftRailProject,
  type LeftRailProfile,
  type LeftRailActiveFocus,
  type ActivityState as LeftRailActivityState,
} from './components-react/leftRailModel.js';
export * from './components/MiddlePod/MiddlePod.js';
export { mountFileTypeSprite, renderFileTypeIcon, resolveFileTypeIcon } from './lib/fileTypeIcons.js';
export { warmUpHighlighting, isHighlightReady } from './lib/highlight.js';
export { extractToolTarget, isLikelyFilePath } from './lib/text.js';
export {
  UI_FONT_OPTIONS,
  MONO_FONT_OPTIONS,
  getUiFontSelectOptions,
  DEFAULT_UI_FONT,
  DEFAULT_MONO_FONT,
  resolveFontStack,
  type UiFontId,
  type MonoFontId,
  type FontSizeScale,
} from './tokens/fonts.js';
export {
  loadFontPreferences,
  saveFontPreferences,
  applyFontPreferences,
  DEFAULT_FONT_PREFERENCES,
  type FontPreferences,
} from './tokens/fontPreferences.js';
export * from './components/InputDock/InputDock.js';
export * from './components/InspectionPod/InspectionPod.js';
export * from './components/StatusBar/StatusBar.js';
export * from './components/SettingsModal/SettingsModal.js';
export * from './components/MiddlePod/WorkerDelegationCard.js';
export * from './components/MiddlePod/BtwCapsule.js';
export * from './components/InspectionPod/SubagentTerminalView.js';
export * from './components/Bot/BotProfileCard.js';
export * from './components/Group/GroupRoomView.js';
export * from './components/Group/GroupPromotionDialog.js';
export * from './components/Project/ProjectTreeViewer.js';
export * from './components/TaskModal/NewTaskModal.js';
export * from './components/Modal/ConfirmModal.js';
export * from './components/ContextMenu/ContextMenu.js';
export * from './components/Bot/AgentProfileEditorModal.js';
export * from './utils/imagePreprocessor.js';
export * from './components-react/primitives/index.js';
export { StatusBar, type StatusBarProps } from './components-react/StatusBar.js';
export { Titlebar, type TitlebarProps as ReactTitlebarProps } from './components-react/Titlebar.js';
export { LeftRail as ReactLeftRail, type LeftRailProps as ReactLeftRailProps } from './components-react/LeftRail.js';
export * from './components-react/conversation/index.js';
export { renderLeftRailHtml, type LeftRailHtmlSnapshot } from './components-react/leftRailStaticRender.js';
export { renderBotAvatar, escapeHtml } from './utils/botAvatar.js';
export { mountStatusBar, mountTitlebar, mountLeftRail, type StatusBarSnapshot, type TitlebarSnapshot, type LeftRailSnapshot, type LeftRailActions } from './components-react/mount-shell-components.js';
export { getStatusBarSnapshot, getTitlebarSnapshot } from './components-react/mount-shell-components.js';
export * from './motion/index.js';

