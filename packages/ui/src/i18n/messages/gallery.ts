/**
 * 功能域：设计系统样例页（gallery）
 *
 * 约束与规则 (Rules)：
 *   1. 禁止给下面两个对象加任何类型注解。一旦写成 `Record<string, string>`，
 *      该域全部 key 会从 I18nKey 联合中消失（消费者 t() 立即报 TS2345），
 *      key-guard.ts 还会逐域断言 key 必须保持字面量联合（TS2344）。
 *   2. 一行一词条，禁止同行压缩：同行压缩会污染 diff 并掩盖漏译。
 */
export const zhGallery = {
  // Gallery 样例页（设计系统原子的真实形态拼装，仅供人工截图审查，不进入生产挂载点）
  'gallery.title': '模型供应商',
  'gallery.subtitle': '{count} 个提供商在线',
  'gallery.sync': '同步模型',
  'gallery.addProvider': '添加提供商',
  'gallery.providerAnthropic': 'Anthropic',
  'gallery.providerOpenAI': 'OpenAI',
  'gallery.providerLocal': '本地推理节点',
  'gallery.providerModels': '{count} 个模型',
  'gallery.providerCurrent': '使用中',
  'gallery.providerRecent': '最近使用',
  'gallery.providerDisabled': '已停用',
  'gallery.statProviders': '提供商',
  'gallery.statModels': '可用模型',
  'gallery.statLatency': '平均首字延迟',
  'gallery.statProvidersDelta': '较上周 +1',
  'gallery.statModelsDelta': '本周新增 6 个',
  'gallery.statLatencyDelta': '超过阈值 200ms',
  'gallery.noticeTitle': '关于本样例页',
  'gallery.noticeBody': '本页由 Surface / ListRow / Toolbar / Stat 四个原子组合而成，用于截图审查真实形态下的几何与字阶。它不进入生产挂载点，也不发起任何网关调用。',
  'gallery.fontUiLabel': '界面字体（皮肤槽位 --font-sans）',
  'gallery.fontUiSample': '界面文字使用界面字体。在设置里更换后，所有表面同时跟随，不需要改任何组件。',
  'gallery.fontCodeLabel': '代码字体（皮肤槽位 --font-mono）',
  'gallery.fontCodeSample': 'hermes gateway --profile default --transport ws',
};

export const enGallery = {
  // Gallery sample page (design-system atoms assembled; screenshot review only, never mounted in production)
  'gallery.title': 'Model Providers',
  'gallery.subtitle': '{count} providers online',
  'gallery.sync': 'Sync models',
  'gallery.addProvider': 'Add provider',
  'gallery.providerAnthropic': 'Anthropic',
  'gallery.providerOpenAI': 'OpenAI',
  'gallery.providerLocal': 'Local inference node',
  'gallery.providerModels': '{count} models',
  'gallery.providerCurrent': 'Active',
  'gallery.providerRecent': 'Recently used',
  'gallery.providerDisabled': 'Disabled',
  'gallery.statProviders': 'Providers',
  'gallery.statModels': 'Models',
  'gallery.statLatency': 'Avg first token',
  'gallery.statProvidersDelta': '+1 vs last week',
  'gallery.statModelsDelta': '6 added this week',
  'gallery.statLatencyDelta': 'Above 200ms threshold',
  'gallery.noticeTitle': 'About this sample',
  'gallery.noticeBody': 'This page is assembled from the Surface / ListRow / Toolbar / Stat atoms to review real-shape geometry and type scale in screenshots. It is never mounted in production and makes no gateway calls.',
  'gallery.fontUiLabel': 'UI font (follows the skin slot --font-sans)',
  'gallery.fontUiSample': 'Interface text uses the UI font. Switching it in settings changes every surface at once.',
  'gallery.fontCodeLabel': 'Code font (follows the skin slot --font-mono)',
  'gallery.fontCodeSample': 'hermes gateway --profile default --transport ws',
};
