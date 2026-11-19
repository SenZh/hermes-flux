/**
 * Hermes Flux 门禁规则集 · 可维护性与测试完整性（Gate 0f / Gate 2）
 *
 * 设计意图 (Why)：
 *   这组规则守护的不是业务代码，而是「让人能继续修改代码」与「让门禁不能被糊弄」。
 *   它们与视觉/换肤规则关注点完全不同，且都在代码规模与测试手法层面生效，
 *   因此独立成模块，也避免 rules.mjs 本身越过单文件行数上限。
 *
 * 约束与规则 (Rules)：
 *   - 规则只用 scanner 提供的「去注释源码行视图」，不得直接读原始行做判定。
 *   - 违规对象统一形状：{ file, line, ruleId, message, snippet, lineIdx? }。
 *   - 本模块不得引入新的第三方依赖，门禁必须在干净环境可运行。
 */

/* ------------------------------------------------------------------ *
 * Gate 0f · 单文件行数上限
 * ------------------------------------------------------------------ */

/**
 * 单文件行数上限。
 *
 * 设计意图 (Why)：
 *   文件超过约 1500 行后，「读到理解」的成本按超线性上升：读者必须同时持有
 *   过多互不相干的分支，修改任何一处都要重新校准全局。本仓曾有一个 12000 行的
 *   renderer/index.ts，在其中定位一个行为要先读上千行上下文，这是缺陷的温床。
 *   把「文件规模」变成可机器判定的红线，而不是靠自觉。
 *
 * 防范的历史坑 (Pitfall)：
 *   只警告不阻断时，超限文件只增不减（存量已证明）。因此本规则是阻断型；
 *   存量超限登记在 KNOWN_OVERSIZE 冻结，只允许缩小，禁止新增。
 *
 * 约束与规则 (Rules)：
 *   1. 硬上限 1500 行，按物理行计（空行与注释同样占用读者的滚动与定位成本）。
 *   2. 存量超限文件必须登记 max，当前行数不得超过登记值。
 *   3. 文件降到上限以下后，应从登记表移除该条目以固化成果。
 */
export const FILE_LINE_LIMIT = 1500;

/**
 * 存量超限登记表。
 *
 * 【冻结规则】每条的 max 是"拆分工作开始时的实测行数"，只允许调低。
 * 文件无论因为什么理由涨回去了，本规则都会阻断，逼出"继续拆"而不是"再放宽一次"。
 * `generated: true` 是构建产物（由生成器写出），人工拆分无意义。
 */
export const KNOWN_OVERSIZE = {
  'packages/core/src/rpc/contracts/gateway-contract.generated.ts': { max: 7515, generated: true },
  'scripts/verify/control-flux.mjs': { max: 1701 },
  'packages/core/src/rpc/client.ts': { max: 1035 },
  'packages/core/src/rpc/types.ts': { max: 998 },
  'packages/ui/src/components/InspectionPod/InspectionPod.ts': { max: 979 },
  'scripts/contract/probe.mjs': { max: 966 },
  'packages/ui/src/components/InputDock/InputDock.ts': { max: 956 },
};

export const fileLineLimitRules = {
  id: 'size',
  gate: 'Gate 0',
  title: `单文件行数上限（≤ ${FILE_LINE_LIMIT} 行，存量冻结只降不升）`,
  check(file, ctx) {
    // 只约束可执行源码；样式表与文档另有口径
    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(file)) return [];

    const lines = ctx.rawLines.length;
    const known = KNOWN_OVERSIZE[file];

    // 生成产物由生成器负责
    if (known?.generated) return [];

    if (known) {
      if (lines <= FILE_LINE_LIMIT) {
        /**
         * 已达标：提示移除登记，不阻断。
         * 移除动作留在拆分 PR 里由人工确认，避免门禁自动改文件。
         */
        if (ctx.warnings) {
          ctx.warnings.push({
            file,
            line: 1,
            ruleId: 'size/oversize-paid-off',
            message: `已降至 ${lines} 行（≤ ${FILE_LINE_LIMIT}），请从 KNOWN_OVERSIZE 移除该登记项以固化成果`,
          });
        }
        return [];
      }
      if (lines > known.max) {
        return [{
          file,
          line: known.max + 1,
          lineIdx: known.max,
          ruleId: 'size/oversize-grown',
          message: `文件从登记的 ${known.max} 行涨到 ${lines} 行。超限文件只允许继续拆分，禁止再增长；新增逻辑必须放进新模块`,
          snippet: (ctx.rawLines[known.max] ?? '').trim().slice(0, 110),
        }];
      }
      return [];
    }

    if (lines <= FILE_LINE_LIMIT) return [];

    return [{
      file,
      line: FILE_LINE_LIMIT + 1,
      lineIdx: FILE_LINE_LIMIT,
      ruleId: 'size/oversize-new',
      message: `文件 ${lines} 行超过上限 ${FILE_LINE_LIMIT} 行。请按领域拆分为多个模块（每个不超过上限），而不是继续在单文件里堆逻辑`,
      snippet: (ctx.rawLines[FILE_LINE_LIMIT] ?? '').trim().slice(0, 110),
    }];
  },
};

