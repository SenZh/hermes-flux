import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAliasSet,
  filterDesktopCommands,
  isDesktopVisible,
  normalizeCommandName,
} from '../../dist/renderer/slashVisibility.mjs';

test('斜杠可见性：网关 desktop 分级与别名折叠', async (t) => {
  await t.test('terminal 与 hidden 在桌面端不展示', () => {
    assert.equal(isDesktopVisible('terminal'), false);
    assert.equal(isDesktopVisible('hidden'), false);
  });

  await t.test('无标记与其余分级一律展示', () => {
    // 网关实测取值：null / advanced / composer-voice / settings
    for (const mark of [null, undefined, '', 'advanced', 'composer-voice', 'settings']) {
      assert.equal(isDesktopVisible(mark), true, `${mark} 应当展示`);
    }
  });

  await t.test('别名集合剔除主名自身，并归一前导斜杠与尾随空格', () => {
    const aliases = buildAliasSet({
      '/reset': '/new',
      '/compact': '/compress',
      '/s ': '/steer',
      '/new': '/new',
    });
    assert.ok(aliases.has('reset'));
    assert.ok(aliases.has('compact'));
    assert.ok(aliases.has('s'), '带尾随空格的别名必须归一后仍能折叠');
    assert.ok(!aliases.has('new'), '主命令自身不是别名');
  });

  await t.test('过滤：别名与 terminal/hidden 一并剔除', () => {
    const marks = new Map([
      ['redraw', 'terminal'],
      ['model', 'hidden'],
      ['compress', null],
    ]);
    const aliases = buildAliasSet({ '/compact': '/compress', '/reset': '/new' });
    const out = filterDesktopCommands({
      items: [
        { name: '/redraw' },
        { name: '/model' },
        { name: '/compress' },
        { name: '/compact' },
        { name: '/goal' },
      ],
      desktopMarks: marks,
      aliases,
    });
    assert.deepEqual(out.map((i) => i.name), ['/compress', '/goal']);
  });

  await t.test('过滤后可能为空，调用方必须与请求失败区分', () => {
    const out = filterDesktopCommands({
      items: [{ name: '/redraw' }],
      desktopMarks: new Map([['redraw', 'terminal']]),
      aliases: new Set(),
    });
    assert.deepEqual(out, [], '全部被隐藏时返回空数组，而不是回退到未过滤列表');
  });

  await t.test('命令名归一：去前导斜杠与尾随空格', () => {
    assert.equal(normalizeCommandName('/s '), 's');
    assert.equal(normalizeCommandName('v'), 'v');
    assert.equal(normalizeCommandName(''), '');
  });

  await t.test('空名条目被丢弃', () => {
    const out = filterDesktopCommands({
      items: [{ name: '/' }, { name: '/goal' }],
      desktopMarks: new Map(),
      aliases: new Set(),
    });
    assert.deepEqual(out.map((i) => i.name), ['/goal']);
  });
});
