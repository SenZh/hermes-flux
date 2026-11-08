# Hermes Flux 客户端通用配置与多网关无感连接架构设计规范 (Client Settings & Multi-Gateway Cache Spec)

本文档确立了客户端通用可扩展配置系统、多网关注册表持久化、冷启动静默连接以及离线可用性治理的技术实施基线。

---

## 零、 核心背景与治理目标

客户端目前仅具备基础的会话与消息离线缓存。在配置与网络连接层面存在以下具体缺陷：
1. 配置碎片化。界面字体、主题、网关地址与凭据以散乱的键名平铺在 `localStorage` 中。缺乏版本信封与类型校验。
2. 单网关限制。当前客户端仅记录单个网关 URL。无法满足开发者在本地开发网关、内网服务器以及云端生产节点之间灵活切换的需求。
3. 凭据安全性不足。历史逻辑将密码以明文形式直接写入前端存储。
4. 离线交互倒挂。冷启动在未建立长连接时，中间舱会被连接引导或阻断面板遮蔽。用户无法在离线状态下查阅本地历史。

治理目标：
- 建立分桶命名空间（Namespaced Buckets）的通用配置存储系统，支持未来无缝扩展任意客户端偏好。
- 引入支持凭据安全加密的多网关注册表，实现多节点独立配置与毫秒级切换。
- 升级本地消息缓存主键为五元组，彻底实现多网关本地数据物理隔离。
- 建立带代际控制的冷启动静默连接状态机，实现连通免弹窗与离线平滑只读。

---

## 一、 通用可扩展配置架构：分桶命名空间与信封设计

系统采用分桶隔离设计。每个配置域拥有独立的存储信封与生命周期，单桶结构升级或损坏绝不连坐其他配置。

### 1. 通用偏好信封契约 (`PreferenceEnvelope<T>`)

文件位置：`packages/core/src/cache/types.ts`

```typescript
/**
 * 偏好信封结构版本号。结构发生非兼容调整时递增。
 */
export const SETTINGS_ENVELOPE_VERSION = 1 as const;

/**
 * 通用偏好存储信封
 */
export interface PreferenceEnvelope<T = unknown> {
  /** 命名空间标识，如 'gateway'、'appearance' */
  readonly namespace: string;
  /** 结构版本号，单调递增整数 */
  readonly schemaVersion: number;
  /** 最后修改时间戳（毫秒整数） */
  readonly updatedAt: number;
  /** 载荷数据主体 */
  readonly data: T;
  /** 预留扩展元数据 */
  readonly meta?: Record<string, unknown>;
}

/**
 * 构造标准偏好信封
 */
export function createPreferenceEnvelope<T>(
  namespace: string,
  data: T,
  schemaVersion: number = SETTINGS_ENVELOPE_VERSION
): PreferenceEnvelope<T> {
  return {
    namespace,
    schemaVersion,
    updatedAt: Date.now(),
    data,
  };
}
```

### 2. 强类型命名空间注册表

```typescript
/**
 * 官方已知核心配置命名空间映射表
 */
export interface KnownSettingsMap {
  'gateway': GatewayRosterState;
  'appearance': AppearancePreferences;
  'workbench': WorkbenchPreferences;
}

/**
 * 统一命名空间类型。开放第三方与扩展前缀。
 */
export type SettingsNamespace =
  | keyof KnownSettingsMap
  | `ext:${string}`
  | `plugin:${string}`;

export type SettingsTypeOf<K extends SettingsNamespace> =
  K extends keyof KnownSettingsMap ? KnownSettingsMap[K] : Record<string, unknown>;
```

---

## 二、 核心领域模型与契约定义

### 1. 多网关注册表模型 (`GatewayRosterState`)

文件位置：`packages/core/src/cache/types.ts`

