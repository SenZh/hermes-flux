/**
 * Hermes Flux 门禁规则集（可执行规格）
 *
 * 每条规则 = { id, gate, title, files, check }，check 返回违规数组。
 * 规则必须只用 scanner 提供的「去注释源码行视图」，不得直接读原始行做判定，
 * 否则注释里的示例代码会被误报。
 *
 * 违规对象统一形状：{ file, line, ruleId, message, snippet }
 */

import fs from 'node:fs';
import path from 'node:path';
import { hasInlineAllowance, matchAll, REPO_ROOT } from './lib/scanner.mjs';

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
    rel.startsWith('packages/ui/src/components-react/') ||
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

    // 输入舱必须锁定 740px 黄金限宽——这是硬性可静态断言的常量。
    // 重设计后几何归口 conversation.css，因此要取 `.input-card-box.composer-dock` 那一个规则块，
    // 而不是全文 includes：整个样式表里有 4 处 740px，删掉外壳那条仍然会绿。
    if (file.endsWith('InputDock/InputDock.ts')) {
      const dockCssPath = path.join(REPO_ROOT, 'packages/ui/src/styles/conversation.css');
      const dockCss = fs.existsSync(dockCssPath) ? fs.readFileSync(dockCssPath, 'utf8') : '';
      const shellRule = /\.input-card-box\.composer-dock\s*\{([\s\S]*?)\}/.exec(dockCss);
      if (!shellRule || !/max-width:\s*740px/.test(shellRule[1])) {
        out.push({
          file,
          line: 1,
          lineIdx: 0,
          ruleId: 'layout/input-dock-width',
          message: '输入舱外壳 .input-card-box.composer-dock 必须声明 max-width: 740px（AGENTS.md 六-2）',
          snippet: '',
        });
      }
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

/**
 * Gate 0b · 失败不可静默（Silent Catch Ban）
 *
 * 设计意图 (Why):
 *   本次四个线上问题里有三个的共同根因是"错误被吞成空数据"：
 *   profiles.get_asset 的 4000 被 catch 成 null（头像永远拉不到）、
 *   subagent.tail 的 4000 被吞成"没有日志"、心跳用不存在的方法名后被 catch 吞掉
 *   （看门狗从未生效）。文档里写了"Failure Is Not Empty"，但没有探针，等于不存在。
 *
 * 防范的历史坑 (Pitfall):
 *   只靠 code review 抓不住这类问题——空 catch 在 diff 里毫不起眼，
 *   但会让所有证据消失，把可定位的错误变成不可定位的"没数据"。
 *
 * 约束与规则 (Rules):
 *   - 允许合法降级，但必须在 catch 上一行写 `// gate-degrade: 为什么该失败等价于空`；
 *   - 只拦"完全空体"与"仅返回空值"两类；带日志/带兜底赋值的 catch 放行；
 *   - 与 arch 规则一样纳入债务棘轮：存量冻结，新增零容忍。
 */
const integrityRules = {
  id: 'integrity',
  gate: 'Gate 0',
  title: '失败不可静默（禁止 catch 吞掉错误）',
  check(file, ctx) {
    if (!/\.(ts|tsx|js|mjs)$/.test(file)) return [];

    const out = [];
    const src = ctx.stripped;
    const catchRe = /catch\s*(?:\([^)]*\))?\s*\{/g;
    let m;

    while ((m = catchRe.exec(src)) !== null) {
      const bodyStart = m.index + m[0].length;
      let depth = 1;
      let i = bodyStart;
      for (; i < src.length; i += 1) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const body = src.slice(bodyStart, i);
      const normalized = body.replace(/[\s;]/g, '');

      const isEmpty = normalized === '';
      const isReturnOnly =
        /^return(?:null|undefined|\[\]|\{\}|void0|false|true)$/.test(normalized) ||
        /^return[A-Za-z_$][\w$]*$/.test(normalized);

      if (!isEmpty && !isReturnOnly) continue;

      const lineNo = lineAt(src, m.index);
      const lineIdx = lineNo - 1;
      if (hasInlineAllowance(ctx.rawLines, lineIdx, 'degrade')) continue;
      // 降级语义专用标记：`// gate-degrade: 理由`
      const currentRaw = ctx.rawLines[lineIdx] ?? '';
      const prevRaw = lineIdx > 0 ? (ctx.rawLines[lineIdx - 1] ?? '') : '';
      if (currentRaw.includes('gate-degrade:') || prevRaw.includes('gate-degrade:')) continue;

      out.push({
        file,
        line: lineNo,
        lineIdx,
        ruleId: 'integrity/silent-catch',
        message:
          '禁止把失败静默吞成空值：catch 必须记录日志或显式抛出；确需降级时在上一行写 // gate-degrade: 理由',
        snippet: (ctx.rawLines[lineIdx] ?? '').trim().slice(0, 110),
      });
    }

    return out;
  },
};

/** 字符偏移换算成 1-based 行号 */
function lineAt(text, offset) {
  let line = 1;
  for (let k = 0; k < offset; k += 1) if (text[k] === '\n') line += 1;
  return line;
}

/* ------------------------------------------------------------------ *
 * Gate 4 · PR-1b 新增设计系统迁移警示探针（Warning-Only，零阻断不扩基线）
 * ------------------------------------------------------------------ */

/**
 * 探针 ①：ui/no-new-template-export
 * 设计意图 (Why):
 *   前端向 React / shadcn / Tailwind (波③) 迁移期间，严禁向 ui/src/components 增添
 *   新的字符串模板组件与导出。存量清单冻结在 .template-inventory.json 中。
 * 历史坑 (Pitfall):
 *   若不限制 renderXxx 导出，开发者会在既有文件里大量扩写模板函数，延误迁移。
 * 约束与规则 (Rules):
 *   Warning-only 探针，不进入阻断池，不修改基线文件。
 */
const INVENTORY_FILE = path.join(REPO_ROOT, 'scripts/gates/.template-inventory.json');
let cachedInventory = null;
function getTemplateInventory() {
  if (!cachedInventory) {
    if (fs.existsSync(INVENTORY_FILE)) {
      try {
        cachedInventory = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'));
      // gate-degrade: 清单文件损坏或读取失败时优雅降级为空清单，由门禁探针拦截
      } catch {
        cachedInventory = { files: {} };
      }
    } else {
      cachedInventory = { files: {} };
    }
  }
  return cachedInventory;
}

const templateExportRules = {
  id: 'ui-template',
  gate: 'Gate 4',
  title: '模板导出冻结（ui/no-new-template-export，只减不增）',
  check(file, ctx) {
    if (!file.startsWith('packages/ui/src/components/')) return [];
    if (!file.endsWith('.ts') || file.endsWith('.d.ts') || file.includes('/components/ui/')) return [];

    const inventory = getTemplateInventory();
    const knownFiles = inventory.files ?? {};
    if (!ctx.warnings) ctx.warnings = [];

    if (!knownFiles[file]) {
      if (!hasInlineAllowance(ctx.rawLines, 0, 'template')) {
        ctx.warnings.push({
          file,
          line: 1,
          ruleId: 'ui/no-new-template-export',
          message: `[ui/no-new-template-export] 禁止新增模板组件文件（当前处于波③ React/shadcn 迁移期，新组件必须使用 .tsx）：${file}`,
        });
      }
      return [];
    }

    const knownExports = new Set(knownFiles[file] ?? []);
    const stripped = ctx.stripped;

    // 匹配 export function renderXxx
    for (const m of stripped.matchAll(/export\s+(?:async\s+)?function\s+(render[A-Za-z0-9_]+)/g)) {
      const fnName = m[1];
      if (!knownExports.has(fnName)) {
        const lineNo = lineAt(stripped, m.index);
        if (hasInlineAllowance(ctx.rawLines, lineNo - 1, 'template')) continue;
        ctx.warnings.push({
          file,
          line: lineNo,
          ruleId: 'ui/no-new-template-export',
          message: `[ui/no-new-template-export] :${lineNo} 禁止新增模板函数导出 ${fnName}（存量清单已冻结，新逻辑必须使用 React 组件）`,
        });
      }
    }

    // 匹配 export const renderXxx =
    for (const m of stripped.matchAll(/export\s+const\s+(render[A-Za-z0-9_]+)\s*=/g)) {
      const fnName = m[1];
      if (!knownExports.has(fnName)) {
        const lineNo = lineAt(stripped, m.index);
        if (hasInlineAllowance(ctx.rawLines, lineNo - 1, 'template')) continue;
        ctx.warnings.push({
          file,
          line: lineNo,
          ruleId: 'ui/no-new-template-export',
          message: `[ui/no-new-template-export] :${lineNo} 禁止新增模板函数导出 ${fnName}（存量清单已冻结，新逻辑必须使用 React 组件）`,
        });
      }
    }

    return [];
  },
};

/**
 * 探针 ②：theme/no-inline-hex
 * 设计意图 (Why):
 *   现规则漏检了模板字符串内联 style 中的十六进制色（如跨行或模板内联属性），
 *   使局部死色值无法随皮肤切换。
 * 历史坑 (Pitfall):
 *   单行正则容易漏检跨行 style="..." 内联样式。本探针全文扫描内联 style 属性。
 */
const inlineHexRules = {
  id: 'theme-inline-hex',
  gate: 'Gate 4',
  title: '模板内联色相审计（theme/no-inline-hex）',
  check(file, ctx) {
    if (!isSkinSurface(file) || file.includes('/tokens/')) return [];
    if (!ctx.warnings) ctx.warnings = [];

    const inlineStyleRe = /style\s*=\s*(["'])([\s\S]*?)\1/gi;
    let m;
    while ((m = inlineStyleRe.exec(ctx.stripped)) !== null) {
      const styleBlock = m[2];
      const hexMatches = styleBlock.match(/#[0-9a-fA-F]{3,8}\b/g);
      if (!hexMatches) continue;

      const matchStart = m.index;
      for (const hex of hexMatches) {
        const hexOffset = matchStart + m[0].indexOf(hex);
        const lineNo = lineAt(ctx.stripped, hexOffset);
        const lineIdx = lineNo - 1;
        if (hasInlineAllowance(ctx.rawLines, lineIdx, 'theme')) continue;

        ctx.warnings.push({
          file,
          line: lineNo,
          ruleId: 'theme/no-inline-hex',
          message: `[theme/no-inline-hex] :${lineNo} 模板字符串内联 style 包含十六进制色 ${hex}，无法随皮肤切换，必须改用 var(--*) 语义 Token`,
        });
      }
    }

    return [];
  },
};

/**
 * 探针 ③：theme/no-raw-monospace
 * 设计意图 (Why):
 *   字重和排版必须收敛至 Token，禁止绕过 --font-mono 变量直接裸写 font-family: monospace。
 */
const rawMonospaceRules = {
  id: 'theme-monospace',
  gate: 'Gate 4',
  title: '等宽字体变量收敛（theme/no-raw-monospace）',
  check(file, ctx) {
    if (!isSkinSurface(file) || file.includes('/tokens/')) return [];
    if (!ctx.warnings) ctx.warnings = [];

    ctx.codeLines.forEach((line, i) => {
      const m = /font-family\s*:\s*([^;`"'>]+)/i.exec(line);
      if (!m) return;
      const val = m[1];
      if (/\bmonospace\b/i.test(val) && !/var\(--font-mono/i.test(val)) {
        if (hasInlineAllowance(ctx.rawLines, i, 'theme')) return;
        ctx.warnings.push({
          file,
          line: i + 1,
          ruleId: 'theme/no-raw-monospace',
          message: `[theme/no-raw-monospace] :${i + 1} 禁止裸写 font-family: monospace，必须改用 var(--font-mono)`,
        });
      }
    });

    return [];
  },
};

/**
 * 探针 ④：typo/no-literal-font-size
 * 设计意图 (Why):
 *   收敛散落字号（如 9.5px、10.5px、11.5px），强制组件使用设计系统 8 档节奏层变量（--fs-*）。
 * 白名单：
 *   ui/src/tokens/、styles.css 的 :root 节奏段。
 */
const literalFontSizeRules = {
  id: 'typo-font-size',
  gate: 'Gate 4',
  title: '字面量字号审计（typo/no-literal-font-size）',
  check(file, ctx) {
    if (!isSkinSurface(file) || file.includes('/tokens/')) return [];
    if (!ctx.warnings) ctx.warnings = [];

    ctx.codeLines.forEach((line, i) => {
      const fsMatches = line.match(/font-size\s*:\s*(\d+(?:\.\d+)?px)\b/gi);
      if (!fsMatches) return;
      if (
        hasInlineAllowance(ctx.rawLines, i, 'theme') ||
        hasInlineAllowance(ctx.rawLines, i, 'typo')
      ) {
        return;
      }
      for (const matchText of fsMatches) {
        ctx.warnings.push({
          file,
          line: i + 1,
          ruleId: 'typo/no-literal-font-size',
          message: `[typo/no-literal-font-size] :${i + 1} 发现字面量字号「${matchText.trim()}」，必须收敛至设计系统 7 档变量（--fs-*）`,
        });
      }
    });

    return [];
  },
};

/**
 * 探针 ⑤：theme/ghost-token
 * 设计意图 (Why):
 *   引用面 var(--x) ⊆ 定义面（皮肤块 + :root + 组件内联定义 + setProperty）。
 *   严防开发者手滑引用不存在或已更名的 CSS 变量导致界面样式悬空坍塌。
 * 口径复用：
 *   复用 packages/ui/__tests__/skins-sot.test.mjs（剥块注释/行尾注释、无回退才计）。
 */
let cachedDefinedCssVars = null;
function getDefinedCssVars() {
  if (!cachedDefinedCssVars) {
    cachedDefinedCssVars = new Set();
    const walk = (dir, out = []) => {
      if (!fs.existsSync(dir)) return out;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.(ts|tsx|js|mjs|css)$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const stripCommentsForVars = (s) =>
      s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');

    const dirs = [
      path.join(REPO_ROOT, 'packages/ui/src'),
      path.join(REPO_ROOT, 'packages/desktop/src'),
    ];
    for (const dir of dirs) {
      for (const f of walk(dir)) {
        try {
          const src = stripCommentsForVars(fs.readFileSync(f, 'utf8'));
          for (const m of src.matchAll(/(--[a-z0-9-]+)\s*:/gi)) cachedDefinedCssVars.add(m[1]);
          for (const m of src.matchAll(/setProperty\(\s*['"](--[a-z0-9-]+)['"]/g)) cachedDefinedCssVars.add(m[1]);
        // gate-degrade: 单个文件读取或解析失败时跳过该文件，不中断全量 CSS 变量收集
        } catch {}
      }
    }
  }
  return cachedDefinedCssVars;
}

const ghostTokenRules = {
  id: 'theme-ghost-token',
  gate: 'Gate 4',
  title: '幽灵令牌审计（theme/ghost-token 引用面⊆定义面）',
  check(file, ctx) {
    if (!isSkinSurface(file) || file.includes('/tokens/')) return [];
    if (!ctx.warnings) ctx.warnings = [];

    const definedVars = getDefinedCssVars();
    ctx.codeLines.forEach((line, i) => {
      for (const m of line.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,)?/gi)) {
        const varName = m[1];
        const hasFallback = Boolean(m[2]);
        if (!hasFallback && !definedVars.has(varName)) {
          if (hasInlineAllowance(ctx.rawLines, i, 'theme')) continue;
          ctx.warnings.push({
            file,
            line: i + 1,
            ruleId: 'theme/ghost-token',
            message: `[theme/ghost-token] :${i + 1} 引用未定义 CSS 变量 var(${varName}) 且无回退值，存在样式坍塌风险`,
          });
        }
      }
    });

    return [];
  },
};

/* ------------------------------------------------------------------ *
 * Gate 4e · 视觉契约（React 岛 / 样式表）
 * ------------------------------------------------------------------ */

/**
 * 【设计意图 (Why)】
 *   设计系统（docs/design-system/README.md）把圆角、阴影、字阶、配色收敛成有限语义档位，
 *   但「组件该怎么写类名」此前没有任何门禁约束。AI 生成的组件天然会写 rounded-md /
 *   shadow-lg / text-sm / bg-zinc-800 —— 这几类写法在公开语料里出现频率最高，
 *   于是同一张卡片在不同组件里圆角 4/6/8/12px 混用，硬编码灰阶也无法随皮肤切换。
 *   本组规则把「视觉契约」变成可执行断言：违规即给出目标档位与像素值，让 AI 与人类
 *   在提交前就拿到可直接照做的修复指令，而不是一句抽象的「不符合设计系统」。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 对整文件正则硬扫会把注释里的示例、i18n 文案、正则字面量一起误报，
 *      所以只分析「类名上下文字符串字面量区间」，其余文本一概不看；
 *   2. JSX 的 className={cn( ... )} 是跨行写法，逐行扫描必然漏检，
 *      因此先做全文区间提取、再用字符偏移反查行号（与 perfRules 的 fullTextRe 同口径）；
 *   3. 阻断型规则若上线即命中存量，门禁当天就会变红、随后被 --update-baseline 吃掉，
 *      永久失效。所以「当前存量非零」的两类（任意值 / 小数间距）只走 ctx.warnings：
 *      不阻断但每次运行都可见，既不清零判定也不制造假绿；
 *   4. 兜底值漂移（var(--radius-inner, 6px) 对 :root 的 4px）是最隐蔽的一类：
 *      真值缺失时才生效，本地「看起来没问题」，换皮肤/换客户端才暴露，
 *      所以必须与 :root 真值面逐条比对，而不是只看兜底值本身是否「像个数字」。
 *
 * 【约束与规则 (Rules)】
 *   - 作用域严格限定 React 岛与样式表（见 isVisualSurface），其它路径一律返回空；
 *   - 每条 message 必须同时是诊断 + 可执行修复指令（含目标档位与像素值）；
 *   - 全部支持行内豁免：违规行或其上一行写 `// gate-theme-allow: 理由`；
 *   - 合法档位：rounded-inner|card|panel|window|full、shadow-card|window|dock、
 *     text-hero|title|section|body|aux|caption|micro。
 */

/** 视觉契约作用域：React 岛 + 样式表（其余路径一律不管，避免波及存量模板组件） */
function isVisualSurface(rel) {
  return (
    rel.startsWith('packages/ui/src/components-react/') ||
    rel.startsWith('packages/ui/src/styles/') ||
    rel === 'packages/desktop/src/renderer/styles.css'
  );
}

/** 承载类名字符串的工厂/合并函数：命中这些调用的字面量才算类名上下文 */
const CLASS_CALL_FNS = new Set(['cn', 'cx', 'cva', 'clsx', 'classNames', 'twMerge', 'twJoin', 'tv']);

const QUOTE_CHARS = new Set(["'", '"', '`']);
const isIdentChar = (c) => c !== undefined && /[A-Za-z0-9_$]/.test(c);

/**
 * 字面量文本是否「像一串 Tailwind 类名」。
 * 只用于弱上下文（对象属性值 / 变量赋值）兜底，避免把 i18n key、路径串误判成类名。
 */
function looksLikeClassList(text) {
  for (const raw of text.split(/\s+/)) {
    if (!raw) continue;
    const seg = raw.split(':').pop() ?? raw;
    if (seg.includes('[')) return true;
    if (/^[a-z][a-z0-9]*(?:-[a-z0-9./]+)+$/i.test(seg)) return true;
  }
  return false;
}

/**
 * 判断某个字符串字面量是否处于「类名上下文」。
 *
 * 强上下文：className=/class=/classList= 直接赋值、JSX 花括号表达式内、或处于 cn/cva 等调用实参中；
 * 弱上下文：最近 200 字符内出现 *CLASS / *STYLE / *VARIANT / *TONE 之类的映射表键或赋值
 *          （此时还要求字面量内容确实像类名列表）。
 */
function classContextOf(src, quoteStart, callStack) {
  for (const name of callStack) {
    if (name && CLASS_CALL_FNS.has(name)) return 'strong';
  }
  const back = src.slice(Math.max(0, quoteStart - 200), quoteStart);
  /**
   * `[^{};]*\{?[^{};]*$` 是这里的关键边界：允许跨过**一个**花括号（JSX 表达式 / 对象字面量），
   * 但绝不跨过 `;` 或 `}`，所以判定范围天然被限制在当前语句内——
   * 否则整文件里第一个 className 会把后面所有字符串都判成类名。
   */
  if (/(?:\bclassName|\bclass|\bclassList)\s*[:=]\s*[^{};]*\{?[^{};]*$/.test(back)) return 'strong';
  /**
   * 弱上下文：类名映射表（LEVEL_CLASS / TONE_CLASS / variants / styles 等）与变量赋值。
   * 组件库最常见的写法是 `const LEVEL_CLASS: Record<string, string> = { panel: 'bg-panel' }`，
   * 它既不在 className 属性里也不在 cn() 实参里；不认这一条，
   * AI 只要把类名挪进映射表就能整张绕过门禁。
   * 代价是必须再要求字面量内容「像类名列表」，否则 variant="ghost" / font-style 会被误判。
   */
  if (/\b\w*(?:class|style|variant|tone)\w*\s*[:=]\s*[^{};]*\{?[^{};]*$/i.test(back)) return 'weak';
  return null;
}

/** 判断 pos 处的 `/` 是否开启正则字面量（与 scanner 的判定口径一致） */
function startsRegexLiteral(src, pos) {
  let j = pos - 1;
  while (j >= 0 && /\s/.test(src[j])) j -= 1;
  const prev = j >= 0 ? src[j] : '';
  if (prev === '') return true;
  if (/[(,=:[!&|?{};+\-*%^~<>]/.test(prev)) return true;
  return /\b(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)\s*$/.test(
    src.slice(Math.max(0, j - 12), j + 1),
  );
}

/**
 * 提取全部「类名上下文字符串字面量」区间。
 *
 * 单次线性扫描，同时维护调用栈（识别 cn/cva 实参）、跳过正则字面量（其中的 () 会污染调用栈）、
 * 并在 `;` 处清栈兜底：即便个别语法让栈漂移，污染也局限在单条语句内。
 *
 * @returns {{start: number, end: number, text: string}[]} start/end 为 stripped 中的字符偏移（不含引号）
 */
function collectClassRegions(src) {
  const out = [];
  const n = src.length;
  const callStack = [];
  let lastIdent = '';
  let i = 0;

  while (i < n) {
    const c = src[i];

    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === ';') {
      callStack.length = 0;
      lastIdent = '';
      i += 1;
      continue;
    }
    if (c === '(') {
      callStack.push(lastIdent);
      lastIdent = '';
      i += 1;
      continue;
    }
    if (c === ')') {
      callStack.pop();
      lastIdent = '';
      i += 1;
      continue;
    }
    if (QUOTE_CHARS.has(c)) {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === c) break;
        if (src[j] === '\n' && c !== '`') break; // 未闭合的单/双引号，按行截断
        j += 1;
      }
      const end = Math.min(j, n);
      const text = src.slice(i + 1, end);
      const kind = end > i + 1 ? classContextOf(src, i, callStack) : null;
      if (kind === 'strong' || (kind === 'weak' && looksLikeClassList(text))) {
        out.push({ start: i + 1, end, text });
      }
      i = end + 1;
      lastIdent = '';
      continue;
    }
    if (c === '/' && startsRegexLiteral(src, i)) {
      let k = i + 1;
      let inClass = false;
      let closed = false;
      while (k < n) {
        const ch = src[k];
        if (ch === '\\') {
          k += 2;
          continue;
        }
        if (ch === '\n') break;
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) {
          closed = true;
          break;
        }
        k += 1;
      }
      i = closed ? k + 1 : i + 1;
      lastIdent = '';
      continue;
    }
    if (isIdentChar(c)) {
      let j = i;
      while (j < n && isIdentChar(src[j])) j += 1;
      lastIdent = src.slice(i, j);
      i = j;
      continue;
    }
    lastIdent = '';
    i += 1;
  }

  return out;
}

/** 类名区间按 ctx 缓存：同一文件 7 条规则共享一次解析（ctx 每次扫描独立创建，WeakMap 天然不串味） */
const classRegionCache = new WeakMap();
function getClassRegions(ctx) {
  let regions = classRegionCache.get(ctx);
  if (!regions) {
    regions = collectClassRegions(ctx.stripped);
    classRegionCache.set(ctx, regions);
  }
  return regions;
}

/**
 * 在全部类名区间内跑一条正则，命中后换算行号、应用行内豁免并去重（同行同类只报一次）。
 */
function forEachClassMatch(ctx, re, emit) {
  const seen = new Set();
  for (const region of getClassRegions(ctx)) {
    const scan = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    let m;
    while ((m = scan.exec(region.text)) !== null) {
      const token = m[0];
      const lineNo = lineAt(ctx.stripped, region.start + m.index);
      const key = `${lineNo}\u0000${token}`;
      if (seen.has(key)) {
        if (m.index === scan.lastIndex) scan.lastIndex += 1;
        continue;
      }
      seen.add(key);
      if (!hasInlineAllowance(ctx.rawLines, lineNo - 1, 'theme')) {
        emit({ line: lineNo, lineIdx: lineNo - 1, token, groups: m });
      }
      if (m.index === scan.lastIndex) scan.lastIndex += 1;
    }
  }
}

/**
 * 类名 token 型规则的统一工厂（阻断 / 警告共用同一套判定与豁免，避免两套口径）。
 */
function makeClassTokenRule({ id, title, pattern, buildMessage, severity = 'blocking' }) {
  return {
    id,
    gate: 'Gate 4',
    title,
    check(file, ctx) {
      if (!isVisualSurface(file)) return [];
      if (!ctx.warnings) ctx.warnings = [];
      const out = [];
      const snippetOf = (lineIdx) => (ctx.rawLines[lineIdx] ?? '').trim().slice(0, 110);

      forEachClassMatch(ctx, pattern, (hit) => {
        const message = buildMessage(hit);
        if (severity === 'warning') {
          ctx.warnings.push({
            file,
            line: hit.line,
            lineIdx: hit.lineIdx,
            ruleId: id,
            message: `[${id}] :${hit.line} ${message}`,
          });
          return;
        }
        out.push({
          file,
          line: hit.line,
          lineIdx: hit.lineIdx,
          ruleId: id,
          message,
          snippet: snippetOf(hit.lineIdx),
        });
      });

      return out;
    },
  };
}

/** 原生调色板 → 语义 Token 的修复指引（统一出口，避免每条规则各写一套推荐词） */
const PALETTE_FAMILY =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black';

const noRawPalette = makeClassTokenRule({
  id: 'visual/no-raw-palette',
  title: '视觉契约 · 禁止 Tailwind 原生调色板（硬编码色相）',
  pattern: new RegExp(
    `\\b(?:bg|text|border|ring|divide|outline|from|via|to|fill|stroke|shadow|accent|caret|decoration|placeholder)-(?:${PALETTE_FAMILY})\\b`,
  ),
  buildMessage: ({ token }) =>
    `禁止原生调色板类 ${token}（硬编码色相，切皮肤后仍是同一块灰）：改用语义 Token 类 bg-card / bg-panel / bg-input / text-foreground / text-muted-foreground / border-border-subtle / text-primary，色板见 docs/design-system/04-tokens-and-design-system-spec.md`,
});

/** 旧圆角档 → 语义档（映射来自 packages/ui/src/tailwind-entry.css 的 --radius-* 桥接，像素值以 styles.css :root 为准） */
const LEGACY_RADIUS_FIX = {
  sm: 'rounded-inner（4px 控件圆角）',
  md: 'rounded-card（6px 卡片圆角）',
  lg: 'rounded-panel（8px 面板圆角）',
  xl: 'rounded-window（12px 窗口/浮层圆角）',
  '2xl': 'rounded-window（12px 窗口/浮层圆角）',
  '3xl': 'rounded-window（12px 窗口/浮层圆角）',
};

const noLegacyRadius = makeClassTokenRule({
  id: 'visual/no-legacy-radius',
  title: '视觉契约 · 禁止 rounded-sm/md/lg/xl 旧档位（无语义圆角）',
  // 方向变体（rounded-t-md 等）与基准档同罪：两者最终都吃同一套无语义数值
  pattern: /\brounded(?:-[trblse]{1,2})?-(2xl|3xl|sm|md|lg|xl)\b/,
  buildMessage: ({ token, groups }) =>
    `禁止 ${token}（无语义圆角档位）：改用 ${LEGACY_RADIUS_FIX[groups[1]] ?? 'rounded-card（6px）'}，其内再嵌一层控件用 rounded-inner（4px 控件圆角）；合法档仅 rounded-inner|card|panel|window|full`,
});

const LEGACY_SHADOW_FIX = {
  '2xs': 'shadow-card（卡片微投影）',
  xs: 'shadow-card（卡片微投影）',
  sm: 'shadow-card（卡片微投影）',
  md: 'shadow-card（卡片微投影）',
  lg: 'shadow-window（窗口/浮层投影）',
  xl: 'shadow-window（窗口/浮层投影）',
  '2xl': 'shadow-window（窗口/浮层投影）',
  inner: '无内阴影档位：改用 border 或 ring（内阴影会压穿 L0~L4 表面阶梯）',
};

const noShadowScale = makeClassTokenRule({
  id: 'visual/no-shadow-scale',
  title: '视觉契约 · 禁止 shadow-sm/md/lg/xl 旧档位（无语义投影）',
  pattern: /\bshadow-(2xs|xs|sm|md|lg|xl|2xl|inner)\b/,
  buildMessage: ({ token, groups }) =>
    `禁止 ${token}（无语义投影档位）：改用 ${LEGACY_SHADOW_FIX[groups[1]] ?? 'shadow-card'}；合法档仅 shadow-card|window|dock（shadow-none 合法）`,
});

/* ------------------------------------------------------------------ *
 * Gate 4e · 字体族契约
 * ------------------------------------------------------------------ */

/**
 * ui/no-raw-font-family（类名侧）
 *
 * 设计意图 (Why)：
 *   全系统只有两种字体角色：界面字体与代码字体，二者都是皮肤槽位（--font-sans / --font-mono），
 *   由设置页在运行时写进 :root，用户换字体后所有组件必须一起变。
 *   Tailwind 默认的 font-sans / font-serif / font-mono 各自携带一套写死的字体栈，
 *   一旦被使用，该组件就永久脱离用户偏好，且状态栏、代码块、输入框会各自不一致。
 *
 * 防范的历史坑 (Pitfall)：
 *   tailwind-entry.css 已用 `--font-*: initial` 把这些类物理清空，
 *   因此本规则属于第二道防线——防止有人为了"让它有样式"又在 @theme 里把默认栈加回来。
 *
 * 约束与规则 (Rules)：
 *   合法写法只有 font-ui（界面字体）与 font-code（代码字体）；
 *   确需一次性特例时写行内豁免 `// gate-theme-allow: 理由`。
 */
const noRawFontFamily = makeClassTokenRule({
  id: 'visual/no-raw-font-family',
  title: '视觉契约 · 字体族只允许 font-ui / font-code（禁止写死字体栈）',
  pattern: /\bfont-(sans|serif|mono)\b/,
  buildMessage: ({ token }) =>
    `禁止 ${token}（Tailwind 默认字体栈，绕开用户字体设置）：界面文字用 font-ui，代码/终端/等宽读数用 font-code；两者分别消费皮肤槽位 --font-sans / --font-mono`,
});

/**
 * ui/no-raw-font-family-decl（样式表侧）
 *
 * 设计意图 (Why)：
 *   类名侧只能管 React 岛，遗留样式表里的 `font-family: "JetBrains Mono", ...`
 *   同样会让组件脱离用户偏好。这条规则覆盖 .css 面，要求一律写成 var(--font-*)。
 *
 * 豁免：
 *   1. `@font-face` 块内的 font-family 是字体注册本身，不是消费点；
 *   2. CSS 全局关键字 inherit / initial / unset / revert 属于继承语义，不携带字体真值。
 */
const noRawFontFamilyDecl = {
  id: 'visual/no-raw-font-family-decl',
  gate: 'Gate 4',
  title: '视觉契约 · 样式表不得裸写字体栈（必须 var(--font-*)）',
  cssAware: true,
  check(file, ctx) {
    if (!isVisualSurface(file)) return [];
    if (!/\.css$/.test(file)) return [];

    const CSS_WIDE = /^(?:inherit|initial|unset|revert|revert-layer)$/i;
    const out = [];
    const src = ctx.stripped;
    const re = /font-family\s*:\s*([^;}\n]+)/g;
    let m;

    while ((m = re.exec(src)) !== null) {
      const value = m[1].trim();
      if (value.length === 0) continue;
      if (/\bvar\(\s*--(?:font|conv-font|chat-text)/.test(value)) continue;
      if (CSS_WIDE.test(value)) continue;

      // @font-face 块内是字体注册，不是消费点
      const braceIdx = src.lastIndexOf('{', m.index);
      const header = braceIdx >= 0 ? src.slice(Math.max(0, braceIdx - 60), braceIdx).trimEnd() : '';
      if (/@font-face$/i.test(header)) continue;

      const lineNo = lineAt(src, m.index);
      const lineIdx = lineNo - 1;
      if (hasInlineAllowance(ctx.rawLines, lineIdx, 'theme')) continue;

      out.push({
        file,
        line: lineNo,
        lineIdx,
        ruleId: 'visual/no-raw-font-family-decl',
        message: `裸写字体栈「${value.slice(0, 48)}」不会跟随用户字体设置：改用 var(--font-sans)（界面字体）或 var(--font-mono)（代码字体）`,
        snippet: (ctx.rawLines[lineIdx] ?? '').trim().slice(0, 110),
      });
    }

    return out;
  },
};

/** 原生字阶 → 7 档语义字阶（像素值以 styles.css :root 的 --fs-* 为准） */
const RAW_FONT_FIX = {
  xs: 'text-aux（12px 辅助文字）',
  sm: 'text-section（14px 小节标题）',
  base: 'text-title（16px 标题）',
  lg: 'text-title（16px）或 text-hero（20px 主标题）',
  xl: 'text-hero（20px，仅限页面主标题）',
  '2xl': 'text-hero（20px，仅限页面主标题）',
};

const noRawFontScale = makeClassTokenRule({
  id: 'visual/no-raw-font-scale',
  title: '视觉契约 · 禁止 text-xs/sm/base/lg/xl 原生字阶',
  pattern: /\btext-(2xl|xs|sm|base|lg|xl)\b/,
  buildMessage: ({ token, groups }) =>
    `禁止 ${token}（Tailwind 原生字阶）：改用 ${RAW_FONT_FIX[groups[1]] ?? 'text-body（13px 正文）'}；合法档仅 text-hero|title|section|body|aux|caption|micro`,
});

/**
 * 小数间距（warning-only）。
 * 设计系统只允许 4px 整数倍：1.5 = 6px 会让同一行里的两个 4px 间距对不齐，
 * 长期累积成「整体差 2px」的视觉漂移。存量 39 处，故只警告不阻断。
 */
const FRACTIONAL_SPACING_RE =
  /(?<![\w-])(?:[a-z-]+:)*-?(?:px|py|pt|pb|pl|pr|p|mx|my|mt|mb|ml|mr|m|gap-x|gap-y|gap|space-x|space-y|size|w|h|top|left|right|bottom|inset-x|inset-y|inset)-\d*\.\d+(?![\w-])/;

const fractionalSpacing = makeClassTokenRule({
  id: 'visual/fractional-spacing',
  title: '视觉契约 · 小数间距落在 4px 网格外（警告）',
  pattern: FRACTIONAL_SPACING_RE,
  severity: 'warning',
  buildMessage: ({ token }) => {
    // token 可能带变体前缀（after:-inset-1.5），建议值必须把变体原样带回去，否则照抄会丢语义
    const cut = token.lastIndexOf(':') + 1;
    const variant = token.slice(0, cut);
    const utility = token.slice(cut);
    const value = Number(utility.match(/(\d*\.\d+)$/)?.[1]);
    const px = value * 4;
    const lo = Math.floor(px / 4);
    const hi = Math.ceil(px / 4);
    const prefix = utility.slice(0, utility.lastIndexOf('-', utility.length - 1) + 1);
    return `小数间距 ${token} 偏离 4px 网格（${px}px）：改用 ${variant}${prefix}${lo}（${lo * 4}px）或 ${variant}${prefix}${hi}（${hi * 4}px）；设计系统只允许 4px 整数倍`;
  },
});

/**
 * 任意值（warning-only）。
 * `w-[212px]` / `h-[min(...)]` 直接绕过 Token，是「AI 写出来的样式不合规范」的最高频形态；
 * 但 data-[state=open] / aria-[...] / has-[...] / content-[''] 是 Radix 变体语法，必须豁免，
 * 否则一次误伤就会让整组规则被注释掉。
 */
const ARBITRARY_EXEMPT =
  /(?:^|:)(?:group-|peer-)?data-\[|(?:^|:)aria-\[|(?:^|:)has-\[|(?:^|:)supports-\[|(?:^|:)content-\[/;

const arbitraryValue = {
  id: 'visual/no-arbitrary-value',
  gate: 'Gate 4',
  title: '视觉契约 · 禁止任意值类绕过 Token（警告）',
  check(file, ctx) {
    if (!isVisualSurface(file)) return [];
    if (!ctx.warnings) ctx.warnings = [];
    const seen = new Set();

    for (const region of getClassRegions(ctx)) {
      const bracketRe = /\[[^\]]*\]/g;
      let m;
      while ((m = bracketRe.exec(region.text)) !== null) {
        // 把 [..] 向两侧扩到空白/引号边界，得到完整 token（如 hover:bg-[#fff]）
        let s = m.index;
        while (s > 0 && !/[\s"'`]/.test(region.text[s - 1])) s -= 1;
        let e = m.index + m[0].length;
        while (e < region.text.length && !/[\s"'`]/.test(region.text[e])) e += 1;
        const token = region.text.slice(s, e);
        if (ARBITRARY_EXEMPT.test(token)) continue;

        const lineNo = lineAt(ctx.stripped, region.start + s);
        const key = `${lineNo}\u0000${token}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (hasInlineAllowance(ctx.rawLines, lineNo - 1, 'theme')) continue;

        ctx.warnings.push({
          file,
          line: lineNo,
          lineIdx: lineNo - 1,
          ruleId: 'visual/no-arbitrary-value',
          message: `[visual/no-arbitrary-value] :${lineNo} 任意值 ${token} 绕过设计 Token：优先改用语义类（如 h-dock / w-window）或把尺寸收敛到 packages/ui/src/tokens 的 DIMENSIONS；确属一次性特例须在上一行写 // gate-theme-allow: 理由`,
        });
      }
    }

    return [];
  },
};

/* ---------------- 兜底值漂移（阻断） ---------------- */

/** 缓存 :root 纯 px 真值面（样式表是权威源，每次进程只读一次） */
let cachedRootPxTokens = null;

/**
 * 解析 :root 真值面（只认 :root，不认皮肤块与局部作用域）。
 *
 * 为什么只认 :root：皮肤块 [data-theme="x"] 定义的是色相，局部作用域（.conversation-pod）
 * 定义的是组件私有别名，二者的 px 兜底比对会把「作用域私有默认值」误判成漂移。
 * 只比较纯 px 值：clamp()/color-mix()/var() 等复合值无法静态判等，交给 theme/ghost-token。
 */
function getRootPxTokens() {
  if (cachedRootPxTokens) return cachedRootPxTokens;
  const map = new Map();
  const targets = [];
  const stylesDir = path.join(REPO_ROOT, 'packages/ui/src/styles');
  if (fs.existsSync(stylesDir)) {
    for (const e of fs.readdirSync(stylesDir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.css')) targets.push(path.join(stylesDir, e.name));
    }
  }
  targets.push(path.join(REPO_ROOT, 'packages/desktop/src/renderer/styles.css'));

  for (const abs of targets) {
    if (!fs.existsSync(abs)) continue;
    let src = '';
    try {
      src = fs.readFileSync(abs, 'utf8');
      // gate-degrade: 单个样式表读取失败时跳过该文件，其余样式表仍构成真值面
    } catch {
      continue;
    }
    // 必须先剥块注释：注释里的示例值（如 `--radius-card` 的反例）不得进入真值面
    const clean = src.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const block of clean.matchAll(/:root\s*\{([\s\S]*?)\}/g)) {
      for (const m of block[1].matchAll(/(--[a-z0-9-]+)\s*:\s*(-?\d+(?:\.\d+)?)px\s*(?:!important\s*)?;/gi)) {
        map.set(m[1], Number(m[2]));
      }
    }
  }

  cachedRootPxTokens = map;
  return map;
}

const tokenFallbackDrift = {
  id: 'visual/token-fallback-drift',
  gate: 'Gate 4',
  title: '视觉契约 · var() 兜底值必须等于 :root 真值',
  /**
   * 样式表专项标记。
   *
   * 设计意图 (Why)：
   *   这条规则的真值面（:root 定义）与主要违规面（组件样式表里的 var(--x, Npx)）都在 .css 文件中，
   *   而默认扫描域只收 ts/tsx/js/mjs。若不额外声明，规则在全量门禁里恒为空跑 ——
   *   实测 167 个扫描目标中 .css 数量为 0，规则只是在单测里活着。
   *
   * 约束与规则 (Rules)：
   *   只有显式声明 cssAware 的规则才会进入 run.mjs 的样式表专项扫描，
   *   换肤与 i18n 规则不得声明，否则会把整片遗留样式表一次性报红。
   */
  cssAware: true,
  check(file, ctx) {
    if (!isVisualSurface(file)) return [];
    if (!ctx.warnings) ctx.warnings = [];
    const defs = getRootPxTokens();
    if (defs.size === 0) {
      // 失败不可静默：真值面读不到时绝不假装「零漂移」
      ctx.warnings.push({
        file,
        line: 1,
        ruleId: 'visual/token-fallback-drift',
        message: '[visual/token-fallback-drift] :1 未解析到任何 :root 纯 px 真值，兜底漂移比对本次未生效',
      });
      return [];
    }

    const out = [];
    const seen = new Set();
    const re = /var\(\s*(--[a-z0-9-]+)\s*,\s*(-?\d+(?:\.\d+)?px)\s*\)/gi;
    let m;
    while ((m = re.exec(ctx.stripped)) !== null) {
      const name = m[1];
      const fallback = Number.parseFloat(m[2]);
      const truth = defs.get(name);
      if (truth === undefined || truth === fallback) continue;

      const lineNo = lineAt(ctx.stripped, m.index);
      const key = `${lineNo}\u0000${m[0]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (hasInlineAllowance(ctx.rawLines, lineNo - 1, 'theme')) continue;

      out.push({
        file,
        line: lineNo,
        lineIdx: lineNo - 1,
        ruleId: 'visual/token-fallback-drift',
        message: `${m[0]} 的兜底值 ${m[2]} 与 :root 真值 --${name.slice(2)}: ${truth}px 不一致：兜底必须等于真值（或直接省略兜底写 var(${name})），否则 Token 缺失时会静默渲染成另一套圆角/字号且无任何报错`,
        snippet: (ctx.rawLines[lineNo - 1] ?? '').trim().slice(0, 110),
      });
    }

    return out;
  },
};

/** Gate 4e 规则组（按 id 独立成条，byRule 才能给出逐规则命中数） */
export const visualRules = [
  noRawPalette,
  noLegacyRadius,
  noShadowScale,
  noRawFontScale,
  noRawFontFamily,
  noRawFontFamilyDecl,
  tokenFallbackDrift,
  arbitraryValue,
  fractionalSpacing,
];

export const RULES = [
  architectureRules,
  integrityRules,
  themeRules,
  templateExportRules,
  inlineHexRules,
  rawMonospaceRules,
  literalFontSizeRules,
  ghostTokenRules,
  i18nRules,
  perfRules,
  layoutRules,
  ...visualRules,
];

export { KNOWN_LAYOUT_DEVIATIONS };
