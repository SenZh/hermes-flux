import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMcpCatalog,
  normalizeMcpTestResult,
  normalizeSkillInspectResult,
  normalizeSkillSearchResults,
  parseMcpArgsText,
  parseMcpEnvLines,
  splitSkillMarkdownFrontmatter,
  validateAndBuildMcpAddParams,
} from '../../dist/settings/extensionAdmin.js';

test('normalizeMcpCatalog：归一化预设目录、去重并过滤畸形行', () => {
  const items = normalizeMcpCatalog({
    servers: [
      {
        name: 'github',
        description: 'GitHub MCP',
        connector_slug: 'github-oauth',
        installed: false,
        enabled: true,
        requires: [' GITHUB_TOKEN ', ''],
        transport: 'http',
      },
      { name: 'github', description: 'duplicate', transport: 'stdio' },
      { name: '   ' },
      null,
      'bad-row',
      { name: 'sqlite', description: 'SQLite' },
    ],
  });
  assert.deepEqual(items, [
    {
      name: 'github',
      description: 'GitHub MCP',
      connectorSlug: 'github-oauth',
      installed: false,
      enabled: true,
      requires: ['GITHUB_TOKEN'],
      transport: 'http',
    },
    {
      name: 'sqlite',
      description: 'SQLite',
      connectorSlug: undefined,
      installed: false,
      enabled: false,
      requires: [],
      transport: 'stdio',
    },
  ]);
  assert.deepEqual(normalizeMcpCatalog(null), []);
  assert.deepEqual(normalizeMcpCatalog({}), []);
});

test('parseMcpArgsText：支持引号参数、转义与边界情况', () => {
  assert.deepEqual(parseMcpArgsText(''), []);
  assert.deepEqual(parseMcpArgsText('   '), []);
  assert.deepEqual(
    parseMcpArgsText('-y @modelcontextprotocol/server-filesystem "/Users/foo bar/docs" \'--flag=1 2\''),
    ['-y', '@modelcontextprotocol/server-filesystem', '/Users/foo bar/docs', '--flag=1 2'],
  );
  assert.deepEqual(parseMcpArgsText('--unclosed "hello world'), ['--unclosed', 'hello world']);
  // 双引号内转义与引号外反斜杠转义、末尾悬空反斜杠
  assert.deepEqual(parseMcpArgsText('"a \\"b\\" \\\\c" foo\\ bar trail\\'), ['a "b" \\c', 'foo bar', 'trail\\']);
});

test('parseMcpEnvLines：跳过注释/空行、去引号，并定位首个非法行', () => {
  assert.deepEqual(parseMcpEnvLines(''), { ok: true, env: {} });
  assert.deepEqual(
    parseMcpEnvLines('# 注释行\nAPI_KEY="secret=123"\n  \nLOG_LEVEL=debug\nPREFIX=\'a b\''),
    {
      ok: true,
      env: { API_KEY: 'secret=123', LOG_LEVEL: 'debug', PREFIX: 'a b' },
    },
  );
  assert.deepEqual(parseMcpEnvLines('GOOD=1\nNO_EQUALS'), { ok: false, invalidLine: 'NO_EQUALS' });
  assert.deepEqual(parseMcpEnvLines('123BAD=1'), { ok: false, invalidLine: '123BAD=1' });
});

