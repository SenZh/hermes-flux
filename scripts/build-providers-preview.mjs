import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const outDir = path.resolve('artifacts/verification/providers-admin');
fs.mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.resolve('scripts/preview-providers-panel.mjs')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  outfile: path.join(outDir, 'providers-panel.js'),
  define: { 'process.env.NODE_ENV': '"production"' },
  nodePaths: [path.resolve('packages/ui/node_modules')],
  logLevel: 'warning',
});

const css = ['tailwind.css', 'styles.css', 'conversation.css']
  .map((name) => fs.readFileSync(path.resolve('packages/desktop/dist/renderer', name), 'utf8'))
  .join('\n');

const html = `<!doctype html>
<html lang="zh-CN" data-theme="obsidian-gold">
<head>
<meta charset="utf-8" />
<style>${css}</style>
<style>html,body{margin:0;padding:0;background:#0E0F13;}
.preview-wrap{padding:24px;}</style>
</head>
<body>
<div id="preview-root" class="preview-wrap"></div>
<script src="./providers-panel.js"></script>
</body>
</html>`;

fs.writeFileSync(path.join(outDir, 'providers-panel.html'), html, 'utf8');
console.log('bundled', path.join(outDir, 'providers-panel.html'));
