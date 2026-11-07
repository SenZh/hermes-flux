import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeToolOutput, hasToolOutput } from '../dist/lib/toolOutput.js';
import { renderOne } from './helpers/renderMessages.mjs';

const terminal = (output, extra = {}) => JSON.stringify({ output, exit_code: 0, error: null, ...extra });

test('Tool output normalization - 协议信封必须拆成人类可读内容', async (t) => {
  await t.test('1. terminal 信封：取出 output 正文，退出码进元信息', () => {
    const view = normalizeToolOutput(terminal('total 4\ndrwxr-xr-x 1 root root', { exit_code: 0 }));
    assert.equal(view.kind, 'text');
    assert.equal(view.text, 'total 4\ndrwxr-xr-x 1 root root');
    assert.equal(view.exitCode, 0);
    assert.ok(!JSON.stringify(view).includes('exit_code'), '禁止把信封键名透传到视图');
  });

  await t.test('2. terminal 非零退出码 + 空输出：保留错误与提示', () => {
    const view = normalizeToolOutput(JSON.stringify({
      output: '',
      exit_code: 124,
      error: 'Command timed out',
      hint: 'Raise timeout= (foreground max 600s)',
    }));
    assert.equal(view.exitCode, 124);
    assert.equal(view.error, 'Command timed out');
    assert.equal(view.note, 'Raise timeout= (foreground max 600s)');
  });

  await t.test('3. 命令输出本身是 JSON：拆成字段清单而不是原样大括号', () => {
    const view = normalizeToolOutput(terminal('{"ip":"216.200.231.163","city":"Draper"}'));
    assert.equal(view.kind, 'fields');
    assert.deepEqual(
      view.fields.map((field) => `${field.key}=${field.value}`),
      ['ip=216.200.231.163', 'city=Draper']
    );
  });

  await t.test('4. patch 信封：diff 视图 + 文件列表', () => {
    const diff = '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;';
    const view = normalizeToolOutput(JSON.stringify({ success: true, diff, files_modified: ['src/a.ts'] }));
    assert.equal(view.kind, 'diff');
    assert.equal(view.diff, diff);
    assert.deepEqual(view.files, ['src/a.ts']);
  });

  await t.test('5. search_files matches_text：按路径分组解析成命中行', () => {
    const matchesText = '/opt/app/a.ts\n  12: const x = 1;\n  42: const y = 2;\n/opt/app/b.ts\n  7: export default b;';
    const view = normalizeToolOutput(JSON.stringify({ total_count: 3, matches_text: matchesText }));
    assert.equal(view.kind, 'matches');
    assert.equal(view.total, 3);
    assert.deepEqual(view.matches, [
      { path: '/opt/app/a.ts', line: 12, text: 'const x = 1;' },
      { path: '/opt/app/a.ts', line: 42, text: 'const y = 2;' },
      { path: '/opt/app/b.ts', line: 7, text: 'export default b;' },
    ]);
  });

  await t.test('6. search_files matches 数组：结构化命中直接映射', () => {
    const view = normalizeToolOutput(JSON.stringify({
      total_count: 1,
      matches: [{ path: '/opt/app/a.ts', line: 9, content: 'hello' }],
    }));
    assert.equal(view.kind, 'matches');
    assert.deepEqual(view.matches, [{ path: '/opt/app/a.ts', line: 9, text: 'hello' }]);
  });

  await t.test('7. search_files 零命中：渲染空匹配视图而不是 JSON', () => {
    const view = normalizeToolOutput('{"total_count": 0}');
    assert.equal(view.kind, 'matches');
    assert.equal(view.matches.length, 0);
    assert.equal(view.total, 0);
  });

  await t.test('8. read_file：去掉行号前缀，文件缺失时给错误文案', () => {
    const content = '405|    api_mode: chat_completions\n406|platforms:\n407|  telegram:';
    const view = normalizeToolOutput(JSON.stringify({ content, total_lines: 3, truncated: false }));
    assert.equal(view.kind, 'text');
    assert.equal(view.text, '    api_mode: chat_completions\nplatforms:\n  telegram:');

    const missing = normalizeToolOutput(JSON.stringify({
      content: '',
      total_lines: 0,
      error: 'File not found: /opt/a.yaml',
      not_found: true,
    }));
    assert.equal(missing.kind, 'text');
    assert.equal(missing.text, 'File not found: /opt/a.yaml');
  });

  await t.test('9. write_file：只列改动文件', () => {
    const view = normalizeToolOutput(JSON.stringify({
      bytes_written: 2540,
      verified: true,
      resolved_path: '/opt/a.md',
      files_modified: ['/opt/a.md'],
    }));
    assert.equal(view.kind, 'files');
    assert.deepEqual(view.files, ['/opt/a.md']);
  });

  await t.test('10. 外部检索包装：剥掉 untrusted 外壳', () => {
    const raw = '<untrusted_tool_result source="web_search">\n检索结果正文\n</untrusted_tool_result>';
    const view = normalizeToolOutput(raw);
    assert.equal(view.kind, 'text');
    assert.equal(view.text, '检索结果正文');
  });

  await t.test('11. 纯文本与空值：原样保留 / 安全降级', () => {
    const text = normalizeToolOutput('[search_files] content search for "x" -> 19 matches');
    assert.equal(text.kind, 'text');
    assert.equal(text.text, '[search_files] content search for "x" -> 19 matches');

    assert.equal(normalizeToolOutput(undefined).kind, 'empty');
    assert.equal(normalizeToolOutput('   ').kind, 'empty');
    assert.equal(normalizeToolOutput(null).kind, 'empty');
    assert.equal(hasToolOutput({ kind: 'empty' }), false);
  });

  await t.test('12. 极端输入不得抛错：截断 JSON 退化为纯文本', () => {
    const broken = '{"output":"partial';
    const view = normalizeToolOutput(broken);
    assert.equal(view.kind, 'text');
    assert.equal(view.text, broken);
  });
});