test('validateAndBuildMcpAddParams：覆盖预设、stdio 与 http 三分支校验及负向边界', () => {
  assert.deepEqual(
    validateAndBuildMcpAddParams(
      {
        mode: 'preset',
        name: 'my_github',
        preset: 'github',
        transport: 'stdio',
        command: '',
        argsText: '',
        envText: '',
        url: '',
        bearerToken: '  tok_123  ',
      },
      'arch',
    ),
    {
      ok: true,
      params: {
        profile: 'arch',
        name: 'my_github',
        preset: 'github',
        bearer_token: 'tok_123',
      },
    },
  );

  assert.deepEqual(
    validateAndBuildMcpAddParams({
      mode: 'custom',
      name: 'fs-local',
      preset: '',
      transport: 'stdio',
      command: 'npx',
      argsText: '-y @mcp/fs "/tmp/work dir"',
      envText: 'READONLY=true',
      url: '',
      bearerToken: '',
    }),
    {
      ok: true,
      params: {
        name: 'fs-local',
        config: {
          command: 'npx',
          args: ['-y', '@mcp/fs', '/tmp/work dir'],
          env: { READONLY: 'true' },
        },
      },
    },
  );

  assert.deepEqual(
    validateAndBuildMcpAddParams({
      mode: 'custom',
      name: 'remote-mcp',
      preset: '',
      transport: 'http',
      command: '',
      argsText: '',
      envText: '',
      url: 'https://mcp.example.com/sse',
      bearerToken: 'secret',
    }),
    {
      ok: true,
      params: {
        name: 'remote-mcp',
        config: { url: 'https://mcp.example.com/sse', transport: 'http' },
        bearer_token: 'secret',
      },
    },
  );

  assert.deepEqual(
    validateAndBuildMcpAddParams({
      mode: 'custom',
      name: '',
      preset: '',
      transport: 'stdio',
      command: 'npx',
      argsText: '',
      envText: '',
      url: '',
      bearerToken: '',
    }),
    { ok: false, reason: 'nameRequired' },
  );
  assert.deepEqual(
    validateAndBuildMcpAddParams({
      mode: 'custom',
      name: '非法名称 123',
      preset: '',
      transport: 'stdio',
      command: 'npx',
      argsText: '',
      envText: '',
      url: '',
      bearerToken: '',
    }),
    { ok: false, reason: 'nameInvalid' },
  );
  assert.deepEqual(
    validateAndBuildMcpAddParams({
      mode: 'custom',
      name: 'bad-http',
      preset: '',
      transport: 'http',
      command: '',
      argsText: '',
      envText: '',
      url: 'ftp://example.com',
      bearerToken: '',
    }),
    { ok: false, reason: 'urlInvalid' },
  );

  // 补齐其余校验错误码与无 profile / 无 token / malformed URL / stdio with profile 全分支
  assert.deepEqual(
    validateAndBuildMcpAddParams({
      mode: 'preset',
      name: 'github',
      preset: '   ',
      transport: 'stdio',
      command: '',
      argsText: '',
      envText: '',
      url: '',
      bearerToken: '',
    }),
    { ok: false, reason: 'presetRequired' },
  );
  assert.deepEqual(
    validateAndBuildMcpAddParams({
      mode: 'preset',
      name: 'github',
      preset: 'github',
      transport: 'stdio',
      command: '',
      argsText: '',
      envText: '',
      url: '',
      bearerToken: '   ',
    }),
    { ok: true, params: { name: 'github', preset: 'github' } },
  );
  assert.deepEqual(
    validateAndBuildMcpAddParams({
      mode: 'custom',
      name: 'no-cmd',
      preset: '',
      transport: 'stdio',
      command: '   ',
      argsText: '',
      envText: '',
      url: '',
      bearerToken: '',
    }),
    { ok: false, reason: 'commandRequired' },
  );
  assert.deepEqual(
    validateAndBuildMcpAddParams({
      mode: 'custom',
      name: 'bad-env',
      preset: '',
      transport: 'stdio',
      command: 'npx',
      argsText: '',
      envText: 'BROKEN_LINE',
      url: '',
      bearerToken: '',
    }),
    { ok: false, reason: 'envInvalid', invalidLine: 'BROKEN_LINE' },
  );
  assert.deepEqual(
    validateAndBuildMcpAddParams(
      {
        mode: 'custom',
        name: 'stdio-minimal',
        preset: '',
        transport: 'stdio',
        command: 'echo',
        argsText: '',
        envText: '',
        url: '',
        bearerToken: '',
      },
      'arch',
    ),
    { ok: true, params: { name: 'stdio-minimal', config: { command: 'echo' }, profile: 'arch' } },
  );
  assert.deepEqual(
    validateAndBuildMcpAddParams({
      mode: 'custom',
      name: 'no-url',
      preset: '',
      transport: 'http',
      command: '',
      argsText: '',
      envText: '',
      url: '   ',
      bearerToken: '',
    }),
    { ok: false, reason: 'urlRequired' },
  );
  assert.deepEqual(
    validateAndBuildMcpAddParams({
      mode: 'custom',
      name: 'not-a-url',
      preset: '',
      transport: 'http',
      command: '',
      argsText: '',
      envText: '',
      url: 'not a valid url',
      bearerToken: '',
    }),
    { ok: false, reason: 'urlInvalid' },
  );
  assert.deepEqual(
    validateAndBuildMcpAddParams(
      {
        mode: 'custom',
        name: 'http-prof',
        preset: '',
        transport: 'http',
        command: '',
        argsText: '',
        envText: '',
        url: 'http://127.0.0.1:8080/mcp',
        bearerToken: '',
      },
      'arch',
    ),
    {
      ok: true,
      params: { name: 'http-prof', config: { url: 'http://127.0.0.1:8080/mcp', transport: 'http' }, profile: 'arch' },
    },
  );
});

