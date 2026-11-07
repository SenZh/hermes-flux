import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectTouchedFiles, isTouchedFileRef, normalizeFileRef } from '../dist/lib/fileRefs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const loadMarkdown = async () => {
  const { renderMarkdown } = await import('../dist/components/MiddlePod/MiddlePod.js');
  return renderMarkdown;
};

test('File references - 只有会话真实读写过的文件才可点击', async (t) => {
  await t.test('1. 路径归一化：反斜杠 / 引号 / 行号 / 尾斜杠', () => {
    assert.equal(normalizeFileRef(' `C:\\work\\app\\main.ts` '), 'C:/work/app/main.ts');
    assert.equal(normalizeFileRef('/opt/app/a.ts:42:7'), '/opt/app/a.ts');
    assert.equal(normalizeFileRef('./src/a.ts'), 'src/a.ts');
    assert.equal(normalizeFileRef('/opt/app/'), '/opt/app');
  });

  await t.test('2. 采集：只扫文件类工具的 args / output，命令里的路径不算', () => {
    const files = collectTouchedFiles([
      { name: 'read_file', args: JSON.stringify({ path: '/opt/app/a.ts' }) },
      { name: 'patch', args: '{}', output: JSON.stringify({ files_modified: ['/opt/app/b.ts'], diff: '--- a/b\n+++ b/b' }) },
      { name: 'write_file', args: '{}', output: JSON.stringify({ resolved_path: '/opt/app/c.md', files_modified: ['/opt/app/c.md'] }) },
      { name: 'terminal', args: 'cat /etc/hosts', output: JSON.stringify({ output: 'ok', exit_code: 0 }) },
      { name: 'search_files', args: '{"path":"/opt/app/a.ts"}', output: '{"total_count":1}' },
    ]);
    assert.deepEqual(files.sort(), ['/opt/app/a.ts', '/opt/app/b.ts', '/opt/app/c.md']);
  });

  await t.test('3. 匹配：绝对后缀 / 相对后缀 / basename 唯一', () => {
    const known = ['/opt/app/src/a.ts', '/opt/app/config.yaml'];
    assert.equal(isTouchedFileRef('/opt/app/src/a.ts', known), true, '绝对路径精确命中');
    assert.equal(isTouchedFileRef('src/a.ts', known), true, '相对路径按段后缀命中');
    assert.equal(isTouchedFileRef('a.ts', known), true, '唯一 basename 命中');
    assert.equal(isTouchedFileRef('b.ts', known), false, '未读写文件不命中');
    assert.equal(isTouchedFileRef('', known), false, '空引用不命中');
    assert.equal(isTouchedFileRef('a.ts', []), false, '集合为空时一律不可点击');
  });

  await t.test('4. 匹配：同名文件多个时不得猜测目标', () => {
    const ambiguous = ['/opt/a/index.ts', '/opt/b/index.ts'];
    assert.equal(isTouchedFileRef('index.ts', ambiguous), false, '多个同名文件必须保持不可点击');
    assert.equal(isTouchedFileRef('/opt/b/index.ts', ambiguous), true, '绝对路径仍可精确命中');
  });

  await t.test('5. 行内代码：未写入正文的路径保持普通代码药丸', async () => {
    const renderMarkdown = await loadMarkdown();
    const html = renderMarkdown('配置文件在 `/opt/app/config.yaml` 里');
    assert.ok(html.includes('class="md-code md-file-ref"'), '仍标记为文件引用以便后续识别');
    assert.ok(!html.includes('md-file-ref--linked'), '未读写文件不得带可点击标记');
    assert.ok(!html.includes('data-preview-file'), '未读写文件不得绑定预览');
    assert.ok(!html.includes('md-file__icon'), '未读写文件不显示文件图标');
  });

  await t.test('6. 行内代码：命中集合后变成可点击引用并带图标', async () => {
    const renderMarkdown = await loadMarkdown();
    const html = renderMarkdown('配置文件在 `/opt/app/config.yaml` 里', {
      knownFiles: ['/opt/app/config.yaml'],
    });
    assert.ok(html.includes('md-file-ref--linked'), '已读写文件必须可点击');
    assert.ok(html.includes('data-preview-file="/opt/app/config.yaml"'), '必须绑定预览路径');
    assert.ok(html.includes('data-icon="yaml"'), '必须带文件类型图标');
    assert.ok(html.includes('tool-file-link'), '必须复用宿主既有文件链接委托');
  });

  await t.test('7. 缓存隔离：同一段正文在不同文件集合下结果不同', async () => {
    const renderMarkdown = await loadMarkdown();
    const body = '打开 `/opt/app/only-once.ts` 看看';
    const plain = renderMarkdown(body);
    const linked = renderMarkdown(body, { knownFiles: ['/opt/app/only-once.ts'] });
    assert.ok(!plain.includes('md-file-ref--linked'));
    assert.ok(linked.includes('md-file-ref--linked'), '缓存键必须包含文件集合，否则会命中上一轮结果');
  });

  await t.test('8. Markdown 文件链接：命中才渲染 anchor，未命中保持纯文本', async () => {
    const renderMarkdown = await loadMarkdown();
    const linked = renderMarkdown('[配置](/opt/app/config.yaml)', { knownFiles: ['/opt/app/config.yaml'] });
    assert.ok(linked.includes('<a '), '已读写文件链接必须可点击');
    assert.ok(linked.includes('data-preview-file="/opt/app/config.yaml"'));

    const plain = renderMarkdown('[配置](/opt/app/config.yaml)');
    assert.ok(!plain.includes('<a '), '未读写文件链接不得渲染成锚点');
    assert.ok(plain.includes('data-file-ref="/opt/app/config.yaml"'), '保留引用标记供后续校正');
  });

  await t.test('9. 外部 URL 不受影响，始终可点击', async () => {
    const renderMarkdown = await loadMarkdown();
    const html = renderMarkdown('文档见 `https://example.com/docs`');
    assert.ok(html.includes('data-preview-url="https://example.com/docs"'), 'URL 引用必须保持可点击');
  });

  await t.test('10. 样式不变量：文件图标走 vertical-align，链接不再常显下划线', () => {
    const css = read('packages/ui/src/styles/conversation.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const iconBlock = css.match(/\.md-file__icon,\s*\.md-link__icon\s*\{([\s\S]*?)\}/);
    assert.ok(iconBlock, '必须存在文件图标样式块');
    assert.ok(iconBlock[1].includes('vertical-align: -0.18em'), '图标必须用 vertical-align 对齐文字中腰');
    assert.ok(!iconBlock[1].includes('align-self: center'), '禁止再用 align-self 居中（会与基线混搭导致上浮）');

    const labelBlock = css.match(/\.md-link__label\s*\{([\s\S]*?)\}/);
    assert.ok(labelBlock, '必须存在链接文字样式块');
    assert.ok(labelBlock[1].includes('text-decoration: none'), '文件引用默认不得常显下划线');
    assert.ok(css.includes('.md-file-ref--linked'), '必须存在可点击文件引用样式');
  });
});
