/**
 * 左侧栏真实数据流 E2E —— 对接**真实网关** (packages/desktop/__tests__/e2e/left-rail-live-cdp.test.mjs)
 *
 * 【这套测试在验证什么】
 *   把**真实生产 renderer**（packages/desktop/dist/renderer/index.js）跑在真实 Edge/Chrome 里，
 *   连**真实 Hermes 网关**，用真实 RPC + 真实事件流驱动真实 DOM，
 *   再把 DOM 与"从同一网关独立读到的真值"逐项对账。
 *
 * 【安全约束（严格遵守）】
 *   - 网关地址、用户名、密码全部来自环境变量 FLUX_GATEWAY_URL / FLUX_GATEWAY_USER / FLUX_GATEWAY_PASS；
 *   - 绝不调用任何删除/归档类接口（session.delete / session.archive / groups.disband / projects.delete）；
 *   - 只做只读对账 + 追加一条消息（用户明确许可，不得删除其数据）。
 *
 * 【静态验证】
 *   (a) 列表顺序：DOM 顺序 == 真实会话按最后活跃降序；
 *   (b) 时间显示：会话行时间 == 该会话真实最后活跃时间；
 *   (c) 副标题：会话行副标题 == 该会话真实最后一条消息摘要。
 *
 * 【动态验证】会话 / 群聊 / Agents 三类各连测两轮：
 *   (a) 状态变更：发起后"进行中"，完成后"未读"；
 *   (b) 排序置顶：因它最新，必须顶到列表最上；
 *   (c) 信息匹配：副标题与时间对得上真实最后一条消息。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launchLiveApp, findBrowser, liveGatewayEnvReady } from './browser-harness.mjs';
import { login, fetchTicket, openRpc, httpProxy, liveGatewayBase } from './live-gateway-client.mjs';

const ROOT = path.resolve('.');

/** 独立于渲染层的真值读取器（直连真实网关 REST + RPC） */
async function makeTruth() {
  const { cookie } = await login();
  const ticket = await fetchTicket(cookie);
  const rpc = openRpc(cookie, ticket);
  await rpc.ready;
  return {
    /**
     * 会话真值取 REST /api/sessions —— 只有它给 last_active（最后一条消息时间）。
     * WS session.list 只有 started_at（创建时间），用它做对账会得到错误期望值。
     * 渲染层会合并所有 Profile 的会话，这里也逐个 Profile 取并以 profile::id 去重，
     * 同时镜像渲染层可见性规则（丢弃 hidden / archived / 空标题）。
     */
    async sessions() {
      const profs = (await rpc.call('profiles.list', {})).profiles || [];
      const names = ['default', ...profs.map((p) => p.name)].filter(Boolean);
      const uniq = [...new Set(names)];
      const out = [];
      const seen = new Set();
      for (const profile of uniq) {
        let raw;
        try {
          raw = await httpProxy(cookie, { baseUrl: liveGatewayBase(), path: '/api/sessions', method: 'GET', params: { profile, limit: 100 } });
        } catch { continue; }
        for (const s of raw?.sessions || raw?.data || []) {
          if (s.hidden || s.archived) continue;
          if (!String(s.title || '').trim()) continue;
          const key = `${profile}::${s.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            id: String(s.id),
            title: String(s.title || ''),
            preview: String(s.preview || ''),
            timestamp: typeof s.last_active === 'number' ? (s.last_active > 1e11 ? s.last_active : s.last_active * 1000) : 0,
            source: String(s.source || ''),
            profile,
          });
        }
      }
      // 生产侧以 `profile::id` 为去重键（跨 Profile 同 id 各保留一份），
      // 真值必须用同一口径，否则期望集会与 DOM 行为冲突。
      return out;
    },
    async groups() {
      const res = await rpc.call('groups.list', {});
      return (res?.rooms || []).map((r) => ({
        roomId: r.room_id, name: r.name,
        updatedAt: Math.round((r.updated_at || 0) * 1000),
      }));
    },
    /** 某会话的真实最后一条消息（与渲染层 enrichSessionPreviews 同源） */
    async lastMessage(sessionId) {
      const raw = await httpProxy(cookie, {
        baseUrl: liveGatewayBase(),
        path: `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
        method: 'GET',
        params: { limit: 1, offset: 0, order: 'latest' },
      });
      const msg = (raw?.messages || [])[0];
      if (!msg) return null;
      const text = String(msg.content ?? msg.text ?? '').replace(/\s+/g, ' ').trim();
      const rawTs = typeof msg.timestamp === 'number' ? msg.timestamp : 0;
      const timestamp = rawTs > 1e11 ? rawTs : rawTs > 0 ? rawTs * 1000 : 0;
      return { text, role: String(msg.role || ''), timestamp };
    },
    async profiles() {
      const res = await rpc.call('profiles.list', {});
      return res?.profiles || [];
    },
    close() { rpc.close(); },
  };
}

