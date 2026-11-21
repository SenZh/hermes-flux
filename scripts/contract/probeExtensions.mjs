/**
 * 扩展与模型探针模块拆分子集（保持 probe.mjs 在存量行数上限内）。
 */

export function buildExtensionsProbeModule({ profile, ctx, stamp }) {
  return {
    module: 'extensions',
    // 设置中心的「扩展」与「BOT 能力」：读取与增删测 MCP、技能清单。
    // model.save_key / model.disconnect 是破坏性写操作，绝不进探针（见下方 skip 说明）。
    teardown: async () => {
      if (!ctx.probeMcpName) return;
      try {
        await ctx.call('mcp.servers.remove', { profile, name: ctx.probeMcpName });
      } catch (err) {
        console.log(`  · 清理探针 MCP 失败（可忽略）: ${err.code || err.message}`);
      }
    },
    cases: [
      { method: 'mcp.servers.status', params: () => ({ profile }) },
      { method: 'mcp.catalog', params: () => ({ profile }) },
      {
        method: 'mcp.servers.add',
        params: () => {
          ctx.probeMcpName = `flux-probe-mcp-${stamp()}`;
          return {
            profile,
            name: ctx.probeMcpName,
            config: { command: 'echo', args: ['flux-probe'] },
          };
        },
      },
      {
        method: 'mcp.servers.test',
        params: () => ({ profile, name: ctx.probeMcpName || 'flux-probe-none' }),
        allowCodes: [4001, 4007],
      },
      {
        method: 'mcp.servers.remove',
        params: () => ({ profile, name: ctx.probeMcpName || 'flux-probe-none' }),
        after: () => { ctx.probeMcpName = ''; },
        allowCodes: [4001, 4007],
        destructive: true,
      },
      { method: 'skills.manage', params: () => ({ profile, action: 'list' }) },
      {
        method: 'skills.reload',
        // 热重载会重新扫描磁盘技能目录，属幂等只读重建；输出里含本机绝对路径，由 sanitize 脱敏
        params: () => ({ profile }),
      },
      {
        method: 'model.save_key',
        // 探针会用假密钥覆盖用户真实凭据，且网关无对应"还原"接口——永久禁止真实执行。
        params: () => ({ slug: ctx.probeBot }),
        skip: () => '写操作会覆盖用户真实 API Key 且无法还原，仅由 CDP 场景在无凭据沙箱手工验证',
      },
      {
        method: 'model.disconnect',
        params: () => ({ slug: ctx.probeBot }),
        skip: () => '断开提供商会破坏用户已配置的凭据，禁止在真实网关上执行',
      },
      {
        method: 'reload.env',
        params: () => ({}),
        // 热重载 .env 会立刻改变运行中的凭据状态；用假密钥探针的副作用不可控，永久跳过
        skip: () => '环境热重载会改变运行中的凭据状态，须与 model.save_key 成对执行，禁止单独探针',
      },
    ],
  };
}
