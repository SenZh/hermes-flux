/**
 * i18n 字典分域完整性守卫（构建产物口径）。
 *
 * 设计意图 (Why)：
 *   index.ts 已拆为 ./messages/* 九个域片段，spread 合并会静默覆盖同名 key，
 *   也会在漏搬某个域时静默少 key。只看 index 的运行时对象无法区分「搬运正确」
 *   与「某个域整个丢了但 index 仍能编译」，因此必须逐域比对。
 *
 * 约束与规则 (Rules)：
 *   1. 只读 dist 产物：源码片段是 TS，Node 无法直接 import；
 *   2. 域清单必须与 index.ts 的 spread 顺序一致，新增域时本文件同步登记；
 *   3. 产物文件数必须等于登记域数，防止新增域后本测试静默漏检（假绿）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import * as chrome from '../dist/i18n/messages/chrome.js';
import * as settings from '../dist/i18n/messages/settings.js';
import * as slash from '../dist/i18n/messages/slash.js';
import * as bot from '../dist/i18n/messages/bot.js';
import * as conversation from '../dist/i18n/messages/conversation.js';
import * as dock from '../dist/i18n/messages/dock.js';
import * as inspector from '../dist/i18n/messages/inspector.js';
import * as agents from '../dist/i18n/messages/agents.js';
import * as gallery from '../dist/i18n/messages/gallery.js';

const PARTS = [
  ['chrome', chrome.zhChrome, chrome.enChrome],
  ['settings', settings.zhSettings, settings.enSettings],
  ['slash', slash.zhSlash, slash.enSlash],
  ['bot', bot.zhBot, bot.enBot],
  ['conversation', conversation.zhConversation, conversation.enConversation],
  ['dock', dock.zhDock, dock.enDock],
  ['inspector', inspector.zhInspector, inspector.enInspector],
  ['agents', agents.zhAgents, agents.enAgents],
  ['gallery', gallery.zhGallery, gallery.enGallery],
];

test('字典分域：域间零重叠、并集等于 zhDict、en 逐域等集', async () => {
  const { zhDict, enDict } = await import('../dist/i18n/index.js');
  const seen = new Map();
  for (const [name, zh, en] of PARTS) {
    assert.deepEqual(
      Object.keys(en).sort(),
      Object.keys(zh).sort(),
      `${name} 域 en/zh key 不等集`,
    );
    for (const key of Object.keys(zh)) {
      assert.equal(seen.has(key), false, `key ${key} 同时出现在 ${seen.get(key)} 与 ${name}`);
      seen.set(key, name);
    }
  }
  assert.equal(seen.size, Object.keys(zhDict).length, '分域并集必须等于 zhDict 全量');
  assert.deepEqual(Object.keys(enDict).sort(), Object.keys(zhDict).sort(), 'enDict 必须与 zhDict 全等集');
});

test('分域产物清单与登记域数一致（新增域不得静默漏检）', () => {
  const dir = path.resolve(import.meta.dirname, '../dist/i18n/messages');
  const built = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !f.endsWith('.map'));
  assert.equal(built.length, PARTS.length, `产物域文件数 ${built.length} 与登记域数 ${PARTS.length} 不一致`);
  assert.deepEqual(
    built.map((f) => f.replace(/\.js$/, '')).sort(),
    PARTS.map(([name]) => name).sort(),
    '产物域文件清单必须与登记域清单一致',
  );
});
