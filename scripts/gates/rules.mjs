/**
 * Hermes Flux 门禁规则集（可执行规格）
 *
 * 每条规则 = { id, gate, title, files, check }，check 返回违规数组。
 * 规则必须只用 scanner 提供的「去注释源码行视图」，不得直接读原始行做判定，
 * 否则注释里的示例代码会被误报。
 *
 * 违规对象统一形状：{ file, line, ruleId, message, snippet }
 */

import { hasInlineAllowance, matchAll } from './lib/scanner.mjs';

/* ------------------------------------------------------------------ *
 * 共用判定原语
 * ------------------------------------------------------------------ */

/**
 * 是否属于「换肤面」：会渲染出像素的源码。
 * 这些文件必须零硬编码主题色、零硬编码文案。
 */
export function isSkinSurface(rel) {
  return (
    rel.startsWith('packages/ui/src/components/') ||
    rel.startsWith('packages/desktop/src/renderer/') ||
    rel.startsWith('packages/ui/src/i18n/')
  );
}

/**
 * 中性遮蔽色豁免。
 *
 * 设计意图：纯黑/纯白 + 透明度构成的阴影、遮罩、高光叠层，
 * 其语义是「压暗/提亮一层」，不承载色相信息，跨皮肤保持中性，不属于死色值。
 * 一旦放行它们，门禁才能把注意力集中在真正需要换肤的带色相颜色上。
 *
 * 必须覆盖全部合法写法，否则会大量误报：
 *   - 3/4 位短写：        #000 / #0008 / #fff / #fffc
 *   - 6/8 位全写：        #000000 / #00000080 / #ffffff / #FFFFFF1A
 *   - 逗号分隔 rgb/rgba： rgba(0, 0, 0, 0.5) / rgb(255,255,255)
 *   - 现代空格/斜杠语法： rgb(0 0 0) / rgb(0 0 0 / 50%)
 */
const NEUTRAL_COLOR =
  /^(?:#(?:000[0-9a-fA-F]?|000000[0-9a-fA-F]{2}|fff[0-9a-fA-F]?|ffffff[0-9a-fA-F]{2})|rgba?\(\s*(?:0\s*,\s*0\s*,\s*0|255\s*,\s*255\s*,\s*255)\s*(?:,[^)]*)?\)|rgba?\(\s*(?:0\s+0\s+0|255\s+255\s+255)\s*(?:[/,][^)]*)?\))$/i;

/** 从一行中抽取所有字面量颜色 token */
function extractColorLiterals(line) {
  const tokens = new Set();
  // HTML 实体（&#039; / &#39 / &#x27;）会被误识别为色值，必须先剔除。
  // 分号可选：HTML 允许省略末尾分号，`&#039` 同样不应算颜色。
  const sanitized = line.replace(/&#0*39;?|&#x0*27;?/gi, '  ');
  /**
   * 单条正则覆盖 3/4/6/8 位十六进制。
   * 关键：不能用 `\b` 作右边界——`#ABCD` 中 `#ABC` 之后紧跟 `D`（同为 word 字符），
   * `\b` 不成立，4 位色值会整体漏检（实测 #ABCD / #fffc / #0908 全部放行）。
   * 必须显式按长度分支并排除后续十六进制字符。
   * 左边界排除 `&`，避免把 `&#039` 这类实体的剩余部分当作色值。
   */
  const patterns = [
    /(?<![0-9a-zA-Z_&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-fA-F])/g,
    /rgba?\([^)]*\)/gi,
    /hsla?\([^)]*\)/gi,
  ];
  for (const re of patterns) {
    for (const m of matchAll(sanitized, re)) tokens.add(m[0]);
  }
  return [...tokens];
}

/* ------------------------------------------------------------------ *
 * Gate 0 · 架构符合性
 * ------------------------------------------------------------------ */

