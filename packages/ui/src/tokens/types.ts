export type ThemeMode = 'obsidian-gold' | 'jade-white' | 'warm-paper' | 'ayu-light' | 'cyber-matrix';

export interface UIState {
  theme: ThemeMode;
  lang: 'zh' | 'en';
  leftRailCollapsed: boolean;
  inspectorCollapsed: boolean;
  activeInspectorTab: 'artifacts' | 'browser' | 'git' | 'profile';
  selectedModel: string;
  reasoningLevel: 'default' | 'none' | 'low' | 'high' | 'max';
  /** 网关 `approvals.mode` 三态；与 InputDockProps 同源，禁止再出现 auto/ask/sandbox 别名。 */
  approvalMode: 'manual' | 'smart' | 'off';
}