/* ------------------------------------------------------------------ *
 * Gate 2 · 测试完整性（防"让门禁变绿"的作弊手法）
 * ------------------------------------------------------------------ */

/**
 * 测试完整性规则。
 *
 * 设计意图 (Why)：
 *   AI 最容易的作弊路径不是写错代码，而是让门禁变绿：吞掉覆盖率豁免、
 *   在测试里强制成功退出、或用行内豁免注释吸收新增违规。这些手法不会报错，
 *   只会让"保护"静默消失，因此必须由静态规则计数并只降不升。
 *
 * 防范的历史坑 (Pitfall)（均有实测依据）：
 *   1. `/* c8 ignore next *\/` 让新增行根本不进 lcov，增量覆盖门禁对这段代码直接失效。
 *   2. 测试文件里的顶层 `process.exit(0)` 与 `uncaughtException` 内 `process.exit(0)`
 *      都能把真实失败吞成 exit=0 / pass=1（census 能识破，静态规则让它一开始就写不出来）。
 *   3. `gate-*-allow` 不设上限时，"加一条 allow"会成为让门禁变绿的最短路径。
 *
 * 约束与规则 (Rules)：
 *   - 三条计数都进 baseline 棘轮体系（键含规则 + 文件 + 行内容指纹）。
 *   - 显式失败退出（非 0）是合法的，只拦"强制成功"。
 */
