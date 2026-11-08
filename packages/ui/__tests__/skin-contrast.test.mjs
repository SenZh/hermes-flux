/**
 * 皮肤对比度不变量（WCAG AA）。
 *
 * 【为什么需要】`--primary-foreground` 曾从 `--accent-text`（链接强调色文字）错误提取，
 *   导致 warm-paper / ayu-light / cyber-matrix 三套皮肤的主动作按钮文字与底色对比度
 *   只有 1.15 ~ 1.43:1——按钮上的字几乎看不见。这类缺陷不会让任何类型检查或快照测试
 *   变红，只能靠对比度算术直接钉住。
 *
 * 【口径】前景色对 `--primary` 底色的对比度必须 ≥ 4.5:1（WCAG AA 正文标准）。
 *   实际值最低为 5.17（warm-paper），一旦有人把某个皮肤的按钮文字改回强调色，这里立刻变红。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

function luminance(hex) {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw;
  const channels = [0, 2, 4]
    .map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('每套皮肤的主按钮文字对比度必须达到 WCAG AA（>= 4.5:1）', async () => {
  const { SKINS } = await import('../dist/tokens/skins.js');
  const ids = Object.keys(SKINS);
  assert.ok(ids.length >= 5, `皮肤数量异常：${ids.length}，循环断言会退化为恒真`);
  for (const [id, skin] of Object.entries(SKINS)) {
    const foreground = skin.slots['--primary-foreground'];
    const background = skin.slots['--primary'];
    const ratio = contrast(foreground, background);
    assert.ok(
      ratio >= 4.5,
      `皮肤 ${id} 的主按钮文字对比度仅 ${ratio.toFixed(2)}:1（fg ${foreground} on ${background}），低于 WCAG AA 4.5:1`,
    );
  }
});

test('次要文字对所有表面（含左轨 sidebar 与 secondary/input）都必须可读', async () => {
  const { SKINS } = await import('../dist/tokens/skins.js');
  const surfaces = ['--background', '--card', '--panel', '--sidebar', '--secondary', '--input', '--card-hover', '--card-active'];
  for (const [id, skin] of Object.entries(SKINS)) {
    const muted = skin.slots['--muted-foreground'];
    for (const surface of surfaces) {
      const ratio = contrast(muted, skin.slots[surface]);
      assert.ok(
        ratio >= 4.5,
        `皮肤 ${id} 的 --muted-foreground ${muted} 在 ${surface} ${skin.slots[surface]} 上仅 ${ratio.toFixed(2)}:1`,
      );
    }
  }
});

test('主按钮文字色不得与强调色文字复用同一取值', async () => {
  const { SKINS } = await import('../dist/tokens/skins.js');
  for (const [id, skin] of Object.entries(SKINS)) {
    assert.notEqual(
      skin.slots['--primary-foreground'],
      skin.slots['--primary-dim'],
      `皮肤 ${id} 的 --primary-foreground 与 --primary-dim 同值，说明按钮文字色又被当成强调色文字用了`,
    );
  }
});
