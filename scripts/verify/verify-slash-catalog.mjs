/**
 * 用网关真实数据验证斜杠补全：不截断 + 说明本地化。
 *
 * 走真实投影函数（toSlashOptions）与真实渲染，断言用户能观察到的结果。
 */
import path from 'node:path';
import fs from 'node:fs';
import { createDriveSession } from './control-flux.mjs';

const OUT = path.resolve('artifacts/verification/dock-three-defects');
fs.mkdirSync(OUT, { recursive: true });

const catalog = JSON.parse(
  fs.readFileSync('C:/Users/470785/AppData/Local/Temp/opencode/catalog.json', 'utf8'),
);

const rootItems = catalog.slash['/']?.items || [];
const replaceFrom = catalog.slash['/']?.replace_from ?? 0;

const session = await createDriveSession({ entry: '/packages/desktop/dist/renderer/index.html' });

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};

try {
  await session.waitFor(`Boolean(window.__fluxState && window.__fluxRender)`, 25000, 'app');
  await session.evaluate(`(() => {
    const s = window.__fluxState;
    s.gatewayConnected = true;
    s.gatewayConnecting = false;
    s.activeSessionId = 'sess-live';
    s.activeFocus = { type: 'session', sessionId: 'sess-live' };
    window.__fluxRender();
    return true;
  })()`);
  await session.waitFor(`Boolean(document.getElementById('dock-prompt-input'))`, 10000, 'dock');

  // 走真实投影：与 index.ts 的 requestSlashCompletion 同一函数、同一 t()
  const projected = await session.evaluate(`(async () => {
    const mod = await import('/packages/desktop/dist/renderer/slashCatalog.mjs');
    const i18n = await import('/packages/ui/dist/i18n/index.js');
    const raw = ${JSON.stringify(rootItems)};
    return mod.toSlashOptions(raw, ${replaceFrom}, i18n.t);
  })()`);

  check('投影条数等于网关返回条数', projected.length === rootItems.length, {
    projected: projected.length,
    gateway: rootItems.length,
  });

  const zhRows = projected.filter((it) => /[\u4e00-\u9fa5]/.test(it.description));
  const fallbackRows = projected.filter((it) => it.description && !/[\u4e00-\u9fa5]/.test(it.description));
  check('内置命令说明已本地化为中文', zhRows.length > 0, {
    zh: zhRows.length,
    sample: zhRows.slice(0, 3).map((r) => `${r.name} → ${r.description}`),
  });
  check('插件技能回退网关原文（未编造）', fallbackRows.length > 0, {
    fallback: fallbackRows.length,
    sample: fallbackRows.slice(0, 2).map((r) => `${r.name} → ${r.description.slice(0, 40)}`),
  });

  // 真实渲染
  await session.evaluate(`(() => {
    window.__fluxState.slashItems = ${JSON.stringify(projected)};
    window.__fluxState.slashPopperOpen = true;
    window.__fluxRender();
    return true;
  })()`);
  const rendered = await session.evaluate(`(() => {
    const rows = document.querySelectorAll('.slash-item-option');
    const list = document.querySelector('.composer-slash-popper .composer-popper__list');
    return {
      rows: rows.length,
      overflowY: list ? getComputedStyle(list).overflowY : null,
      maxHeight: list ? getComputedStyle(list).maxHeight : null,
    };
  })()`);
  check('渲染行数等于投影条数', rendered.rows === projected.length, rendered);
  check('列表超长走滚动', rendered.overflowY === 'auto', rendered);

  const shot = await session.sendCommand('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'slash-localized.png'), Buffer.from(shot.data, 'base64'));

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  if (failures > 0) process.exitCode = 1;
} finally {
  await session.cleanup();
}
