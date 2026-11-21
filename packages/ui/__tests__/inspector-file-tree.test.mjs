/**
 * 右侧常驻无边框融合竖栏 + 四边框悬浮工具窗 + 工作区文件树浏览渲染单测
 * (packages/ui/__tests__/inspector-file-tree.test.mjs)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderInspectionPod } from '../dist/components/InspectionPod/InspectionPod.js';
import { detectFileLanguage, renderFileTab } from '../dist/lib/inspectorViewHelpers.js';
import { t, setLocale } from '../dist/i18n/index.js';

const ROOT = path.resolve(import.meta.dirname, '../../..');

test('InspectionPod 右侧常驻竖栏与悬浮文件树分栏全状态渲染', async (tCtx) => {
  await tCtx.test('1. 收起态：悬浮窗隐藏但右侧常驻竖栏保持可见且未高亮', () => {
    const html = renderInspectionPod({
      collapsed: true,
      gatewayConnected: true,
    });

    assert.ok(html.includes('id="flux-inspector-shell"'), '必须包裹在 #flux-inspector-shell 中');
    assert.ok(html.includes('id="flux-inspector-rail"'), '收起态右侧竖栏必须继续常驻渲染');
    assert.ok(html.includes('data-tab="preview"'), '竖栏必须保留文件树与预览入口');
    assert.ok(!html.includes('vertical-tab-item active-tab'), '收起态竖栏按钮不得处于激活态');
    assert.ok(html.includes('class="flux-inspector-pod inspector-collapsed"'), '收起态 pod 必须折叠隐藏');
  });

  await tCtx.test('2. 展开态：四边框悬浮窗同屏渲染左树与右预览，支持折叠文件树切换', () => {
    const readyTree = {
      status: 'ready',
      rootPath: '/repo',
      source: 'local_fs',
      nodes: [
        {
          name: 'src',
          path: '/repo/src',
          isDirectory: true,
          childrenLoaded: true,
          children: [
            { name: 'app.ts', path: '/repo/src/app.ts', isDirectory: false },
          ],
        },
        {
          name: 'docs',
          path: '/repo/docs',
          isDirectory: true,
          childrenLoaded: true,
          children: [
            { name: 'guide.md', path: '/repo/docs/guide.md', isDirectory: false },
          ],
        },
        { name: 'README.md', path: '/repo/README.md', isDirectory: false },
      ],
    };

    const html = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      activeTab: 'preview',
      workspaceRootName: 'repo',
      fileTreeState: readyTree,
      fileTreeExpandedPaths: ['/repo/src'],
      fileTreeFilterQuery: '',
      fileTreeCollapsed: false,
      openFiles: [
        { path: '/repo/src/app.ts', content: 'const x = 1;' },
        { path: '/repo/photo.png', content: 'data:image/png;base64,AAAA' },
      ],
      activeFilePath: '/repo/src/app.ts',
    });

    assert.ok(html.includes('class="inspector-floating-window"'), '必须包在四边框悬浮窗容器中');
    assert.ok(html.includes('class="inspector-file-tree-pane"'), '默认渲染左侧文件树面板');
    assert.ok(html.includes('data-tree-dir="/repo/src"'), '目录节点必须挂载 data-tree-dir');
    assert.ok(html.includes('data-tree-dir="/repo/docs"') && html.includes('aria-expanded="false"'), '未展开目录必须显示关闭态且不渲染子项');
    assert.equal(html.includes('data-tree-file="/repo/docs/guide.md"'), false);
    assert.ok(html.includes('data-tree-file="/repo/src/app.ts"'), '已展开目录的子文件必须可见');
    assert.ok(html.includes('data-tree-file="/repo/src/app.ts"') && html.includes('inspector-tree-file active'), '当前激活文件必须高亮');
    assert.ok(html.includes('vertical-tab-item active-tab'), '展开态常驻竖栏按钮必须激活高亮');

    // 过滤状态自动展开并支持关键字无匹配态
    const filtered = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      fileTreeState: readyTree,
      fileTreeExpandedPaths: [],
      fileTreeFilterQuery: 'app.ts',
    });
    assert.ok(filtered.includes('data-tree-file="/repo/src/app.ts"'), '过滤命中深层文件时必须自动展开祖先渲染');

    const noMatch = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      fileTreeState: readyTree,
      fileTreeFilterQuery: 'definitely-not-found',
    });
    assert.ok(noMatch.includes('未找到匹配的文件'));

    // 折叠左侧树后必须展示右侧标签栏展开入口
    const collapsedTreeHtml = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      fileTreeState: readyTree,
      fileTreeCollapsed: true,
    });
    assert.equal(collapsedTreeHtml.includes('class="inspector-file-tree-pane"'), false);
    assert.ok(collapsedTreeHtml.includes('id="btn-file-tree-expand"'));
  });

  await tCtx.test('3. 文件树 loading / error / empty / 重试及预览内容全分支（图片/HTML/Diff/搜索/换行）', () => {
    setLocale('zh-CN');

    const loadingHtml = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      fileTreeState: { status: 'loading' },
    });
    assert.ok(loadingHtml.includes('正在读取工作区目录...'));

    const errorHtml = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      fileTreeState: { status: 'error', message: 'permission denied' },
    });
    assert.ok(errorHtml.includes('permission denied'));
    assert.ok(errorHtml.includes('id="btn-file-tree-retry"'));

    const emptyHtml = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      fileTreeState: { status: 'ready', rootPath: '/empty', nodes: [], source: 'local_fs' },
    });
    assert.ok(emptyHtml.includes('当前目录为空'));

    // 图片就绪 + 图片缺失占位
    const imgOk = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      previewFile: { path: 'a.png', content: 'data:image/png;base64,ABC' },
    });
    assert.ok(imgOk.includes('<img src="data:image/png;base64,ABC"'));

    const imgMissing = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      previewFile: { path: 'b.jpg', content: 'remote missing' },
    });
    assert.ok(imgMissing.includes('图片未能加载'));

    // HTML 渲染态
    const htmlPreview = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      viewMode: 'rendered',
      previewFile: { path: 'index.html', content: '<h1>Hello</h1>' },
    });
    assert.ok(htmlPreview.includes('<iframe srcdoc='));

    // Diff + 搜索高亮 + 提示行 + 换行 + 无行号
    const diffContent = [
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -1,3 +1,3 @@',
      '-const oldVal = 1;',
      '+const newVal = 2;',
      '正在从工作区加载最新版本内容...',
    ].join('\n');
    const diffHtml = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      viewMode: 'raw',
      showLineNumbers: false,
      wordWrap: true,
      searchOpen: true,
      searchQuery: 'newVal',
      previewFile: { path: 'patch.diff', content: diffContent, isDiff: true },
    });
    assert.ok(diffHtml.includes('id="inspector-search-container"'));
    assert.ok(diffHtml.includes('<mark'));
    assert.ok(diffHtml.includes('pre-wrap'));
    assert.equal(diffHtml.includes('<td class="line-number"'), false);

    // Language 探测全扩展名 + 行号/空行/Embedded CLI/Markdown rendered/http图片/artifacts 兜底/全屏
    const exts = ['a.ts', 'a.tsx', 'a.js', 'a.jsx', 'a.mjs', 'a.json', 'a.css', 'a.md', 'a.markdown', 'a.py', 'a.html', 'a.htm', 'a.txt', 'trailing.'];
    assert.deepEqual(
      exts.map((p) => detectFileLanguage(p)),
      ['typescript', 'typescript', 'javascript', 'javascript', 'javascript', 'json', 'css', 'markdown', 'markdown', 'python', 'html', 'html', 'text', 'text'],
    );
    assert.equal(detectFileLanguage(''), 'text');
    assert.ok(renderFileTab({ path: 'dir/', content: '' }, false).includes('dir/'));

    const httpImg = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      isFullscreen: true,
      viewMode: 'rendered',
      artifacts: [{ id: '1', name: 'doc.md', type: 'md', size: '1kb', preview: '# Title\n\nBody' }],
    });
    assert.ok(httpImg.includes('inspector-rendered-markdown'));
    assert.ok(httpImg.includes('inspector-shell-fullscreen'));

    const imgHttp = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      previewFile: { path: 'logo.webp', content: 'https://example.com/logo.webp' },
    });
    assert.ok(imgHttp.includes('https://example.com/logo.webp'));

    const cliRaw = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      viewMode: 'raw',
      showLineNumbers: true,
      wordWrap: false,
      previewFile: { path: 'snippet.', content: '1: one\n2: two\n3: \n4: four' },
    });
    assert.ok(cliRaw.includes('<td class="line-number"'));
    assert.ok(cliRaw.includes('white-space: pre;'));
  });

  await tCtx.test('4. 二进制 (.exe) 与超大文件信息下载卡片渲染、工具栏禁能与悬浮窗零阴影断言', () => {
    setLocale('zh-CN');

    const exeHtml = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      searchOpen: true,
      openFiles: [
        { path: '/opt/data/workspace/setup.exe', content: '', isBinary: true, byteSize: 3 * 1024 * 1024 },
      ],
      activeFilePath: '/opt/data/workspace/setup.exe',
    });
    assert.ok(exeHtml.includes('min-width: 380px;'), '展开态最小宽度必须设为 380px');
    assert.ok(exeHtml.includes('class="inspector-nonpreview-card"'), '二进制文件必须渲染专用下载卡片');
    assert.ok(exeHtml.includes('id="btn-preview-download-file"'), '下载卡片必须包含下载按钮');
    assert.ok(exeHtml.includes('setup.exe'), '卡片必须展示文件名');
    assert.ok(exeHtml.includes('EXE') && exeHtml.includes('3.0 MB'), '卡片必须展示扩展名与格式化体积徽章');
    assert.ok(exeHtml.includes('二进制文件暂不支持直接预览'), '卡片必须展示中文二进制提示标题');
    assert.ok(exeHtml.includes('id="btn-file-toggle-mode"') && exeHtml.includes('disabled'), '不可读文件必须禁能不适用的文本模式切换按钮');
    assert.equal(exeHtml.includes('id="inspector-search-container"'), false, '二进制/超大不可预览文件不得展开文本搜索栏');

    const tabMarkup = renderFileTab({ path: '/repo/README.md', content: '# hi' }, true);
    assert.ok(tabMarkup.includes('type="button"'), '关闭标签按钮必须显式声明 type="button"');
    assert.equal(tabMarkup.includes('style="'), false, '文件标签必须全面迁移至 CSS 类而非内联 style');

    const largeHtml = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      openFiles: [
        { path: '/opt/data/workspace/app.log', content: '', isTooLarge: true, byteSize: 8 * 1024 * 1024 },
        { path: 'noext', content: '', isBinary: true },
      ],
      activeFilePath: '/opt/data/workspace/app.log',
    });
    assert.ok(largeHtml.includes('8.0 MB') && largeHtml.includes('文件体积较大，已跳过直接渲染'), '超大文件必须展示大文件提示卡片');

    const noExtBinHtml = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      openFiles: [{ path: '/usr/local/bin/worker', content: '', isBinary: true }],
      activeFilePath: '/usr/local/bin/worker',
    });
    assert.ok(noExtBinHtml.includes('二进制') && noExtBinHtml.includes('worker'));

    // 切换英文语言后同样输出准确文案
    setLocale('en-US');
    const enBinHtml = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      openFiles: [{ path: '/opt/data/workspace/setup.exe', content: '', isBinary: true }],
      activeFilePath: '/opt/data/workspace/setup.exe',
    });
    assert.ok(enBinHtml.includes('Binary file cannot be previewed inline') && enBinHtml.includes('Download File'));
    setLocale('zh-CN');

    const styles = fs.readFileSync(path.join(ROOT, 'packages/desktop/src/renderer/styles.css'), 'utf8');
    const floatWinStart = styles.indexOf('\n.inspector-floating-window {');
    const floatWinRule = styles.slice(floatWinStart, styles.indexOf('}', floatWinStart) + 1);
    assert.ok(/box-shadow:\s*none;/.test(floatWinRule), '.inspector-floating-window 必须声明 box-shadow: none，严禁在 1px 细线旁生成黑色阴影');
    assert.ok(styles.includes('.btn-close-file-tab::after'), '关闭标签按钮必须包含扩大触控热区的 ::after 伪元素');
    assert.equal(
      /\.vertical-tab-item[^{]*\{[^}]*transition:\s*all|\.vertical-tab-item:hover[^{]*\{[^}]*--bg-card-hover/.test(styles),
      false,
      '.vertical-tab-item 不得保留已废弃的 --bg-card-hover 或 transition: all 规则',
    );
    assert.match(styles, /@media\s*\(max-width:\s*768px\)[\s\S]*min-width:\s*0\s*!important;/);
  });
});
