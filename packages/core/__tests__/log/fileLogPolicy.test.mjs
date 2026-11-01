import test from 'node:test';
import assert from 'node:assert/strict';
import {
  logDayStamp,
  logFileName,
  isLogFileName,
  shouldPruneLog,
  isLogFileFull,
  isQueueFull,
  LOG_FILE_MAX_BYTES,
  LOG_RETENTION_DAYS,
  LOG_MAX_QUEUE,
} from '../../dist/log/fileLogPolicy.js';

/**
 * 日志落盘策略测试
 *
 * 设计意图 (Why):
 *   用户现场出问题时只有日志文件这一条证据链。命名、保留、上限、队列
 *   任何一处算错，都会导致"日志在但找不到"或"磁盘被写爆"。
 */

test('日志落盘策略', async (t) => {
  await t.test('1. 文件名按本地日期生成且格式可被清理器识别', () => {
    const date = new Date(2026, 9, 31, 23, 59, 59); // 2026-10-31 本地时间
    assert.equal(logDayStamp(date), '2026-10-31');
    assert.equal(logFileName(date), 'flux-2026-10-31.log');
    assert.equal(isLogFileName('flux-2026-10-31.log'), true);
  });

  await t.test('2. 清理器只认日志文件，绝不误删其他文件', () => {
    assert.equal(isLogFileName('flux-2026-10-31.log'), true);
    assert.equal(isLogFileName('hermes.db'), false);
    assert.equal(isLogFileName('flux-2026-10-31.log.bak'), false);
    assert.equal(isLogFileName('flux-2026-1-1.log'), false, '必须严格两位月日');
  });

  await t.test('3. 保留期边界：第 7 天保留，第 8 天清理', () => {
    const now = Date.UTC(2026, 9, 31, 12, 0, 0);
    const dayMs = 24 * 60 * 60 * 1000;

    assert.equal(shouldPruneLog(now - 6 * dayMs, now), false, '6 天前必须保留');
    assert.equal(shouldPruneLog(now - (LOG_RETENTION_DAYS - 1) * dayMs, now), false, '第 7 天边界必须保留');
    assert.equal(shouldPruneLog(now - (LOG_RETENTION_DAYS + 1) * dayMs, now), true, '超过保留期必须清理');
  });

  await t.test('4. 单文件大小上限：恰好等于上限仍可写，超过即停写', () => {
    assert.equal(isLogFileFull(0), false);
    assert.equal(isLogFileFull(LOG_FILE_MAX_BYTES), false, '等于上限时仍允许写入');
    assert.equal(isLogFileFull(LOG_FILE_MAX_BYTES + 1), true, '超过上限必须停止写入');
  });

  await t.test('5. 队列上限：达到上限后丢弃新日志，避免内存被打日志吃光', () => {
    assert.equal(isQueueFull(0), false);
    assert.equal(isQueueFull(LOG_MAX_QUEUE - 1), false);
    assert.equal(isQueueFull(LOG_MAX_QUEUE), true, '队列满时必须开始丢弃');
    assert.equal(isQueueFull(LOG_MAX_QUEUE + 100), true);
  });
});