test('Tool output rendering - 折叠区严禁泄露协议 JSON', async (t) => {
  const assistantWithTool = (name, output) => ({
    id: 'msg-tool-1',
    role: 'assistant',
    content: '已执行',
    timestamp: '14:40:00',
    status: 'complete',
    toolCalls: [{
      id: 'tool-1',
      name,
      status: 'completed',
      args: '{"command":"ss -lntup"}',
      output,
      durationMs: 1200,
    }],
  });

  await t.test('1. 命令信封渲染成等宽正文，且不含信封键名', () => {
    const html = renderOne(assistantWithTool('terminal', terminal('LISTEN 0 4096 127.0.0.1:7890')));
    assert.ok(html.includes('conv-tool-output__text'), '必须渲染终端正文容器');
    assert.ok(html.includes('LISTEN 0 4096 127.0.0.1:7890'), '必须展示命令真实输出');
    assert.ok(!html.includes('exit_code'), '严禁把信封键名展示给用户');
    assert.ok(!html.includes('approval'), '严禁展示审批噪声字段');
  });

  await t.test('2. 非零退出码渲染红色标记', () => {
    const html = renderOne(assistantWithTool('terminal', terminal('boom', { exit_code: 2 })));
    assert.ok(html.includes('conv-row__exit'), '非零退出码必须有独立标记');
    assert.ok(!html.includes('exit_code'), '标记不得回退成键名');
  });

  await t.test('3. diff 渲染逐行增删色，搜索渲染命中行', () => {
    const diffHtml = renderOne(assistantWithTool('patch', JSON.stringify({
      success: true,
      diff: '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new',
      files_modified: ['a.ts'],
    })));
    assert.ok(diffHtml.includes('conv-diff__line--add'), '新增行必须着色');
    assert.ok(diffHtml.includes('conv-diff__line--del'), '删除行必须着色');

    const searchHtml = renderOne(assistantWithTool('search_files', JSON.stringify({
      total_count: 1,
      matches_text: '/opt/a.ts\n  12: const x = 1;',
    })));
    assert.ok(searchHtml.includes('conv-match__path'), '命中必须展示文件路径');
    assert.ok(searchHtml.includes('conv-match__line'), '命中必须展示行号');
    assert.ok(!searchHtml.includes('matches_text'), '严禁泄露 matches_text 键名');
  });

  await t.test('4. 零命中渲染可读文案', () => {
    const html = renderOne(assistantWithTool('search_files', '{"total_count":0}'));
    assert.ok(html.includes('conv-tool-output__empty'), '零命中必须有空态容器');
    assert.ok(!html.includes('total_count'), '严禁泄露 total_count 键名');
  });
});