const architectureRules = {
  id: 'arch',
  gate: 'Gate 0',
  title: '架构符合性（分层单向依赖 / 严禁类型逃逸）',
  check(file, ctx) {
    const out = [];
    const { codeLines, rawLines } = ctx;

    // 依赖方向：core 不得依赖 ui/desktop；ui 不得依赖 desktop/electron
    const forbidden = file.startsWith('packages/core/')
      ? { re: /(?:from|import)\s*\(?\s*['"][^'"]*(\/ui\/|@hermes-flux\/ui|@hermes-flux\/desktop|electron)/, why: 'core 必须保持平台无关，禁止依赖 ui / desktop / electron' }
      : file.startsWith('packages/ui/')
        ? { re: /(?:from|import)\s*\(?\s*['"][^'"]*(@hermes-flux\/desktop|electron)/, why: 'ui 层禁止依赖 desktop 壳或 electron 运行时' }
        : null;

    if (forbidden) {
      codeLines.forEach((line, i) => {
        if (!forbidden.re.test(line)) return;
        if (hasInlineAllowance(rawLines, i, 'arch')) return;
        out.push({
          file,
          line: i + 1,
          lineIdx: i,
          ruleId: 'arch/layer-direction',
          message: forbidden.why,
          snippet: line.trim().slice(0, 110),
        });
      });
    }

    // 跨端宿主隔离规则：packages/core 与 packages/ui 禁止直接导入 Node 原生模块
    if ((file.startsWith('packages/core/src/') || file.startsWith('packages/ui/src/')) && !file.includes('/__tests__/')) {
      codeLines.forEach((line, i) => {
        // 匹配针对 Node 核心模块的静态引用（electron 由 layer-direction 规则专门管控）
        const m = /(?:from|import)\s*\(?\s*['"](?:node:)?(child_process|fs|fs\/promises|os)['"]/.exec(line);
        if (!m) return;
        if (hasInlineAllowance(rawLines, i, 'arch')) return;
        out.push({
          file,
          line: i + 1,
          lineIdx: i,
          ruleId: 'arch/no-host-leak',
          message: `跨端宿主隔离违规：禁止在通用包直接导入宿主专有模块 "${m[1]}"，必须经由 PAL 接口注入`,
          snippet: line.trim().slice(0, 110),
        });
      });
    }

    // 类型逃逸：as any / as unknown as / <any>
    // 注意：门禁脚本自身的「检测模式」就是这些字面量（如 /as\s+any/），
    // 那是规则定义而非真实类型断言，必须排除，否则门禁会举报自己。
    if (!file.includes('/__tests__/') && !file.startsWith('scripts/gates/')) {
      codeLines.forEach((line, i) => {
        const m = /\bas\s+any\b|\bas\s+unknown\s+as\b|:\s*any\b|<any>/.exec(line);
        if (!m) return;
        if (hasInlineAllowance(rawLines, i, 'arch')) return;
        out.push({
          file,
          line: i + 1,
          lineIdx: i,
          ruleId: 'arch/type-escape',
          message: '禁止类型断言降级到 any（Anti-Slop Ratchet：新增违规必须为 0）',
          snippet: line.trim().slice(0, 110),
        });
      });
    }

    // 渲染层禁止绕开 Core 直接发裸网络请求
    if (file.startsWith('packages/desktop/src/renderer/') || file.startsWith('packages/ui/src/')) {
      codeLines.forEach((line, i) => {
        if (!/\bfetch\s*\(|new\s+XMLHttpRequest\b|\bnew\s+WebSocket\b/.test(line)) return;
        // 允许在数字/字符串之外的本仓 RPC 封装：显式豁免注释
        if (hasInlineAllowance(rawLines, i, 'arch')) return;
        out.push({
          file,
          line: i + 1,
          lineIdx: i,
          ruleId: 'arch/no-bare-transport',
          message: 'UI/渲染层必须经由 Core（HermesGatewayClient / PAL）通信，禁止自建裸传输',
          snippet: line.trim().slice(0, 110),
        });
      });
    }

    return out;
  },
};

/* ------------------------------------------------------------------ *
 * Gate 4a · 换肤一致性
 * ------------------------------------------------------------------ */

const themeRules = {
  id: 'theme',
  gate: 'Gate 4',
  title: '换肤一致性（零硬编码色相 / 全量走 Design Tokens）',
  check(file, ctx) {
    if (!isSkinSurface(file)) return [];
    // 皮肤注册表与被剥离的调色板常量本身就是颜色权威源
    if (file.includes('/tokens/')) return [];

    const out = [];
    ctx.codeLines.forEach((line, i) => {
      const colors = extractColorLiterals(line).filter((c) => !NEUTRAL_COLOR.test(c.trim()));
      if (colors.length === 0) return;
      if (hasInlineAllowance(ctx.rawLines, i, 'theme')) return;

      const isBrandAsset = file.includes('InspectionPod') && /language-|file-icon|badge/i.test(line);
      out.push({
        file,
        line: i + 1,
        lineIdx: i,
        ruleId: 'theme/no-hardcoded-color',
        message: `硬编码色相 ${colors.join(' ')} 无法随皮肤切换，必须改用 var(--accent) / var(--bg-*) 等 Token${isBrandAsset ? '（语言徽标品牌色亦须走 Token）' : ''}`,
        snippet: line.trim().slice(0, 110),
      });
    });
    return out;
  },
};

/* ------------------------------------------------------------------ *
 * Gate 4b · i18n
 * ------------------------------------------------------------------ */

/** 允许出现中文字面量的文件（权威字典本身） */
const I18N_EXEMPT = [
  'packages/ui/src/i18n/index.ts',
  'packages/ui/src/tokens/themeRegistry.ts', // 皮肤显示名属于数据而非文案
  'packages/ui/src/tokens/tokens.ts',
];

/**
 * 允许出现中文的文件（语言/地区数据、正则字符类）。
 * 每一条都必须写明理由，禁止无理由白名单。
 *
 * 历史坑：曾用两条极宽的正则 `中-中`、`中/中` 放行任何命中行，
 * 实测会把「已连接-正常」「思考中 – 请稍候」这类真实 UI 文案一并放行，
 * 等于给 i18n 门禁留了永久后门。现改为「仅整行是纯字符类/枚举赋值」才放行。
 */
const I18N_ALLOW_PATTERNS = [
  // 仅允许形如 const X = '中-中'; 的字符类/枚举常量，且行内不得出现 HTML 标签
  /^\s*(?:export\s+)?const\s+\w+\s*=\s*['"][\u4e00-\u9fa5]{0,4}(?:[-–/][\u4e00-\u9fa5]{0,4})+['"]\s*;?\s*$/,
];

/**
 * 字典目录整体豁免。
 * 若按 messages/zh.ts、messages/en.ts 拆分字典，任一语种文件都必然充满中文，
 * 逐文件罗列会让门禁在拆分当天全体误报。因此按目录前缀豁免。
 */
const I18N_EXEMPT_DIRS = ['packages/ui/src/i18n/messages/'];

const i18nRules = {
  id: 'i18n',
  gate: 'Gate 4',
  title: 'i18n（零硬编码文案，全量走 t() 字典）',
  check(file, ctx) {
    if (!isSkinSurface(file)) return [];
    if (I18N_EXEMPT.includes(file)) return [];
    if (I18N_EXEMPT_DIRS.some((dir) => file.startsWith(dir))) return [];

    const out = [];
    ctx.codeLines.forEach((line, i) => {
      if (!/[\u4e00-\u9fa5]/.test(line)) return;
      if (hasInlineAllowance(ctx.rawLines, i, 'i18n')) return;
      // 仅「整行就是纯枚举常量」才算合法字符类，其余一律视为文案
      if (I18N_ALLOW_PATTERNS.some((re) => re.test(line))) return;

      const cjk = (line.match(/[\u4e00-\u9fa5]+/g) || []).join('|');
      out.push({
        file,
        line: i + 1,
        lineIdx: i,
        ruleId: 'i18n/no-hardcoded-text',
        message: `硬编码中文文案「${cjk.slice(0, 24)}」必须改走 t('key') 并同步 zhDict / enDict`,
        snippet: line.trim().slice(0, 110),
      });
    });
    return out;
  },
};

/* ------------------------------------------------------------------ *
 * Gate 4c · 性能不变量
 * ------------------------------------------------------------------ */

const perfRules = {
  id: 'perf',
  gate: 'Gate 4',
  title: '性能不变量（滚动/合成器/布局读取红线）',
  check(file, ctx) {
    if (!isSkinSurface(file)) return [];

    const checks = [
      {
        // 原文写法 `animation: 'pulse 2s';\n ... infinite ...` 会分处两行，
        // 逐行判定会漏检（实测跨行 0 违规）。因此改为整文件匹配后反查行号。
        fullTextRe: /animation[\s\S]{0,160}?\binfinite\b/gi,
        ruleId: 'perf/infinite-animation',
        message: '无休止 CSS 动画会让合成器持续 60fps 空转，必须接入集中时钟（useDurationTicker）并在折叠/失焦时停用',
      },
      {
        re: /scroll-behavior\s*:\s*smooth/i,
        ruleId: 'perf/smooth-scroll',
        message: '禁止 scroll-behavior: smooth，平滑滚动会与滚动补偿叠加成抖动',
      },
      {
        // 移动端 WebKit 避坑铁律：长列表滚动容器及其直接包装层严禁使用 CSS transform
        // transform 会破坏 WebKit GPU 滚动图层，导致软键盘弹出时发生 3~5 秒严重假死卡顿
        re: /(?:\.chat-scroll|#conversation-stream|\[data-scroll-container\])[\s\S]{0,120}?transform\s*:/i,
        ruleId: 'perf/no-transform-scroll',
        message: 'WebKit 移动端避坑红线：会话滚动容器严禁使用 CSS transform，必须改为 padding-bottom 动态视口避让',
      },
      {
        re: /content-visibility|contain-intrinsic-size/i,
        ruleId: 'perf/estimated-height',
        message: '禁止用估算高度替代真实布局（会破坏跟随模式判定与 StreamAnchor 补偿）',
      },
      {
        re: /\.(?:toLocaleTimeString|toLocaleDateString)\s*\(|\bIntl\.(?:DateTimeFormat|NumberFormat)\b/,
        ruleId: 'perf/intl-in-hot-path',
        message: '渲染热路径禁止 Intl 格式化（单次开销可达毫秒级），必须改为纯算术格式化',
      },
    ];

    const out = [];
    const seen = new Set();

    /** 把字符偏移换算成 1-based 行号 */
    const lineAt = (offset) => {
      let line = 1;
      for (let k = 0; k < offset; k += 1) if (ctx.stripped[k] === '\n') line += 1;
      return line;
    };

    for (const c of checks) {
      // 全文级规则
      if (c.fullTextRe) {
        const re = new RegExp(c.fullTextRe.source, c.fullTextRe.flags);
        let m;
        while ((m = re.exec(ctx.stripped)) !== null) {
          const lineNo = lineAt(m.index);
          const idx = lineNo - 1;
          if (hasInlineAllowance(ctx.rawLines, idx, 'perf')) continue;
          const key = `${c.ruleId}:${lineNo}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            file,
            line: lineNo,
            lineIdx: idx,
            ruleId: c.ruleId,
            message: c.message,
            snippet: (ctx.rawLines[idx] ?? '').trim().slice(0, 110),
          });
          if (m.index === re.lastIndex) re.lastIndex += 1;
        }
        continue;
      }

      ctx.codeLines.forEach((line, i) => {
        if (!c.re.test(line)) return;
        if (hasInlineAllowance(ctx.rawLines, i, 'perf')) return;
        const key = `${c.ruleId}:${i + 1}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({
          file,
          line: i + 1,
          lineIdx: i,
          ruleId: c.ruleId,
          message: c.message,
          snippet: line.trim().slice(0, 110),
        });
      });
    }

    return out.sort((a, b) => a.line - b.line);
  },
};

/**
 * Gate 4d · 几何规范一致性
 *
 * 设计意图：
 *   AGENTS.md 的 Gate 4 明确要求「布局与设计规范强一致断言」（StatusBar 22px、
 *   输入舱 740px）。原先只做了颜色与文案断言，几何尺寸完全没有门禁守护，
 *   导致规范与实现长期漂移而无人发现。
 *
 * 约束：
 *   只断言「可被静态确证的常量」，不做渲染测量（那属于 CDP 测试职责）。
 *   已知偏差必须以 warning 显式暴露，不得静默放过，也不得为迁就实现而
 *   反向篡改规范值——门禁一旦向实现妥协，规范就彻底失效了。
 */

/** 已知的「实现偏离规范」登记簿。每条都必须写清实际值与待修原因。 */
const KNOWN_LAYOUT_DEVIATIONS = [
  {
    id: 'statusbar-height',
    file: 'packages/ui/src/components/StatusBar/StatusBar.ts',
    spec: 22,
    specSource: 'AGENTS.md 六-2 / docs/design-system/04-tokens-and-design-system-spec.md',
    actualPattern: /height:\s*(\d+)px/,
    reason: '规范要求 22px，实现为 28px。待修正实现或修订规范，二者必须择一对齐。',
  },
  {
    id: 'inspector-right-width',
    file: 'packages/ui/src/components/InspectionPod/InspectionPod.ts',
    spec: 410,
    specSource: 'AGENTS.md 六-2（检查舱总宽 410px = 详情舱 348px + 竖向轨 62px）',
    actualPattern: /var\(--rail-w-right,\s*(\d+)px\)/,
    reason: '规范要求 410px，实现默认 420px。待修正实现或修订规范。',
  },
];

const layoutRules = {
  id: 'layout',
  gate: 'Gate 4',
  title: '几何规范一致性（黄金限宽 / 检查舱分栏 / 状态栏高度）',
  /**
   * @param {string} file
   * @param {{codeLines: string[], rawLines: string[], warnings: Array}} ctx
   */
  check(file, ctx) {
    if (!isSkinSurface(file)) return [];
    const out = [];
    const joined = ctx.codeLines.join('\n');

    // 输入舱必须锁定 740px 黄金限宽——这是硬性可静态断言的常量
    if (file.endsWith('InputDock/InputDock.ts') && !/max-width:\s*740px/.test(joined)) {
      out.push({
        file,
        line: 1,
        lineIdx: 0,
        ruleId: 'layout/input-dock-width',
        message: 'InputDock 必须保持 max-width: 740px 黄金限宽（AGENTS.md 六-2）',
        snippet: '',
      });
    }

    // 已登记偏差：实际值与规范不符时进 warnings（不阻断，但不隐身）
    for (const d of KNOWN_LAYOUT_DEVIATIONS) {
      const targetSuffix = d.file.startsWith('packages/ui/src/components/')
        ? d.file.replace('packages/ui/src/components/', '')
        : d.file;
      if (!file.endsWith(targetSuffix)) continue;
      const m = d.actualPattern.exec(joined);
      if (!m) continue;

      if (typeof d.spec === 'number') {
        const actual = Number(m[1]);
        if (!Number.isNaN(actual)) {
          if (actual === d.spec) continue;
          ctx.warnings.push({
            file,
            line: 1,
            ruleId: `layout/${d.id}`,
            message: `实现 ${actual}px 与规范 ${d.spec}px 不一致（${d.reason}）`,
          });
          continue;
        }
      }

      // 非数字匹配类偏差（如无效死选择器）
      ctx.warnings.push({
        file,
        line: 1,
        ruleId: `layout/${d.id}`,
        message: d.reason,
      });
    }

    return out;
  },
};

export const RULES = [architectureRules, themeRules, i18nRules, perfRules, layoutRules];

export { KNOWN_LAYOUT_DEVIATIONS };
