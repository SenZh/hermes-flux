#!/usr/bin/env node
/**
 * Hermes Flux - 模板导出文件存量清单生成器 (Anti-Template Growth)
 *
 * 设计意图 (Why):
 *   前端正向 React / shadcn / Tailwind 迁移（波③）。为了防止在迁移完成前
 *   团队又向 ui/src/components 增添新的字符串模板组件（renderXxx），
 *   必须将当前存量模板文件与导出函数冻结。任何新增文件或新增 renderXxx 导出
 *   都将触发 ui/no-new-template-export 门禁探针。
 *
 * 历史坑 (Pitfall):
 *   若不记录具体 renderXxx 导出，仅限制文件名，开发者可能在既有文件里大量扩写
 *   新的模板函数，架空迁移规划。因此文件与函数双重冻结。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const TARGET_DIR = path.join(REPO_ROOT, 'packages/ui/src/components');
const OUT_FILE = path.join(HERE, '.template-inventory.json');

function listTsFiles(dir) {
  let res = [];
  if (!fs.existsSync(dir)) return res;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'ui') continue; // 忽略 shadcn/ui 组件目录 (.tsx)
      res = res.concat(listTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
      res.push({ abs: full, rel });
    }
  }
  return res.sort((a, b) => a.rel.localeCompare(b.rel));
}

export function extractTemplateInventory() {
  const files = listTsFiles(TARGET_DIR);
  const filesMap = {};

  for (const { abs, rel } of files) {
    const content = fs.readFileSync(abs, 'utf8');
    const exportsSet = new Set();
    for (const m of content.matchAll(/export\s+(?:async\s+)?function\s+(render[A-Za-z0-9_]+)/g)) {
      exportsSet.add(m[1]);
    }
    for (const m of content.matchAll(/export\s+const\s+(render[A-Za-z0-9_]+)\s*=/g)) {
      exportsSet.add(m[1]);
    }
    for (const m of content.matchAll(/export\s*\{([^}]+)\}/g)) {
      const names = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop());
      for (const n of names) {
        if (n && n.startsWith('render')) exportsSet.add(n);
      }
    }
    filesMap[rel] = [...exportsSet].sort();
  }

  return {
    version: 1,
    frozenAt: '2026-11-03',
    note: 'ui/src/components 模板导出存量清单。波③迁移过程中只减不增，严禁新增模板文件或新增 renderXxx 导出。',
    files: filesMap,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const inventory = extractTemplateInventory();
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  const fileCount = Object.keys(inventory.files).length;
  const exportCount = Object.values(inventory.files).reduce((sum, list) => sum + list.length, 0);
  console.log(`[template-inventory] 冻结完成：${fileCount} 个模板文件，${exportCount} 个 renderXxx 导出已写入 .template-inventory.json`);
}
