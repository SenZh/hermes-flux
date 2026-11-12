import test from 'node:test';
import assert from 'node:assert/strict';
import { localizeSlashDescription, toSlashOptions } from '../../dist/renderer/slashCatalog.mjs';

/** 模拟 t()：命中返回译文，未命中原样返回键名（与真实实现一致）。 */
const makeT = (dict) => (key) => dict[key] ?? key;

const ZH = {
  'slash.compress': '压缩对话上下文',
  'slash.new': '开启全新会话（新的会话 ID 与历史）',
};

test('斜杠命令投影：名称原样、说明本地化、不截断', async (t) => {
  await t.test('内置命令命中字典时输出中文说明', () => {
    const out = toSlashOptions(
      [{ text: '/compress', meta: 'Compress conversation context' }],
      undefined,
      makeT(ZH),
    );
    assert.deepEqual(out, [
      { name: '/compress', description: '压缩对话上下文', isSkill: false, replaceFrom: undefined },
    ]);
  });

  await t.test('命令名永不翻译，只翻译说明', () => {
    const out = toSlashOptions([{ text: 'new', meta: 'Start a new session' }], undefined, makeT(ZH));
    assert.equal(out[0].name, '/new', '缺少前导斜杠时补上');
    assert.equal(out[0].description, '开启全新会话（新的会话 ID 与历史）');
  });

  await t.test('未收录的命令回退网关原文，不编造', () => {
    const out = toSlashOptions(
      [{ text: '/some-plugin-skill', meta: 'Watch named companies for material news.' }],
      undefined,
      makeT(ZH),
    );
    assert.equal(out[0].description, 'Watch named companies for material news.');
  });

  await t.test('说明缺失时不编造，留空', () => {
    const out = toSlashOptions([{ text: '/zzz' }], undefined, makeT(ZH));
    assert.equal(out[0].description, '');
  });

  await t.test('条数由网关决定：40 条全部保留', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ text: `/cmd${i}`, meta: `d${i}` }));
    const out = toSlashOptions(items, 0, makeT(ZH));
    assert.equal(out.length, 40, '不得截断，历史上写死 12 条导致后半段永不可见');
  });

  await t.test('携带 kind 的条目按 replace_from 精确替换光标 token', () => {
    const out = toSlashOptions(
      [
        { text: '/review', meta: 'x', kind: 'command' },
        { text: '/some-skill', meta: 'y', kind: 'skill' },
        { text: '/no-kind', meta: 'z' },
      ],
      7,
      makeT(ZH),
    );
    // 命令与技能插入后都要替换掉光标前的 token，因此两者都带 replaceFrom；
    // 网关没给 kind 的条目退化为整段替换。
    assert.equal(out[0].replaceFrom, 7);
    assert.equal(out[1].replaceFrom, 7);
    assert.equal(out[1].isSkill, true);
    assert.equal(out[2].replaceFrom, undefined);
  });

  await t.test('空名称被丢弃，不产生空行', () => {
    const out = toSlashOptions([{ text: '' }, { text: '   ' }, { text: '/ok' }], undefined, makeT(ZH));
    assert.equal(out.length, 1);
    assert.equal(out[0].name, '/ok');
  });

  await t.test('localizeSlashDescription 对空名回退原文', () => {
    assert.equal(localizeSlashDescription('/', 'fallback', makeT(ZH)), 'fallback');
  });
});
