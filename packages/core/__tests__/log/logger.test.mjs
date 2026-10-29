import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLogger,
  setLogLevel,
  getLogLevel,
  isLogLevelEnabled,
  parseLogLevel,
} from '../../dist/log/logger.js';

/**
 * Replaces the three console channels for the duration of a test and returns
 * everything that was written. Only the physical sink is swapped; the logger
 * itself runs its real production code path.
 */
function captureConsole(t) {
  const calls = [];
  const originals = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  console.debug = (...args) => calls.push({ channel: 'debug', args });
  console.info = (...args) => calls.push({ channel: 'info', args });
  console.warn = (...args) => calls.push({ channel: 'warn', args });
  console.error = (...args) => calls.push({ channel: 'error', args });

  t.after(() => {
    console.debug = originals.debug;
    console.info = originals.info;
    console.warn = originals.warn;
    console.error = originals.error;
  });

  return calls;
}

test('Leveled logger contract', async (t) => {
  await t.test('parseLogLevel accepts known levels and falls back on junk', () => {
    assert.equal(parseLogLevel('DEBUG'), 'debug', 'Case must be normalized');
    assert.equal(parseLogLevel('  trace  '), 'trace', 'Surrounding spaces must be trimmed');
    assert.equal(parseLogLevel('silent'), 'silent');
    assert.equal(parseLogLevel('verbose', 'info'), 'info', 'Unknown level uses the fallback');
    assert.equal(parseLogLevel(undefined, 'warn'), 'warn', 'Non-string uses the fallback');
    assert.equal(parseLogLevel('debug', 'info'), 'debug', 'Explicit fallback must not override a valid level');
  });

  await t.test('Threshold gates lower-priority levels', () => {
    const previous = getLogLevel();
    t.after(() => setLogLevel(previous));

    setLogLevel('warn');
    assert.equal(isLogLevelEnabled('error'), true, 'error is above warn');
    assert.equal(isLogLevelEnabled('warn'), true, 'warn equals the threshold');
    assert.equal(isLogLevelEnabled('info'), false, 'info is below warn');
    assert.equal(isLogLevelEnabled('debug'), false, 'debug is below warn');
  });

  await t.test('silent suppresses every channel', (tt) => {
    const calls = captureConsole(tt);
    const previous = getLogLevel();
    tt.after(() => setLogLevel(previous));

    setLogLevel('silent');
    const log = createLogger('t-silent');
    log.error('boom');
    log.warn('careful');
    log.info('hello');
    log.debug('detail');
    log.trace('granular');

    assert.equal(calls.length, 0, `silent must emit nothing, got ${calls.length} call(s)`);
  });

  await t.test('debug level emits tagged messages and keeps the payload', (tt) => {
    const calls = captureConsole(tt);
    const previous = getLogLevel();
    tt.after(() => setLogLevel(previous));

    setLogLevel('debug');
    const log = createLogger('session');
    log.debug('session loaded', { rpcMs: 42 });

    assert.equal(calls.length, 1, 'one debug call expected');
    assert.equal(calls[0].channel, 'debug', 'debug must go to console.debug');
    assert.equal(calls[0].args[0], '[Flux:session] session loaded', 'prefix must carry scope and message');
    assert.deepEqual(calls[0].args[1], { rpcMs: 42 }, 'payload must be forwarded untouched');
  });

  await t.test('error uses the error channel, warn uses the warn channel', (tt) => {
    const calls = captureConsole(tt);
    const previous = getLogLevel();
    tt.after(() => setLogLevel(previous));

    setLogLevel('info');
    const log = createLogger('net');
    log.error('socket closed');
    log.warn('retrying');

    assert.equal(calls.length, 2, 'error and warn both pass an info threshold');
    assert.equal(calls[0].channel, 'error', 'error must route to console.error');
    assert.equal(calls[1].channel, 'warn', 'warn must route to console.warn');
  });

  await t.test('info uses the info channel so DevTools shows it by default', (tt) => {
    const calls = captureConsole(tt);
    const previous = getLogLevel();
    tt.after(() => setLogLevel(previous));

    setLogLevel('info');
    const log = createLogger('session');
    log.info('session loaded', { rpcMs: 12 });

    assert.equal(calls.length, 1, 'info is visible at the info threshold');
    assert.equal(calls[0].channel, 'info', 'info must not be hidden behind DevTools "Verbose"');
    assert.equal(calls[0].args[0], '[Flux:session] session loaded');
  });

  await t.test('messages below the threshold never reach the console', (tt) => {
    const calls = captureConsole(tt);
    const previous = getLogLevel();
    tt.after(() => setLogLevel(previous));

    setLogLevel('info');
    const log = createLogger('quiet');
    log.debug('hidden');
    log.trace('hidden too');

    assert.equal(calls.length, 0, 'debug/trace must be dropped at info level');
  });

  await t.test('time() reports a non-negative elapsed value and logs the label', (tt) => {
    const calls = captureConsole(tt);
    const previous = getLogLevel();
    tt.after(() => setLogLevel(previous));

    setLogLevel('debug');
    const log = createLogger('timing');
    const done = log.time('session.resume');

    let spin = 0;
    for (let i = 0; i < 20000; i += 1) spin += i;

    const elapsed = done({ messages: 100 });

    assert.equal(typeof elapsed, 'number', 'time() must return the elapsed milliseconds');
    assert.ok(elapsed >= 0, `elapsed must be non-negative, got ${elapsed}`);
    assert.equal(calls.length, 1, 'timer completion is one log line');
    assert.ok(
      calls[0].args[0].startsWith('[Flux:timing] session.resume took '),
      `timer line must name the label, got "${calls[0].args[0]}"`
    );
    assert.deepEqual(calls[0].args[1], { messages: 100 }, 'timer payload must be forwarded');
  });

  await t.test('time() stays silent when the level hides debug', (tt) => {
    const calls = captureConsole(tt);
    const previous = getLogLevel();
    tt.after(() => setLogLevel(previous));

    setLogLevel('info');
    const log = createLogger('timing');
    const elapsed = log.time('render')();

    assert.equal(typeof elapsed, 'number', 'timing must still measure when logging is off');
    assert.equal(calls.length, 0, 'no console output at info level');
  });
});