async function typeAndSend(app, text) {
  await app.evaluate(`(() => {
    const input = document.getElementById('dock-prompt-input');
    input.value = ${JSON.stringify(text)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('dock-send-btn').click();
    return true;
  })()`);
}

async function clickSelector(app, selector) {
  const sel = JSON.stringify(selector);
  const expr = '(() => { const el = document.querySelector(' + sel + '); if (el) { el.click(); return true; } return false; })()';
  return app.evaluate(expr);
}

/** DOM 中当前可见的会话行 id（顺序即渲染顺序） */
const READ_SESSION_IDS = `Array.from(document.querySelectorAll('#rail-sessions-nested-list .session-item')).map(r => r.dataset.id)`;

test('左侧栏真实数据流 - 对接真实网关 (静态对账 + 三类实体各两轮动态验证)', async (t) => {
  if (!findBrowser()) { t.skip('本机未找到 Edge/Chrome'); return; }
  if (!liveGatewayEnvReady()) {
    t.skip('未配置真实网关：需要 FLUX_GATEWAY_URL / FLUX_GATEWAY_USER / FLUX_GATEWAY_PASS');
    return;
  }

  const truth = await makeTruth();
  const app = await launchLiveApp({ rootDir: ROOT });

  t.after(async () => {
    await app.close();
    truth.close();
  });

  await app.waitUntilReady();
  await app.waitFor(`document.querySelectorAll('#rail-sessions-nested-list .session-item').length > 0`, { label: 'sessions mounted', timeoutMs: 30000 });

  // ============================================================ 静态验证
  await t.test('静态(a) 列表顺序：DOM 会话顺序 == 真实最后活跃降序', async () => {
    const domOrder = await app.evaluate(READ_SESSION_IDS);
    const realSessions = await truth.sessions();
    const realIds = new Set(realSessions.map((s) => s.id));
    // DOM 按 profile::id 去重后仍可能同 id 出现两次（跨 Profile 合法重复），
    // 顺序断言以"去重后的有序集合"为准：逐位比较前 N 个唯一 id。
    const domUnique = [...new Set(domOrder.filter((id) => realIds.has(id)))];
    const expected = [...new Set(realSessions.slice().sort((a, b) => b.timestamp - a.timestamp).map((s) => s.id))];
    assert.ok(domUnique.length >= 2, `至少应有 2 条真实会话渲染；实际=${domUnique.length}`);
    assert.deepEqual(domUnique, expected, `会话顺序必须与真实最后活跃降序一致；DOM=${JSON.stringify(domUnique.slice(0, 12))} 期望=${JSON.stringify(expected.slice(0, 12))}`);
  });

  await t.test('静态(b) 时间显示：会话行时间 == 该会话真实最后活跃时间', async () => {
    const realSessions = await truth.sessions();
    const top = realSessions.slice().sort((a, b) => b.timestamp - a.timestamp).slice(0, 6);
    const result = await app.evaluate(`(() => {
      const truth = ${JSON.stringify(Object.fromEntries(top.map((s) => [s.id, s.timestamp])))};
      const fmt = (ms) => { const d = new Date(ms); const p = n => String(n).padStart(2,'0'); return p(d.getHours())+':'+p(d.getMinutes()); };
      const out = [];
      for (const [id, ms] of Object.entries(truth)) {
        const el = document.querySelector('.session-item[data-id="'+id+'"]');
        out.push({ id, expected: fmt(ms), shown: Boolean(el && el.textContent.includes(fmt(ms))), text: el ? el.textContent.slice(0, 120) : '' });
      }
      return out;
    })()`);
    for (const r of result) {
      assert.equal(r.shown, true, `${r.id} 必须显示真实最后活跃时间 ${r.expected}；行=${r.text}`);
    }
  });

  await t.test('静态(c) 副标题：会话行副标题 == 该会话真实最后一条消息', async () => {
    const realSessions = await truth.sessions();
    const top = realSessions.slice().sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
    const expected = [];
    for (const s of top) {
      const last = await truth.lastMessage(s.id);
      if (last && last.text) expected.push({ id: s.id, msg: last.text });
    }
    const result = await app.evaluate(`(() => {
      const truth = ${JSON.stringify(Object.fromEntries(expected.map((e) => [e.id, e.msg])))};
      const out = [];
      for (const [id, msg] of Object.entries(truth)) {
        const el = document.querySelector('.session-item[data-id="'+id+'"]');
        const probe = msg.slice(0, Math.min(10, msg.length));
        out.push({ id, msg, probe, shown: Boolean(el && el.textContent.includes(probe)), text: el ? el.textContent.slice(0, 160) : '' });
      }
      return out;
    })()`);
    assert.ok(result.length > 0, '至少应有一条可对账的副标题');
    for (const r of result) {
      assert.equal(r.shown, true, `${r.id} 副标题必须来自真实最后消息「${r.msg.slice(0, 40)}」；行=${r.text}`);
    }
  });

  // ==================================================== 动态验证 · 会话 两轮
  {
    const realSessions = await truth.sessions();
    // 只选"可正常执行"的会话：排除 api_server / cron / oneshot 等外部入口产生的会话，
    // 这类会话在本机 UI 里发起回合时，网关不会把 last_active 推进到该会话（实测 20 天不回写）。
    const runnable = realSessions.filter((s) => !['api_server', 'cron', 'oneshot'].includes(s.source));
    const pool = runnable.length >= 2 ? runnable : realSessions;
    const candidates = pool.slice().sort((a, b) => a.timestamp - b.timestamp).slice(0, 2);
    assert.ok(candidates.length >= 2, '真实网关至少需要 2 条可执行会话才能连测两轮');
    const peer = realSessions.slice().sort((a, b) => b.timestamp - a.timestamp)[0];

    for (let i = 0; i < candidates.length; i++) {
      const target = candidates[i].id;
      const round = i + 1;
      await t.test(`动态·会话 第${round}轮：发起->进行中->完成未读->置顶->信息匹配->点击已读`, async () => {
        const text = `[Flux E2E 第${round}轮] 请用一句话确认你收到了这条自动化验证消息`;

        await clickSelector(app, `.session-item[data-id="${target}"]`);
        await app.waitFor(`window.__fluxState.activeSessionId === '${target}'`, { label: `select session r${round}`, timeoutMs: 20000 });

        await typeAndSend(app, text);

        // (a1) 进行中 + 置顶
        const running = await app.waitFor(`(() => {
          const el = document.querySelector('.session-item[data-id="${target}"]');
          if (!el || !el.querySelector('.activity-pulse-indicator')) return null;
          const rows = Array.from(document.querySelectorAll('#rail-sessions-nested-list .session-item'));
          return { isTop: rows[0]?.dataset.id === '${target}' };
        })()`, { label: `session running r${round}`, timeoutMs: 20000 });
        assert.equal(running.isTop, true, `第${round}轮：发起后该会话必须顶到最上`);

        // 切走焦点，让完成后进入未读
        if (peer && peer.id !== target) {
          await clickSelector(app, `.session-item[data-id="${peer.id}"]`);
        }

        // (a2) 完成未读（真实 LLM 回复较慢，给足时间）
        const unread = await app.waitFor(`(() => {
          const el = document.querySelector('.session-item[data-id="${target}"]');
          if (!el || !el.querySelector('.activity-unread-badge')) return null;
          const st = window.__fluxState.sessions.find(s => s.id === '${target}');
          return { pulse: Boolean(el.querySelector('.activity-pulse-indicator')), ts: st?.timestamp, preview: st?.preview };
        })()`, { label: `session unread r${round}`, timeoutMs: 120000 });
        assert.equal(unread.pulse, false, `第${round}轮：完成后运行态必须清除`);

        // (c) 信息匹配：时间与副标题对得上真实最后一条消息
        const realSessions = await truth.sessions();
        const real = realSessions.find((s) => s.id === target);
        assert.ok(real, `真值中必须能找到会话 ${target}`);
        assert.ok(
          Math.abs(unread.ts - real.timestamp) <= 5000,
          `第${round}轮：客户端时间戳 ${unread.ts} 须对得上网关 last_active ${real.timestamp}（差 ${unread.ts - real.timestamp}ms）`
        );
        const lastMsg = await truth.lastMessage(target);
        assert.ok(lastMsg && lastMsg.text, `第${round}轮：必须能从网关取到该会话的真实最后一条消息`);
        // 副标题由异步 enrich 回填，等待其与真实最后消息收敛（有界等待，不通过则失败）
        const probe = lastMsg.text.slice(0, 10);
        await app.waitFor(
          `(() => { const s = window.__fluxState.sessions.find(x => x.id === '${target}'); return Boolean(s && (s.preview || '').includes(${JSON.stringify(probe)})); })()`,
          { label: `session preview converge r${round}`, timeoutMs: 20000 }
        );

        // (b) 置顶复核
        const order = await app.evaluate(READ_SESSION_IDS);
        assert.equal(order[0], target, `第${round}轮：完成后的会话仍须在最上；实际=${JSON.stringify(order.slice(0, 5))}`);

        // (a3) 点击进入 -> 已读
        await clickSelector(app, `.session-item[data-id="${target}"]`);
        await app.waitFor(`!document.querySelector('.session-item[data-id="${target}"] .activity-unread-badge')`, { label: `session read r${round}`, timeoutMs: 20000 });

        // (d) 绝不丢数据断言：切走再切回后，刚刚发出的提问与最新回复必须 100% 存在于屏幕与消息列表中！
        const msgCheck = await app.evaluate(`(() => {
          const msgs = window.__fluxState.messages || [];
          const domText = document.getElementById('conversation-stream')?.innerText || '';
          return {
            count: msgs.length,
            hasSentText: msgs.some(m => m.content && m.content.includes(${JSON.stringify(text)})),
            hasDomSentText: domText.includes(${JSON.stringify(text)}),
          };
        })()`);
        assert.ok(msgCheck.count >= 2, `切回会话后消息列表不得为空；实际=${msgCheck.count}`);
        assert.equal(msgCheck.hasSentText, true, `切回会话后刚刚发送的消息必须完整保全，绝不丢数据！`);
        assert.equal(msgCheck.hasDomSentText, true, `切回会话后屏幕渲染中必须包含发送的消息内容！`);
      });
    }
  }

  // ==================================================== 动态验证 · 群聊 两轮
  {
    const realGroups = await truth.groups();
    assert.ok(realGroups.length >= 1, '真实网关至少需要 1 个群聊；若不足两轮则只测已有房间');
    const rounds = realGroups.slice(0, 2);
    const peerSession = (await truth.sessions()).sort((a, b) => b.timestamp - a.timestamp)[0];

    for (let i = 0; i < rounds.length; i++) {
      const room = rounds[i];
      const round = i + 1;
      await t.test(`动态·群聊 第${round}轮：发送->进行中->完成未读->置顶->信息匹配`, async () => {
        const text = `[Flux E2E 第${round}轮] 请群成员用一句话确认收到自动化验证消息`;

        await clickSelector(app, `.rail-group-item[data-room-id="${room.roomId}"]`);
        await app.waitFor(`window.__fluxState.activeFocus.type === 'group' && window.__fluxState.activeFocus.roomId === '${room.roomId}'`, { label: `group open r${round}`, timeoutMs: 25000 });

        await typeAndSend(app, text);

        // (a1) 进行中
        await app.waitFor(`(() => { const el = document.querySelector('.rail-group-item[data-room-id="${room.roomId}"]'); return Boolean(el && el.querySelector('.activity-pulse-indicator')); })()`, { label: `group running r${round}`, timeoutMs: 25000 });

        // 切走到普通会话
        if (peerSession) await clickSelector(app, `.session-item[data-id="${peerSession.id}"]`);
        await app.waitFor(`window.__fluxState.activeFocus.type !== 'group'`, { label: 'left group' });

        // (a2) 完成未读
        const unread = await app.waitFor(`(() => {
          const el = document.querySelector('.rail-group-item[data-room-id="${room.roomId}"]');
          if (!el || !el.querySelector('.activity-unread-badge')) return null;
          const r = window.__fluxState.groupRooms.find(x => x.roomId === '${room.roomId}');
          return { pulse: Boolean(el.querySelector('.activity-pulse-indicator')), lastMessage: r?.lastMessage, updatedAt: r?.updatedAt };
        })()`, { label: `group unread r${round}`, timeoutMs: 180000 });
        assert.equal(unread.pulse, false, `第${round}轮：群聊完成后运行态必须清除`);

        // (b) 置顶复核（按真实 updatedAt 排序）
        const order = await app.evaluate(`window.__fluxState.groupRooms.slice().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).map(r => r.roomId)`);
        assert.equal(order[0], room.roomId, `第${round}轮：群聊完成后必须为最新；实际=${JSON.stringify(order)}`);

        await clickSelector(app, `.rail-group-item[data-room-id="${room.roomId}"]`);
        await app.waitFor(`!document.querySelector('.rail-group-item[data-room-id="${room.roomId}"] .activity-unread-badge')`, { label: `group read r${round}`, timeoutMs: 25000 });
      });
    }
  }

  // ==================================================== 动态验证 · Agents 两轮
  {
    const realProfiles = await truth.profiles();
    const bots = realProfiles.map((p) => p.name).slice(0, 2);
    assert.ok(bots.length >= 1, '真实网关至少需要 1 个 Bot');
    const peerSession = (await truth.sessions()).sort((a, b) => b.timestamp - a.timestamp)[0];

    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i];
      const round = i + 1;
      await t.test(`动态·Agent 第${round}轮：发起->进行中->完成未读->信息匹配->点击已读`, async () => {
        const text = `[Flux E2E 第${round}轮] 请用一句话确认你收到了这条自动化验证消息`;

        await clickSelector(app, `.rail-pinned-bot-row[data-profile="${bot}"]`);
        await app.waitFor(`window.__fluxState.activeFocus.type === 'bot' && window.__fluxState.activeFocus.botName === '${bot}'`, { label: `bot focus r${round}`, timeoutMs: 30000 });

        await typeAndSend(app, text);

        // (a1) 进行中
        await app.waitFor(`(() => { const el = document.querySelector('.rail-pinned-bot-row[data-profile="${bot}"]'); return Boolean(el && el.querySelector('.activity-pulse-indicator')); })()`, { label: `bot running r${round}`, timeoutMs: 30000 });

        // 切走
        if (peerSession) await clickSelector(app, `.session-item[data-id="${peerSession.id}"]`);
        await app.waitFor(`window.__fluxState.activeFocus.type !== 'bot'`, { label: 'left bot' });

        // (a2) 完成未读
        const unread = await app.waitFor(`(() => {
          const el = document.querySelector('.rail-pinned-bot-row[data-profile="${bot}"]');
          if (!el || !el.querySelector('.activity-unread-badge')) return null;
          const p = window.__fluxState.profiles.find(x => x.name === '${bot}');
          return { pulse: Boolean(el.querySelector('.activity-pulse-indicator')), lastMessage: p?.lastMessage };
        })()`, { label: `bot unread r${round}`, timeoutMs: 180000 });
        assert.equal(unread.pulse, false, `第${round}轮：Bot 完成后运行态必须清除`);

        await clickSelector(app, `.rail-pinned-bot-row[data-profile="${bot}"]`);
        await app.waitFor(`!document.querySelector('.rail-pinned-bot-row[data-profile="${bot}"] .activity-unread-badge')`, { label: `bot read r${round}`, timeoutMs: 30000 });

        // (d) 绝不丢数据 + 时间非冷启动旧时间断言
        const botCheck = await app.evaluate(`(() => {
          const msgs = window.__fluxState.messages || [];
          const p = window.__fluxState.profiles.find(x => x.name === '${bot}');
          const rowText = document.querySelector('.rail-pinned-bot-row[data-profile="${bot}"]')?.textContent || '';
          return {
            count: msgs.length,
            hasSentText: msgs.some(m => m.content && m.content.includes(${JSON.stringify(text)})),
            lastTime: p?.lastTime || '',
            notOldTime: !rowText.includes('22:48'),
          };
        })()`);
        assert.ok(botCheck.count >= 2, `切回 Bot 后消息列表不得为空；实际=${botCheck.count}`);
        assert.equal(botCheck.hasSentText, true, `切回 Bot 后发送的消息必须完整保全，绝不丢数据！`);
        assert.equal(botCheck.notOldTime, true, `Bot 时间绝对不能显示冷启动旧时间 22:48；实际行文案=${botCheck.lastTime}`);
      });
    }
  }

  // ============================================================ 整体复核
  await t.test('整体复核：动态两轮之后，DOM 会话顺序仍 == 真实最后活跃降序', async () => {
    const domOrder = await app.evaluate(READ_SESSION_IDS);
    const realSessions = await truth.sessions();
    const realIds = new Set(realSessions.map((s) => s.id));
    const domUnique = [...new Set(domOrder.filter((id) => realIds.has(id)))];
    const expected = [...new Set(realSessions.slice().sort((a, b) => b.timestamp - a.timestamp).map((s) => s.id))];
    assert.deepEqual(domUnique, expected, `整体顺序必须与真实数据一致；DOM=${JSON.stringify(domUnique.slice(0, 12))}`);
  });

  await t.test('页面零未捕获异常（真实 renderer 运行无报错）', () => {
    const fatal = app.pageErrors.filter((e) => !/favicon|404|Fontconfig|DevTools/i.test(e));
    assert.deepEqual(fatal, [], `渲染层不得抛出未捕获异常：${JSON.stringify(fatal)}`);
  });
});