```typescript
export type GatewayAuthType = 'basic' | 'token' | 'none';

/**
 * 单个网关连接配置实体
 */
export interface GatewayConnectionProfile {
  /** 唯一 ID，格式为 'gw_' + 时间戳或随机串 */
  id: string;
  /** 用户定义显示名称，如 '本地开发节点' */
  name: string;
  /** 网关 HTTP/WS 基准地址，如 'http://127.0.0.1:9119' */
  url: string;
  /** 认证方式 */
  authType: GatewayAuthType;
  /** 认证用户名 */
  username?: string;
  /** 操作系统级安全加密后的密码密文 (Base64) */
  passwordEncrypted?: string;
  /** 内存中的临时明文密码（仅在未加密或正在编辑时使用） */
  passwordPlain?: string;
  /** 认证 Token */
  token?: string;
  /** 默认选中的数字员工 Profile */
  defaultProfile?: string;
  /** 最近连通时间戳（毫秒） */
  lastConnectedAt?: number;
  /** 最近一次探测的 RTT 延迟 (ms) */
  lastLatencyMs?: number;
}

/**
 * 多网关注册表容器
 */
export interface GatewayRosterState {
  /** 当前活动网关 ID */
  activeGatewayId: string;
  /** 默认兜底网关 ID */
  defaultGatewayId: string;
  /** 已保存的网关列表 */
  items: GatewayConnectionProfile[];
}
```

### 2. 外观与字体配置模型 (`AppearancePreferences`)

```typescript
export interface AppearancePreferences {
  /** 界面无衬线字体，对应 --font-sans */
  uiFont: string;
  /** 代码等宽字体，对应 --font-mono */
  monoFont: string;
  /** 字阶缩放档位 */
  sizeScale: 'compact' | 'medium' | 'large' | 'huge';
  /** 主题皮肤 ID */
  themeId: string;
  /** 主题模式 */
  themeMode: 'dark' | 'light' | 'system';
  /** 减弱动效模式 */
  reducedMotion: boolean;
}
```

### 3. 工作台骨架配置模型 (`WorkbenchPreferences`)

```typescript
export interface WorkbenchPreferences {
  /** 左轨像素宽度，缺省 264px */
  leftRailWidth: number;
  /** 右检查舱像素宽度，缺省 410px */
  inspectionPodWidth: number;
  /** 左轨是否处于紧凑折叠态 */
  leftRailCollapsed: boolean;
  /** 检查舱是否折叠 */
  inspectionPodCollapsed: boolean;
}
```

---

## 三、 本地缓存多网关物理隔离 (Multi-Gateway Isolation)

原有消息表使用四元组主键 `[profile, channel, channelId, orderKey]`。当存在多个网关节点时，若不同网关均含有同名 Profile（如 `default`），本地 IndexedDB 将发生消息互串与覆盖。

### 1. 消息表主键升级为五元组

IndexedDB 消息存储对象的主键路径与范围查询升级为五元组：
`[gatewayId, profile, channel, channelId, orderKey]`

### 2. 通道引用契约调整

文件位置：`packages/core/src/cache/types.ts`

```typescript
export interface CacheChannelRef {
  /** 归属网关 ID。空串代表全局或未绑定网关 */
  gatewayId: string;
  /** 归属数字员工 profile */
  profile: string;
  /** 通道类型 */
  channel: 'session' | 'room';
  /** 会话 ID 或群聊房间 ID */
  channelId: string;
}
```

`buildChannelBounds` 方法同步更新。下界与上界前缀均包含 `gatewayId`，确保物理隔离。

---

## 四、 存储分层与凭据加密

系统按照时延敏感度与安全级别采用三级分层存储：

