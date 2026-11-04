/**
 * 行内时间格式化定理（PR-3d 增量，判定树分支 A）。
 *
 * 设计意图 (Why)：时间格式化器是主工位卡/会话行/群聊行共享的展示真值源，
 *   renderer 与 core botActivitySync 的 formatTime 注入全部委托 ui 的 formatLeftRailTime。
 *   输出规格一旦被改坏（分桶错乱、非确定、空串复活），三处同屏时间会互相矛盾。
 * 防范的历史坑 (Pitfall)：两份格式化器漂移导致"昨天 23:30"长格式撑宽时间列挤掉标题
 *   （2026-11-04 用户实测），收敛为单源后必须以定理钉死分桶。
 * 约束与规则 (Rules)：随机 now 与随机时间戳在数万组交错下必须满足全部定理；
 *   修改 leftRailModel.formatLeftRailTime 输出规格必须同步修订本套件，禁止缩小生成空间迎合。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 相对本文件定位 ui 产物，不依赖 cwd（与既有 formal 套件同规）；Windows 下必须走 file:// URL
const UI_MODEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../ui/dist/components-react/leftRailModel.js');
const { formatLeftRailTime } = await import(pathToFileURL(UI_MODEL).href);

const arbNow = fc.date({ min: new Date(2020, 0, 3), max: new Date(2030, 11, 28) }).filter((d) => Number.isFinite(d.getTime()));
const arbDayOffset = fc.integer({ min: 0, max: 400 });
const arbTimeOfDay = fc.record({ h: fc.integer({ min: 0, max: 23 }), m: fc.integer({ min: 0, max: 59 }) });

test('定理 18 [时间格式化确定性]: 同一 (timestamp, now) 任意重复调用输出恒等', async () => {
  await fc.assert(
    fc.property(arbNow, arbDayOffset, arbTimeOfDay, (now, dayOffset, tod) => {
      const ts = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOffset, tod.h, tod.m).getTime();
      const a = formatLeftRailTime(ts, now);
      const b = formatLeftRailTime(ts, now);
      assert.equal(a, b, '格式化必须为纯函数');
    }),
    { numRuns: 1200 },
  );
});

test('定理 19 [合法分桶封闭性]: 输出只能落在五类规格之一，且正时间戳永不为空', async () => {
  const HOUR_MIN = /^\d{2}:\d{2}$/;
  const MD = /^\d{1,2}\/\d{1,2}$/;
  const YMD = /^\d{4}\/\d{1,2}\/\d{1,2}$/;
  await fc.assert(
    fc.property(arbNow, arbDayOffset, arbTimeOfDay, (now, dayOffset, tod) => {
      const ts = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOffset, tod.h, tod.m).getTime();
      const out = formatLeftRailTime(ts, now);
      assert.ok(out.length > 0, '正时间戳不得返回空串');
      assert.ok(out.length <= 10, `输出宽度必须有硬上界（防时间列再次撑爆）: "${out}"`);
      assert.ok(HOUR_MIN.test(out) || MD.test(out) || YMD.test(out) || out === '昨天' || out === '前天' || out === 'Yesterday' || out === '2d ago',
        `非法分桶输出: "${out}"`);
    }),
    { numRuns: 2000 },
  );
});

test('定理 20 [日距分桶单调性]: 相对 now 的日偏移唯一决定分桶，未来时刻不得落入昨前桶', async () => {
  await fc.assert(
    fc.property(arbNow, arbDayOffset, arbTimeOfDay, (now, dayOffset, tod) => {
      // 必须用日历算术构造"第 N 天前"：固定 86400000ms 步长在 DST 切换日与日历天脱节（美国/欧洲时区实证误红）
      const ts = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOffset, tod.h, tod.m).getTime();
      const out = formatLeftRailTime(ts, now);
      const sameYear = new Date(ts).getFullYear() === now.getFullYear();
      if (dayOffset === 0) assert.match(out, /^\d{2}:\d{2}$/, '当日必须 HH:mm');
      else if (dayOffset === 1 && sameYear) assert.ok(out === '昨天' || out === 'Yesterday', `偏移1必须落昨天桶: "${out}"`);
      else if (dayOffset === 2 && sameYear) assert.ok(out === '前天' || out === '2d ago', `偏移2必须落前天桶: "${out}"`);
      else if (sameYear) assert.match(out, /^\d{1,2}\/\d{1,2}$/, `同年更早必须 M/D: "${out}"`);
      else assert.match(out, /^\d{4}\/\d{1,2}\/\d{1,2}$/, `跨年必须 YYYY/M/D: "${out}"`);
    }),
    { numRuns: 2000 },
  );
});

test('定理 21 [非法输入安全降级]: 0/负数/NaN/undefined 一律空串，绝不抛错也不复活旧值', async () => {
  await fc.assert(
    fc.property(fc.oneof(fc.constant(0), fc.constant(undefined), fc.constant(Number.NaN), fc.integer({ min: -1e12, max: -1 })), (v) => {
      assert.equal(formatLeftRailTime(v, new Date()), '');
    }),
    { numRuns: 200 },
  );
  // 非法 now 同样必须空串：宁可无时间也不显示错误的相对日
  assert.equal(formatLeftRailTime(Date.now(), new Date(NaN)), '');
});
