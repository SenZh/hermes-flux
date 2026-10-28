export type ThemeMode = 'obsidian-gold' | 'jade-white';

export interface UIState {
  theme: ThemeMode;
  lang: 'zh' | 'en';
  leftRailCollapsed: boolean;
  inspectorCollapsed: boolean;
  activeInspectorTab: 'artifacts' | 'browser' | 'git' | 'profile';
  selectedModel: string;
  reasoningLevel: 'off' | 'low' | 'medium' | 'high';
  approvalMode: 'auto' | 'ask' | 'sandbox';
}