```text
┌────────────────────────────────────────────────────────────────────────┐
│ L1: 热同步层 (Hot Tier / localStorage)                                  │
│     存储内容: 'appearance'、'workbench'、'gateway' 中的 activeGatewayId │
│     特性: 首屏同步读取 (< 5ms)，挂载前直接注入 :root CSS，杜绝界面跳变   │
├────────────────────────────────────────────────────────────────────────┤
│ L2: 结构存储层 (Cold Tier / IndexedDB: 'settings' & 'messages')         │
│     存储内容: GatewayRosterState 完整列表、全量消息正文                 │
│     特性: 异步事务读取，无 5MB 配额约束，支持大对象与深层嵌套            │
├────────────────────────────────────────────────────────────────────────┤
│ L3: 安全凭据层 (Secure Vault / Electron safeStorage)                   │
│     存储内容: GatewayConnectionProfile 中的敏感密码与 Token             │
│     特性: 调用系统底层 DPAPI (Windows) 或 Keychain (macOS) 加密落盘     │
└────────────────────────────────────────────────────────────────────────┘
```

### 凭据加密 IPC 桥接契约

在 `packages/desktop/src/preload/index.ts` 与 `main/ipc.ts` 中增加凭据加解密接口：
- `desktopApi.encryptSecret(plainText: string): Promise<string>`
- `desktopApi.decryptSecret(cipherText: string): Promise<string>`

在主进程中，若 `safeStorage.isEncryptionAvailable()` 为 true，调用系统硬件保护接口。若不可用（如 Linux 无密钥环），采用应用派生密钥混淆并记录降级告警。

---

## 五、 冷启动与无感连接状态机时序

### 1. 连接状态迁移矩阵

```text
    [ 系统冷启动 ]
          │
          ├─────────────────────────────────────────┐
          ▼                                         ▼
   [ 同步注入 L1 外观 ]                     [ 读取 L2 活动网关配置 ]
  写入 :root CSS 变量                       提取目标 GatewayProfile
  加载本地会话大盘列表                                │
          │                                         │
          └───────────────────┬─────────────────────┘
                              ▼
                   [ 启动静默握手 (Epoch++) ]
                              │
               ┌──────────────┴──────────────┐
               ▼                             ▼
        【连接握手成功】              【连接失败 / 超时】
               │                             │
    • gatewayConnected = true      • gatewayConnected = false
    • 顶栏呈现极客青绿指示灯        • 顶栏呈现淡雅灰色离线标识
    • 免弹连接配置窗口              • 保留本地会话阅读与翻阅能力
    • 触发增量会话与 Bot 对齐       • 输入舱置灰并提示只读模式
                                   • 顶栏提供非侵入式网关切换入口
```

### 2. 消除异步竞争的代际控制机制 (Epoch Cancellation)

为了避免用户在网络超时期间手动切换网关产生新旧连接竞态，连接控制器内部维护单调自增的 `connectionEpoch`。

```typescript
let connectionEpoch = 0;

async function connectToGateway(profile: GatewayConnectionProfile): Promise<void> {
  const currentEpoch = ++connectionEpoch;

  // 1. 中止旧客户端
  if (gatewayClient) {
    gatewayClient.disconnect();
    gatewayClient = null;
  }

  state.gatewayConnecting = true;
  state.gatewayConnected = false;
  render();

  try {
    const testResult = await testConnection(profile.url, profile.username, password);

    // 检查代际是否已被后续操作废弃
    if (currentEpoch !== connectionEpoch) {
      return;
    }

    if (!testResult.ok) {
      handleConnectFailure(testResult.message);
      return;
    }

    // 握手成功，初始化长连接客户端
    initGatewayClient(profile, testResult.ticket);
    state.gatewayConnecting = false;
    state.gatewayConnected = true;
    render();
  } catch (error) {
    if (currentEpoch !== connectionEpoch) return;
    handleConnectFailure(error instanceof Error ? error.message : '网络异常');
  }
}
```

### 3. 拔除离线阻断式弹窗

彻底废除网关未连接时遮挡主界面的历史行为。
- 当 `gatewayConnected` 为 false 时，中间舱（MiddlePod）依然挂载会话历史流。
- 输入舱底部状态条显示“网关未连接，当前处于离线浏览模式”。
- 提交按钮处于禁用态，禁止触发 `prompt.submit`。
- 设置弹窗与连接配置表单只有在用户主动点击“设置”或顶栏“网络节点”时才被呼出。