export const testIntegrityRules = {
  id: 'test-integrity',
  gate: 'Gate 2',
  title: '测试完整性（禁止覆盖率豁免 / 测试内强制成功退出 / 豁免注释堆积）',
  check(file, ctx) {
    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(file)) return [];
    const out = [];

    /**
     * 1. 覆盖率豁免注释。
     * 它会让该行不进覆盖率报告，等价于对这段代码关闭增量覆盖门禁。
     *
     * 判定必须落在「真正的注释行」上：文档块里的示例（以 `*` 开头）与
     * 字符串字面量里的说明（例如规则自己的诊断文案）都不是豁免申请，
     * 若一并计入，规则会举报它自己，计数随即失去意义。
     */
    const c8Re = /(?:\/\/|\/\*)\s*(?:c8|v8|istanbul)\s+ignore\b/;
    ctx.rawLines.forEach((line, i) => {
      if (!c8Re.test(line)) return;
      if (/^\s*\*/.test(line)) return;
      // 去注释视图里仍残留该标记 => 它在字符串里，不是注释
      if (c8Re.test(ctx.codeLines[i] ?? '')) return;
      out.push({
        file,
        line: i + 1,
        lineIdx: i,
        ruleId: 'test-integrity/c8-ignore',
        message: '禁止用覆盖率豁免注释隐藏未覆盖代码：请补真实测试，或改用带 issue 的显式登记',
        snippet: line.trim().slice(0, 110),
      });
    });

    /**
     * 2. 测试文件内的强制成功退出。
     * 生产代码需要退出码，不受此限；测试文件里只允许退出非 0 的失败码。
     */
    const isTestFile = file.includes('/__tests__/') || /\.test\.(mjs|cjs|js)$/.test(file);
    if (isTestFile) {
      ctx.codeLines.forEach((line, i) => {
        if (!/\bprocess\.exit(Code)?\s*\(/.test(line)) return;
        // 显式失败退出是合法的
        if (/\bprocess\.exit(Code)?\s*\(\s*[1-9]/.test(line)) return;
        if (/process\.exitCode\s*=\s*[1-9]/.test(line)) return;
        out.push({
          file,
          line: i + 1,
          lineIdx: i,
          ruleId: 'test-integrity/test-exit',
          message: '测试文件禁止强制成功退出：顶层或异常钩子里的 exit(0) 会把真实失败吞成全绿',
          snippet: line.trim().slice(0, 110),
        });
      });
    }

    /**
     * 3. 测试代码的时区依赖。
     *
     * 【设计意图 (Why)】绝对时间戳（`1730472540000`）是 UTC 语义，而
     * `getHours() / getMinutes() / toLocaleTimeString()` 取的是**运行机器本地时区**。
     * 把两者凑在一起，等于把「跑测试的机器是哪个时区」当成隐含前提。
     * 实测事故：本地 UTC+8 得到 `昨天 22:49` 通过，GitHub 的 UTC runner
     * 得到 `昨天 14:49` 稳定失败，报错看起来像业务逻辑坏了，实际是测试假设坏了。
     *
     * 【约束与规则 (Rules)】
     *   1. 只扫测试文件：生产代码用本地时区展示是正确行为，不该被拦；
     *   2. 命中即为违规（非警告）：时区依赖必然在某个 runner 上失败，
     *      不存在"这次碰巧没事"的合法情形；
     *   3. 正确写法是 `getUTCHours()/getUTCMinutes()` 或显式传入时区，
     *      并在注释里声明取值口径。
     */
    if (isTestFile) {
      const tzRe = /\.(getHours|getMinutes|getDate|getDay|getMonth|getFullYear)\s*\(\s*\)|\.toLocale(?:Time|Date)?String\s*\(/;
      /**
       * 本模块不 import scanner（规则只消费 ctx 提供的去注释视图），
       * 因此豁免判定在此就地实现，语义与 scanner.hasInlineAllowance 保持一致：
       * 当前行或上一行出现 `gate-tz-allow` 即视为豁免。
       */
      const allowAt = (idx) => {
        const marker = 'gate-tz-allow';
        return (ctx.rawLines[idx] ?? '').includes(marker) || (ctx.rawLines[idx - 1] ?? '').includes(marker);
      };
      ctx.codeLines.forEach((line, i) => {
        if (!tzRe.test(line)) return;
        if (/getUTC/.test(line)) return;
        if (allowAt(i)) return;
        out.push({
          file,
          line: i + 1,
          lineIdx: i,
          ruleId: 'test-integrity/timezone-dependent',
          message: '测试断言不得依赖运行机器本地时区：getHours()/toLocaleString() 在 CI(UTC) 与本地(UTC+8) 结果不同。请改用 getUTCHours()/getUTCMinutes()，或用 // gate-tz-allow: 理由 显式豁免',
          snippet: line.trim().slice(0, 110),
        });
      });
    }

    /**
     * 4. 行内豁免注释。
     *
     * 【设计意图 (Why)】豁免机制本身是必要的（平台分支、外部依赖缺失等），
     * 把「每条豁免」当成违规会破坏既有语义：合法的豁免会被判成错误，
     * 反而逼着人去删掉本该保留的理由。因此本规则只做一件更弱但更正确的事：
     * 在 warnings 通道汇总本文件的豁免条数，让数量每次运行都可见。
     * 真正的「只降不升」由 scripts/gates/allow-budget.mjs 按仓库总量判定，
     * 那里比逐行计数更贴近目标（它约束的是总敞口，而不是某一行）。
     */
    let allowCount = 0;
    for (let i = 0; i < ctx.rawLines.length; i += 1) {
      const line = ctx.rawLines[i];
      if (!/gate-[a-z0-9-]+-allow\s*:/.test(line)) continue;
      if (/^\s*\*/.test(line)) continue;
      if (/gate-[a-z0-9-]+-allow\s*:/.test(ctx.codeLines[i] ?? '')) continue;
      allowCount += 1;
    }
    if (allowCount > 0 && ctx.warnings) {
      ctx.warnings.push({
        file,
        line: 1,
        ruleId: 'test-integrity/allow-comment',
        message: `本文件含 ${allowCount} 条行内豁免；仓库总敞口由 allow-budget.mjs 按只降不升判定`,
      });
    }

    return out;
  },
};
