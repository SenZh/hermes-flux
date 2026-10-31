/**
 * HermesGatewayClient 移动端与跨端生命周期、心跳看门狗与候选地址单元测试
 *
 * 覆盖四大象限：
 * 1. 正向主路径 (Happy Path)：心跳正常触发 system.ping、候选池正确获取与轮换
 * 2. 极限与边界 (Boundary Limits)：禁用心跳/生命周期选项、disconnect 彻底清理定时器
 * 3. 负向与混沌 (Negative & Chaos)：心跳未响应触发超时看门狗主动斩断死连接、前台唤醒短路
 * 4. 竞态与时序 (Concurrency & Order)：visibilitychange 与 online 触发即刻唤醒重连与退避重置
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesGatewayClient } from '../../dist/rpc/client.js';

test('HermesGatewayClient Lifecycle, Heartbeat & Failover Suite', async (t) => {
  await t.test('1. 正向主路径：连接成功后周期性启动心跳并发送 system.ping', async () => {
    // 1. Arrange: 准备 50ms 心跳周期的受控客户端
    const sentFrames = [];
    let closeCalled = false;
    const mockWs = {
      readyState: 1, // OPEN
      send(data) {
        const frame = JSON.parse(data);
        sentFrames.push(frame);
        if (frame.method === 'system.ping' && frame.id) {
          // 模拟网关秒级应答 pong，消除 RPC 挂起定时器
          setTimeout(() => {
            client['handleMessage'](
              JSON.stringify({
                jsonrpc: '2.0',
                id: frame.id,
                result: { pong: true, timestamp: Date.now() },
              })
            );
          }, 0);
        }
      },
      close() {
        closeCalled = true;
      },
    };

    const client = new HermesGatewayClient({
      url: 'ws://127.0.0.1:9119/api/ws',
      enableHeartbeat: true,
      heartbeatIntervalMs: 40,
      heartbeatTimeoutMs: 150,
      enableLifecycleWake: false,
    });

    client['ws'] = mockWs;
    client['fsm'].transitionTo('CONNECTED');

    // 2. Act: 触发 startHeartbeat 并推进时钟
    client['startHeartbeat']();

    // 等待两次心跳周期
    await new Promise((r) => setTimeout(r, 95));

    // 3. Assert: 断言至少产生了一次心跳 ping 帧且未异常关闭连接
    const pingFrames = sentFrames.filter((f) => f.method === 'system.ping');
    assert.ok(pingFrames.length >= 1, `应至少发出 1 次心跳 ping 帧，实际: ${pingFrames.length}`);
    assert.equal(closeCalled, false, '正常心跳周期内不应主动关闭连接');

    // 清理
    client.disconnect();
  });

  await t.test('2. 负向混沌：心跳超时未收到应答，看门狗必须主动 close 斩断半开死连接', async () => {
    // 1. Arrange: 配置极短心跳与超时 (20ms 间隔，30ms 超时)
    let closeCalledTimes = 0;
    const mockWs = {
      readyState: 1,
      send() {
        // 故意不响应任何 ping，模拟网络单向半开
      },
      close() {
        closeCalledTimes++;
      },
    };

    const client = new HermesGatewayClient({
      url: 'ws://127.0.0.1:9119/api/ws',
      enableHeartbeat: true,
      heartbeatIntervalMs: 20,
      heartbeatTimeoutMs: 30,
      enableLifecycleWake: false,
    });

    client['ws'] = mockWs;
    client['fsm'].transitionTo('CONNECTED');

    // 2. Act: 启动看门狗并等待心跳超时
    client['startHeartbeat']();
    await new Promise((r) => setTimeout(r, 70));

    // 3. Assert: 验证主动斩断连接
    assert.ok(closeCalledTimes >= 1, '心跳超时后看门狗必须主动调用 ws.close() 销毁死连接');

    client.disconnect();
  });

  await t.test('3. 边界值：候选地址池正确识别、轮换与单一地址兜底', () => {
    // 1. Arrange: 包含 LAN 直连与 Relay 中继的双候选池
    const client = new HermesGatewayClient({
      url: 'ws://192.168.1.50:9119/api/ws',
      candidateUrls: ['ws://192.168.1.50:9119/api/ws', 'wss://relay.hermes.ai/session/42'],
      enableLifecycleWake: false,
    });

    // 2. Assert: 初始地址应为第一候选
    assert.equal(client.getActiveUrl(), 'ws://192.168.1.50:9119/api/ws');
    assert.equal(client.getCandidateUrls().length, 2);

    // 3. Act: 触发第一次轮换
    const second = client.rotateCandidate();
    assert.equal(second, 'wss://relay.hermes.ai/session/42', '应轮换到 Relay 中继候选');
    assert.equal(client.getActiveUrl(), 'wss://relay.hermes.ai/session/42');

    // 4. Act: 再次轮换应循环回 LAN 直连
    const looped = client.rotateCandidate();
    assert.equal(looped, 'ws://192.168.1.50:9119/api/ws', '应循环回首选地址');

    // 单一候选不发生改变
    const singleClient = new HermesGatewayClient({
      url: 'ws://127.0.0.1:9119/api/ws',
      enableLifecycleWake: false,
    });
    assert.equal(singleClient.rotateCandidate(), 'ws://127.0.0.1:9119/api/ws');

    client.disconnect();
    singleClient.disconnect();
  });

  await t.test('4. 时序与自愈：前台唤醒与 online 事件必须重置退避并立即重连', async () => {
    // 1. Arrange: 模拟全局 DOM 事件与退避状态
    let connectCalls = 0;
    const client = new HermesGatewayClient({
      url: 'ws://127.0.0.1:9119/api/ws',
      enableLifecycleWake: false, // 手动测试唤醒方法
    });

    // 劫持 connect 验证调用次数
    client.connect = () => {
      connectCalls++;
    };

    // 模拟经过多次失败后退避计数累积到 5
    client['fsm'].transitionTo('RECONNECTING');
    client['fsm']['attemptCount'] = 5;
    assert.equal(client['fsm']['attemptCount'], 5);

    // 2. Act: 模拟从后台回到前台或网络恢复，触发即刻唤醒
    client.wakeImmediately('visibilitychange:visible');

    // 3. Assert: 退避计数必须被清零，且必须即刻触发 connect()
    assert.equal(client['fsm']['attemptCount'], 0, '唤醒后退避累积计数必须被重置为 0');
    assert.equal(connectCalls, 1, '必须立即触发 1 次 connect 重连');

    // 4. Act: 若当前已经处于 CONNECTED 状态，唤醒应安全短路
    client['fsm'].transitionTo('CONNECTED');
    client.wakeImmediately('duplicate:test');
    assert.equal(connectCalls, 1, '已连接状态下唤醒不应重复触发 connect');

    client.disconnect();
  });

  await t.test('5. 资源回收：disconnect 彻底清理心跳定时器、重连定时器与监听器', () => {
    // 1. Arrange
    const client = new HermesGatewayClient({
      url: 'ws://127.0.0.1:9119/api/ws',
      enableHeartbeat: true,
      heartbeatIntervalMs: 1000,
      heartbeatTimeoutMs: 500,
      enableLifecycleWake: false,
    });

    client['fsm'].transitionTo('CONNECTED');
    client['startHeartbeat']();
    assert.ok(client['heartbeatTimer'], '心跳定时器应已启动');

    // 2. Act: 执行彻底断开
    client.disconnect();

    // 3. Assert: 所有计时器与引用全部归零
    assert.equal(client['heartbeatTimer'], null, '心跳定时器必须被清除置 null');
    assert.equal(client['heartbeatTimeoutHandle'], null, '心跳超时句柄必须被清除置 null');
    assert.equal(client['reconnectTimer'], null, '重连定时器必须被清除置 null');
    assert.equal(client.getState(), 'DISCONNECTED');
  });
});