test('normalizeMcpTestResult & normalizeSkillSearchResults：兼容 browse/search 形状与已装交集', () => {
  assert.deepEqual(
    normalizeMcpTestResult({
      ok: true,
      tools: [null, { name: 'read', description: 'Read file' }, { name: '' }],
      prompts: 2,
      resources: 1,
      oauth_needed: false,
    }),
    {
      ok: true,
      tools: [{ name: 'read', description: 'Read file' }],
      error: undefined,
      prompts: 2,
      resources: 1,
      oauthNeeded: false,
    },
  );
  assert.deepEqual(
    normalizeMcpTestResult({
      ok: false,
      error: 'token expired',
      prompts: Number.NaN,
      resources: Number.POSITIVE_INFINITY,
      oauth_needed: true,
    }),
    {
      ok: false,
      tools: [],
      error: 'token expired',
      prompts: undefined,
      resources: undefined,
      oauthNeeded: true,
    },
  );
  assert.deepEqual(normalizeMcpTestResult(undefined), {
    ok: false,
    tools: [],
    oauthNeeded: false,
  });

  const installed = new Set(['github', 'org/codebase-inspect']);
  const browse = normalizeSkillSearchResults(
    {
      items: [
        null,
        { name: '   ' },
        { name: 'github', description: 'PR flow', source: 'official', trust: 'verified' },
        { name: 'inspect', description: 'Code trace', identifier: 'org/codebase-inspect' },
        { name: 'remote-installed', description: 'Preinstalled', installed: true },
        { name: 'new-skill', description: 'Fresh tool' },
      ],
      page: 2,
      total_pages: 4,
      total: 63,
    },
    installed,
  );
  assert.equal(browse.page, 2);
  assert.equal(browse.totalPages, 4);
  assert.equal(browse.total, 63);
  assert.deepEqual(
    browse.rows.map((r) => [r.name, r.installed]),
    [
      ['github', true],
      ['inspect', true],
      ['remote-installed', true],
      ['new-skill', false],
    ],
  );

  const search = normalizeSkillSearchResults(
    {
      results: [{ name: 'new-skill', description: 'Found' }, { name: 'new-skill', description: 'Dup' }],
      page: 0,
      total_pages: -1,
      total: -5,
    },
    installed,
  );
  assert.equal(search.rows.length, 1);
  assert.equal(search.rows[0].installed, false);
  assert.equal(search.page, 1);
  assert.equal(search.totalPages, 1);
  assert.equal(search.total, 1);

  assert.deepEqual(normalizeSkillSearchResults(null), { rows: [], page: 1, totalPages: 1, total: 0 });
  assert.deepEqual(normalizeSkillSearchResults({}), { rows: [], page: 1, totalPages: 1, total: 0 });
});

