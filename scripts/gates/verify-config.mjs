/**
 * 验证 opencode.jsonc 可被 JSONC 解析器正确解析。
 * 关键：不能用「剥离 /* 注释」的正则来测——glob 里就有 "/*"，会被误删。
 * 必须用与 OpenCode 同款的状态机式 JSONC 解析。
 */
import fs from 'node:fs';

function parseJsonc(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  let inStr = false;
  let quote = '';
  let escaped = false;

  while (i < n) {
    const c = text[i];
    const next = text[i + 1];

    if (inStr) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) inStr = false;
      i += 1;
      continue;
    }

    if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
      out += c;
      i += 1;
      continue;
    }

    if (c === '/' && next === '/') {
      while (i < n && text[i] !== '\n') i += 1;
      continue;
    }

    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    out += c;
    i += 1;
  }

  // 去掉尾逗号（JSONC 允许，JSON.parse 不允许）
  const noTrailing = out.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(noTrailing);
}

const raw = fs.readFileSync('opencode.jsonc', 'utf8');
const cfg = parseJsonc(raw);

console.log('✓ opencode.jsonc 解析成功');
console.log('  instructions:', cfg.instructions);
console.log('  agents:', Object.keys(cfg.agents).join(', '));
console.log('  permissions:', cfg.permissions.length, '条');

const subagents = Object.entries(cfg.agents).filter(([, a]) => a.mode === 'subagent');
console.log('  subagent 数:', subagents.length);
for (const [id, a] of subagents) {
  const deniesEdit = (a.permissions ?? []).some((p) => p.action === 'edit' && p.effect === 'deny');
  console.log(`    - ${id.padEnd(22)} 只读=${deniesEdit} steps=${a.steps ?? 'inherited'}`);
}

// 关键不变量：审查者必须只读
const reviewers = ['flux-style-reviewer', 'flux-code-reviewer'];
for (const r of reviewers) {
  const cfgAgent = cfg.agents[r];
  if (!cfgAgent) throw new Error(`缺少审查 Agent: ${r}`);
  const readOnly = (cfgAgent.permissions ?? []).some((p) => p.action === 'edit' && p.effect === 'deny');
  if (!readOnly) throw new Error(`${r} 必须禁止 edit，否则审查会「边审边改」失去独立性`);
  const mdFile = `.opencode/agents/${r}.md`;
  const md = fs.readFileSync(mdFile, 'utf8');
  if (!/action:\s*edit[\s\S]*?effect:\s*deny/.test(md)) {
    throw new Error(`${mdFile} 的 frontmatter 必须禁止 edit`);
  }
}
console.log('✓ 审查 Agent 只读约束一致（jsonc 与 md frontmatter 双重确认）');