---

## 六、 存量历史配置平滑迁移脚本 (Migration Invariant)

系统在首次启动时自动探测旧版平铺式键名，并自动封装迁移入新分桶体系：

```typescript
export async function migrateLegacySettingsIfNeeded(store: ICacheStore): Promise<void> {
  const existingGateways = await store.readIndex('gateways');
  if (existingGateways) return;

  const legacyUrl = localStorage.getItem('hermes_flux_gateway_url')
    || localStorage.getItem('hermes_aura_gateway_url')
    || 'http://127.0.0.1:9119';
  const legacyUser = localStorage.getItem('hermes_flux_username')
    || localStorage.getItem('hermes_aura_username')
    || '';
  const legacyPass = localStorage.getItem('hermes_flux_password')
    || localStorage.getItem('hermes_aura_password')
    || '';
  const legacyProfile = localStorage.getItem('hermes_flux_profile')
    || localStorage.getItem('hermes_aura_profile')
    || 'default';

  const defaultGwId = 'gw_default';
  const initialRoster: GatewayRosterState = {
    activeGatewayId: defaultGwId,
    defaultGatewayId: defaultGwId,
    items: [
      {
        id: defaultGwId,
        name: '默认网关',
        url: legacyUrl,
        authType: legacyPass ? 'basic' : 'none',
        username: legacyUser,
        passwordPlain: legacyPass,
        defaultProfile: legacyProfile,
        lastConnectedAt: Date.now(),
      },
    ],
  };

  await store.writeIndex('gateways', createPreferenceEnvelope('gateway', initialRoster));

  // 清除存量冗余键
  const legacyKeys = [
    'hermes_flux_gateway_url', 'hermes_aura_gateway_url',
    'hermes_flux_username', 'hermes_aura_username',
    'hermes_flux_password', 'hermes_aura_password',
  ];
  for (const k of legacyKeys) {
    localStorage.removeItem(k);
  }
}
```

---

## 七、 实施任务分解与执行清单 (Execution Checklist)

### 阶段一：Core 契约与分桶存储模型
- [ ] 在 `packages/core/src/cache/types.ts` 定义 `PreferenceEnvelope`、`GatewayRosterState`、`AppearancePreferences` 与五元组 `CacheChannelRef`。
- [ ] 在 `packages/core/src/cache/ICacheStore.ts` 扩充 `gateways` 与 `settings` 索引键，并调整 `buildChannelBounds` 支持 `gatewayId`。
- [ ] 编写 Core 层单元测试：验证信封版本校验、非法数据拦截、五元组主键计算边界。

### 阶段二：Desktop 存储驱动与加密 IPC 接入
- [ ] 在 `packages/desktop/src/main/ipc.ts` 注册 `secret:encrypt` 与 `secret:decrypt` 处理句柄。
- [ ] 在 `packages/desktop/src/preload/index.ts` 暴露加解密平台接口给渲染层。
- [ ] 在 `packages/desktop/src/renderer/cache/DesktopCacheStore.ts` 中实现分桶信封写入与历史数据自动迁移。

### 阶段三：渲染层无感连接与免弹窗交互
- [ ] 重构 `packages/desktop/src/renderer/index.ts` 的 `init()` 与 `connect()`，接入单调代际控制器与静默握手。
- [ ] 拔除中间舱未连接时的硬遮罩，保障离线历史消息在 DOM 树可见可翻阅。
- [ ] 顶栏接入多网关快速切换悬浮微组件。

### 阶段四：全量质量门禁与端到端自动化验收
- [ ] 执行 `npm run typecheck`，断言 0 类型错误。
- [ ] 执行单测套件 `node --test packages/core/__tests__/cache/*.test.mjs`，确保 100% 绿灯。
- [ ] 运行桌面端冷启动 E2E 测试 `packages/desktop/__tests__/cdp/cache-cold-start-cdp.test.mjs`，断言离线状态下历史文本硬匹配通过，消除历史降级记录文件。