test('splitSkillMarkdownFrontmatter：提取头部 YAML 元数据并保护普通 Markdown 分割线', () => {
  assert.deepEqual(splitSkillMarkdownFrontmatter(''), { frontmatter: [], body: '' });

  const withFrontmatter =
    '\uFEFF---\n# 注释\nname: "code-review"\ndescription: \'Review PR carefully\'\n---\n\n# 标题\n正文内容';
  assert.deepEqual(splitSkillMarkdownFrontmatter(withFrontmatter), {
    frontmatter: [
      { key: 'name', value: 'code-review' },
      { key: 'description', value: 'Review PR carefully' },
    ],
    body: '# 标题\n正文内容',
  });

  // 仅有 frontmatter 且无尾随正文时（match[2] === undefined）须干净解包单引号且 body 为空串
  assert.deepEqual(
    splitSkillMarkdownFrontmatter("---\nname: solo\ndescription: 'Single Quoted'\n---"),
    {
      frontmatter: [
        { key: 'name', value: 'solo' },
        { key: 'description', value: 'Single Quoted' },
      ],
      body: '',
    },
  );

  // 正文含 `---` 分割线但内部没有 key:value 时不得误裁内容
  const plainHr = '---\n这是一个分割线后的纯文本段落\n---\n\n后续内容';
  assert.deepEqual(splitSkillMarkdownFrontmatter(plainHr), {
    frontmatter: [],
    body: plainHr,
  });
});

test('normalizeSkillInspectResult：优先级、预览标记、标签去重与降级全覆盖', () => {
  // 1. info 自带完整 skill_md 时优先使用且非预览态
  const full = normalizeSkillInspectResult('github', {
    inspectPayload: {
      info: {
        name: 'GitHub Flow',
        description: 'PR automation',
        source: 'hub',
        identifier: 'official/github',
        category: 'devtools',
        tags: ['git', 'pr', 'git', '  '],
        skill_md: '# Full Spec',
        skill_md_preview: '# Short',
      },
    },
    dispatchPayload: { type: 'skill', message: '# Dispatch Body' },
  });
  assert.deepEqual(full, {
    name: 'GitHub Flow',
    description: 'PR automation',
    source: 'hub',
    identifier: 'official/github',
    category: 'devtools',
    tags: ['git', 'pr'],
    markdown: '# Full Spec',
    isPreview: false,
  });

  // 2. command.dispatch（type=skill 且更长）优于缩短的 skill_md_preview
  const fromDispatch = normalizeSkillInspectResult('local-skill', {
    inspectPayload: { skill_md_preview: 'short preview' },
    dispatchPayload: {
      type: 'skill',
      name: 'local-skill',
      message: '---\ndescription: From Frontmatter\n---\n\n## Usage\nRun this skill.',
    },
  });
  assert.equal(fromDispatch.isPreview, false);
  assert.equal(fromDispatch.description, 'From Frontmatter');
  assert.ok(fromDispatch.markdown.includes('## Usage'));

  // 3. 非 skill 类型的 dispatch 消息不得污染；仅有 preview 时标记 isPreview=true
  const previewOnly = normalizeSkillInspectResult('remote-skill', {
    inspectPayload: { info: { skill_md_preview: '## Preview Header' } },
    dispatchPayload: { type: 'exec', message: 'not a skill markdown body' },
    fallbackDescription: '列表里的简介',
  });
  assert.equal(previewOnly.isPreview, true);
  assert.equal(previewOnly.markdown, '## Preview Header');
  assert.equal(previewOnly.description, '列表里的简介');

  // 4. 全缺失退化为明确空正文
  assert.deepEqual(normalizeSkillInspectResult(' empty '), {
    name: 'empty',
    description: undefined,
    source: undefined,
    identifier: undefined,
    category: undefined,
    tags: [],
    markdown: '',
    isPreview: false,
  });
});
