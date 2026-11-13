/**
 * Agent 在场指示器（AgentPresence）
 *
 * 【设计意图 (Why)】
 *   「Agent 现在在干什么」必须只有一个真值出口。宿主历史上把它投影成两处：
 *   `updateActivityPill()` 的模板注入与 `InputDock.activityStatus` 的组件渲染，
 *   两处各自演化，出现「顶栏写 thinking、输入舱写 writing response」的双标。
 *   本组件是全系统唯一的运行态表现面：只消费 `core` 推导出的判别联合
 *   （`AgentPresence`）与身份快照，自身不解析事件、不读全局状态、不发起 RPC。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 单行形态里头像与文案共享水平容器，文字变长会把整组推宽，头像位置随文字抖动。
 *      因此这里强制两行：头像独占上轴，文案独立下行，文字长短只影响自己的行宽。
 *   2. 宿主模板若把 host 放进 `#conversation-stream`，画布整块替换时会被销毁。
 *      组件本身不负责挂载，但 `mountAgentPresence` 的注释里锁死了这条约束。
 *   3. 群聊里多个头像全部挂完整形变会立刻违反「同一时刻只有一个视觉焦点」。
 *      因此只有最左说话者挂完整形变语言，其余成员仅统一极轻呼吸（见 conversation.css）。
 *   4. 说话者未知时若「猜一个」高亮，用户会看到某人明明没说话却被点亮。这里一律降级：
 *      全部 `data-speaker="false"`、不加说话者前缀，绝不伪造身份。
 *
 * 【约束与规则 (Rules)】
 *   1. 文案 100% 走 `t()`，本文件禁止任何中文字面量（门禁 i18n/no-hardcoded-text）；
 *   2. 禁止任何内联 `style` 与裸色值：几何与颜色全部由 conversation.css 的类承担
 *      （门禁 theme/no-inline-hex、visual/no-arbitrary-value）；
 *   3. 只读指示器：零回调、零交互，点击跳转等能力不在本组件职责内；
 *   4. 眨眼由 `usePresenceTicker` 的集中时钟驱动，禁止在 CSS 里写 infinite 眨眼；
 *   5. 终态（failed / interrupted）不眨眼、不转环——静止的眼睛是「停住了」的最强信号。
 */

import * as React from 'react';
import {
  IDLE_QUIP_COUNT,
  presenceTone,
  pickIdleQuipIndex,
  type AgentPresence,
  type PresenceToolKind,
} from '@hermes-flux/core';
import { t, type I18nKey } from '../i18n/index.js';
import { renderBotAvatar } from '../utils/botAvatar.js';
import { useIdleQuipTicker, usePresenceTicker } from './conversation/usePresenceTicker.js';

/** 头像槽位边长（px）：单聊与群聊同尺寸，缩了就变成「小图标堆」而不是在场感 */
const PRESENCE_AVATAR_SIZE = 56;
/** 群聊最多展示的槽位数；超出时最后一位替换为 +N 计数块 */
const PRESENCE_MAX_AVATARS = 4;
/** 工具目标单行展示上限：超出以省略号收尾 */
const TARGET_MAX_CHARS = 40;
/** 失败原因展示上限 */
const FAILURE_MESSAGE_MAX_CHARS = 60;

/**
 * 空闲轮播文案的键表（顺序必须与 core `IDLE_QUIP_COUNT` 对齐）。
 *
 * 【为什么写死成元组】(Rules) `t()` 的键类型是字面量联合，`presence.idle.${number}`
 *   无法通过类型检查；写成 `as const` 元组既保住类型安全，又能在单测里逐条校验字典完整性。
 */
const IDLE_QUIP_KEYS = [
  'presence.idle.0',
  'presence.idle.1',
  'presence.idle.2',
  'presence.idle.3',
  'presence.idle.4',
  'presence.idle.5',
  'presence.idle.6',
  'presence.idle.7',
] as const satisfies readonly I18nKey[];

/**
 * 键表长度必须等于 core 的条数常量。
 *
 * 【为什么必须有 (Rules)】`pickIdleQuipIndex` 的返回值域由 core 的 `IDLE_QUIP_COUNT` 决定，
 *   而键表写在 ui 侧。两边一旦脱钩，`IDLE_QUIP_KEYS[index]` 会取到 `undefined`，
 *   `t(undefined)` 静默返回 undefined，文案直接消失——编译器与现有单测都抓不到。
 *   因此这里在模块加载期硬校验：宁可启动即失败，也不要静默少一句。
 */
const IDLE_QUIP_KEYS_LENGTH: typeof IDLE_QUIP_COUNT = IDLE_QUIP_KEYS.length;
if (IDLE_QUIP_KEYS_LENGTH !== IDLE_QUIP_COUNT) {
  throw new Error(
    `[presence] IDLE_QUIP_KEYS has ${IDLE_QUIP_KEYS_LENGTH} entries but core IDLE_QUIP_COUNT is ${IDLE_QUIP_COUNT}`,
  );
}

/**
 * 路径中的结构性噪音目录。
 *
 * 【设计意图 (Why)】`packages/core/src/gateway.ts` 若按「末两段」裁剪得到 `src/gateway.ts`，
 *   而 `src` 对「这是哪个模块的文件」零信息量——几乎每个包都有 src。跳过噪音目录后
 *   得到 `core/gateway.ts`，用户能一眼认出是自己的哪个模块。
 */
const PATH_NOISE_SEGMENTS = new Set([
  'src',
  'lib',
  'dist',
  'build',
  'out',
  'tests',
  'test',
  '__tests__',
  'packages',
]);

/** 单聊身份：当前会话只有一个在场者 */
export interface AgentPresenceIdentitySolo {
  kind: 'solo';
  name: string;
  displayName?: string;
  avatar?: string;
}

/** 群聊身份：一个房间 + 其中正在说话的那一个 */
export interface AgentPresenceIdentityGroup {
  kind: 'group';
  members: string[];
  /** 当前说话者；null 表示未知，必须走降级（不高亮、不加前缀） */
  speaker: string | null;
  profiles: Array<{ name: string; displayName?: string; avatar?: string }>;
}

export interface AgentPresenceSnapshot {
  /** 来自 @hermes-flux/core 的唯一状态真值 */
  presence: AgentPresence;
  identity: AgentPresenceIdentitySolo | AgentPresenceIdentityGroup;
  /** 当前语言；纳入 memo 比较，切语言后必须重渲染（t() 本身不是响应式的） */
  locale?: string;
  /**
   * 布局变体。
   *
   * 【设计意图 (Why)】同一份状态真值要能落在两个位置：对话区顶部悬浮（`stage`）与
   *   输入舱上沿（`dock`）。两套效果只在几何与字号上不同，状态、文案、动效全部共用，
   *   因此这里是**表现变体**而不是第二套状态模型。
   *
   * 【约束与规则 (Rules)】缺省按 `stage` 处理：老宿主不传时行为必须与改造前完全一致。
   */
  layout?: 'stage' | 'dock';
}

/** 群聊成员的头像资产（真实资产优先，缺失时回退确定性图腾） */
interface PresenceProfile {
  name: string;
  displayName?: string;
  avatar?: string;
}

/**
 * 工具目标的展示裁剪。
 *
 * 【设计意图 (Why)】工具目标常常是绝对路径或整条命令，直接塞进 12px 单行会把行宽撑爆，
 *   而用户真正需要认出来的是「哪个文件 / 哪条命令」，不是完整的前缀。
 *
 * 【约束与规则 (Rules)】
 *   1. 路径型（含 `/` 或 `\`）取「文件名 + 最近一级语义目录」并以 `/` 连接。
 *      结构性噪音目录（src / lib / dist / build / tests 等）不算语义层级：
 *      `packages/core/src/gateway.ts` 应展示为 `core/gateway.ts` 而不是 `src/gateway.ts`，
 *      因为 `src` 对「这是哪个模块的文件」零信息量，而 `core` 才是用户能认出来的那个词；
 *   2. 命令型与其余文本取首行，超过 40 字符截断并加省略号（换行会撕裂行高）；
 *   3. 纯函数，无副作用，可单测。
 */
export function formatPresenceTarget(tool: PresenceToolKind, target: string): string {
  const raw = (target || '').trim();
  if (!raw) return '';

  // 首行优先：命令与多行描述只保留第一行，避免行盒被撑开
  const newlineAt = raw.search(/[\r\n]/);
  const head = (newlineAt >= 0 ? raw.slice(0, newlineAt) : raw).trim();
  if (!head) return '';

  if (tool !== 'command' && (head.includes('/') || head.includes('\\'))) {
    const segments = head.split(/[\\/]+/).filter((segment) => segment.length > 0);
    if (segments.length >= 2) {
      const file = segments[segments.length - 1];
      let parent = '';
      for (let i = segments.length - 2; i >= 0; i -= 1) {
        if (!PATH_NOISE_SEGMENTS.has(segments[i].toLowerCase())) {
          parent = segments[i];
          break;
        }
      }
      const tail = parent ? `${parent}/${file}` : file;
      return tail.length > TARGET_MAX_CHARS ? `${tail.slice(0, TARGET_MAX_CHARS)}…` : tail;
    }
  }

  return head.length > TARGET_MAX_CHARS ? `${head.slice(0, TARGET_MAX_CHARS)}…` : head;
}

/**
 * 把 `renderBotAvatar` 产出的两颗瞳孔包进带 `conv-presence__eyes` 的眼组。
 *
 * 【设计意图 (Why)】眨眼必须作用在一个可整体 scaleY 的 `<g>` 上，
 *   而共享头像原语产出的 SVG 里瞳孔是裸 `<circle>`，没有可挂载的容器。
 *
 * 【防范的历史坑 (Pitfall)】不能修改 `renderBotAvatar` 去无条件输出眼组：
 *   左轨、标题栏、群聊拼图、任务弹窗全部是它的消费者，多出一层 `<g>` 会改变
 *   它们的结构断言与既有样式选择器。因此只在在场指示器这一侧做纯字符串包装。
 *
 * 【约束与规则 (Rules)】
 *   1. 只在确实存在两颗瞳孔圆时包装；真实资产 `<img>` 与异常输入原样返回；
 *   2. 包装区间是「倒数第二个 `<circle`」到 `</svg>`，与具体坐标无关，形状分支无关。
 */
function wrapBlinkEyes(avatarHtml: string): string {
  const lastCircle = avatarHtml.lastIndexOf('<circle');
  if (lastCircle < 0) return avatarHtml;
  const prevCircle = avatarHtml.lastIndexOf('<circle', lastCircle - 1);
  if (prevCircle < 0) return avatarHtml;
  const svgEnd = avatarHtml.lastIndexOf('</svg>');
  if (svgEnd < prevCircle) return avatarHtml;
  return `${avatarHtml.slice(0, prevCircle)}<g class="conv-presence__eyes">${avatarHtml.slice(
    prevCircle,
    svgEnd,
  )}</g>${avatarHtml.slice(svgEnd)}`;
}

/** 单个头像槽位的安全 HTML（真实资产优先，缺失时回退确定性图腾，形状恒为圆形） */
function buildFaceHtml(profile: PresenceProfile): string {
  const avatarHtml = renderBotAvatar(
    profile.name,
    profile.displayName,
    profile.avatar,
    PRESENCE_AVATAR_SIZE,
    'circle',
  );
  return wrapBlinkEyes(avatarHtml);
}

/** 文案模型：把判别联合翻译成「动词 / 目标 / 打字波」三段，供 DOM 契约直接消费 */
interface PresenceTextModel {
  /** 目标片段之前的动词（工具态为「正在读」，其余态是整句） */
  verbBefore: string;
  /** 目标片段之后的收尾（如「花了些时间」），空串表示没有 */
  verbAfter: string;
  /** 已裁剪的目标片段；仅工具态非空 */
  target: string;
  /** 是否渲染目标片段（DOM 契约要求 tool 态恒存在） */
  showTarget: boolean;
  /** 是否渲染打字波（仅 writing 态） */
  showBars: boolean;
  /** 是否为空闲轮播文案（只影响弱化呈现，不影响布局） */
  isIdleQuip: boolean;
}

/**
 * 文案映射的唯一出口。
 *
 * 【约束与规则 (Rules)】
 *   1. `idle` 不产生任何文案（整行退场，头像仍在）；
 *   2. writing 只有 fresh / long 两档（i18n 键集合如此），patient 归入 fresh；
 *   3. 工具文案按 `{target}` 占位符切成前后两段，目标片段单独成 `<span>`，
 *      以便目标走等宽字体与二级色，动词保持前景色；
 *   4. 失败原因先截断再交给 i18n（截断是表现层职责，不进字典）。
 */
function buildTextModel(
  presence: AgentPresence,
  tone: 'fresh' | 'patient' | 'long',
  idleQuip: string,
): PresenceTextModel {
  const empty: PresenceTextModel = {
    verbBefore: '',
    verbAfter: '',
    target: '',
    showTarget: false,
    showBars: false,
    isIdleQuip: false,
  };

  switch (presence.kind) {
    case 'idle':
      // 空闲态播报「它在闲着」的轮播短句：头像完全静止读起来像进程挂了
      return { ...empty, verbBefore: idleQuip, isIdleQuip: true };

    case 'thinking':
      return { ...empty, verbBefore: t(`presence.thinking.${tone}`) };

    case 'writing':
      return {
        ...empty,
        verbBefore: t(tone === 'long' ? 'presence.writing.long' : 'presence.writing.fresh'),
        showBars: true,
      };

    case 'tool': {
      // 先取不带参数的模板，再按 {target} 切分：目标要单独成段
      const template = t(`presence.tool.${presence.tool}.${tone}`);
      const marker = '{target}';
      const at = template.indexOf(marker);
      const verbBefore = at >= 0 ? template.slice(0, at).trim() : template;
      const verbAfter = at >= 0 ? template.slice(at + marker.length).trim() : '';
      return {
        ...empty,
        verbBefore,
        verbAfter,
        target: formatPresenceTarget(presence.tool, presence.target),
        showTarget: true,
      };
    }

    case 'delegating': {
      const profile = presence.profile.trim();
      return {
        ...empty,
        verbBefore: profile
          ? t('presence.delegating', { profile })
          : t('presence.delegatingAnonymous'),
      };
    }

    case 'failed': {
      const raw = presence.message.trim();
      const shown =
        raw.length > FAILURE_MESSAGE_MAX_CHARS
          ? `${raw.slice(0, FAILURE_MESSAGE_MAX_CHARS)}…`
          : raw;
      return { ...empty, verbBefore: t('presence.failed', { message: shown }) };
    }

    case 'interrupted':
      return { ...empty, verbBefore: t('presence.interrupted') };
  }
}

/** 群聊成员的展示顺序：说话者置最左（z-index 从左到右递减，天然压在最上层） */
function orderGroupMembers(identity: AgentPresenceIdentityGroup): string[] {
  const members = identity.members.filter((member) => typeof member === 'string' && member.length > 0);
  const speaker = identity.speaker;
  if (!speaker) return members;
  const lead = members.find((member) => member === speaker);
  if (!lead) return members;
  return [lead, ...members.filter((member) => member !== speaker)];
}

/**
 * 说话者是否可信。
 *
 * 【设计意图 (Why)】宿主的 `activeGroupSpeaker` 与房间 `members` 是两条独立数据通路，
 *   可能出现「说话者字段有值但成员列表里没有这个人」（成员刚退出、事件乱序）。
 *
 * 【约束与规则 (Rules)】说话者必须真实存在于成员列表才算已知；否则一律按未知降级——
 *   宁可全部不高亮、不加前缀，也绝不显示一个指向不存在头像的人名。
 */
function isSpeakerKnown(identity: AgentPresenceIdentityGroup): boolean {
  const speaker = identity.speaker;
  if (!speaker) return false;
  return identity.members.some((member) => member === speaker);
}

/** 成员名 → 头像资产；查不到时给纯名字，由共享原语回退确定性图腾 */
function resolveProfile(
  name: string,
  profiles: ReadonlyArray<PresenceProfile>,
): PresenceProfile {
  const lower = name.toLowerCase();
  const hit = profiles.find(
    (profile) =>
      profile.name.toLowerCase() === lower ||
      (profile.displayName ?? '').toLowerCase() === lower,
  );
  return hit ? { ...hit, name } : { name };
}

/** 头像槽位：单聊只有一位，群聊是横排叠层（末位可能是 +N 计数块） */
interface PresenceSlot {
  key: string;
  isSpeaker: boolean;
  isLead: boolean;
  /** 头像 HTML；计数块为 null */
  faceHtml: string | null;
  /** 计数块文案（如 +2）；头像槽位为 null */
  moreLabel: string | null;
}

/**
 * 在场指示器。
 *
 * 【约束与规则 (Rules)】纯表现组件：只读 `snapshot`，零回调。
 *   身份与状态都由宿主给出，组件不做任何推断或补全。
 */
export function AgentPresence(props: { snapshot: AgentPresenceSnapshot }): React.ReactElement {
  const { presence, identity } = props.snapshot;
  const layout = props.snapshot.layout ?? 'stage';
  const tone = presenceTone(presence);

  const isTerminal = presence.kind === 'failed' || presence.kind === 'interrupted';
  const blinkable = !isTerminal;

  const isGroup = identity.kind === 'group' && identity.members.length > 0;
  const orderedMembers = isGroup ? orderGroupMembers(identity) : [];
  const profiles = isGroup ? identity.profiles : [];
  // 说话者必须真实存在于成员列表才算已知，否则按未知降级（见 isSpeakerKnown 注释）
  const speakerKnown = isGroup && isSpeakerKnown(identity);

  // 眨眼与空闲轮播共用同一身份种子：换会话/换群聊重新派生，同一身份内保持稳定
  // 【规则】用 identity.kind 收窄而非 isGroup 布尔量：TS 无法通过布尔量反推联合成员
  // 【规则】群聊 seed 必须用**排序后**的成员表：`orderedMembers` 会把说话者提到最左，
  //   说话者一换 seed 就变，眨眼节拍与轮播起点被无谓重置（同一房间不该有这种抖动）。
  const presenceSeed =
    identity.kind === 'group'
      ? [...identity.members].sort().join(',')
      : identity.name;
  const blinking = usePresenceTicker(blinkable, presenceSeed);
  const idleQuip = useIdleQuipTicker(presence.kind === 'idle');
  const idleQuipText = t(IDLE_QUIP_KEYS[pickIdleQuipIndex(presenceSeed, idleQuip.tick)]);

  // locale 必须进依赖：t() 读的是模块级当前语言，切语言时只有 props 变化能触发重渲染
  const text = React.useMemo(
    () => buildTextModel(presence, tone, idleQuipText),
    [presence, tone, props.snapshot.locale, idleQuipText],
  );

  const slots: PresenceSlot[] = [];

  if (!isGroup) {
    /**
     * 单聊头像槽位：唯一在场者，挂完整形变语言。
     *
     * 【降级 (Rules)】群聊身份但成员表为空（房间尚未到达 / 全员已退出）时也走这里：
     *   宁可显示一个确定性的兜底头像，也不能渲染一个空的 avatars 容器——
     *   后者会让文案浮在没有任何主体的位置，用户读不出「谁在干活」。
     */
    const soloName = identity.kind === 'solo' ? identity.name : 'agent';
    const soloDisplayName = identity.kind === 'solo' ? identity.displayName : undefined;
    const soloAvatar = identity.kind === 'solo' ? identity.avatar : undefined;
    slots.push({
      key: soloName,
      isSpeaker: true,
      isLead: true,
      faceHtml: buildFaceHtml({
        name: soloName,
        displayName: soloDisplayName,
        avatar: soloAvatar,
      }),
      moreLabel: null,
    });
  } else {
    /** 群聊头像槽位：说话者最左 + 溢出计数块 */
    const overflow = orderedMembers.length > PRESENCE_MAX_AVATARS;
    const visible = overflow ? orderedMembers.slice(0, PRESENCE_MAX_AVATARS - 1) : orderedMembers;
    visible.forEach((member, index) => {
      slots.push({
        key: `member-${member}-${index}`,
        isSpeaker: speakerKnown && index === 0 && member === identity.speaker,
        isLead: index === 0,
        faceHtml: buildFaceHtml(resolveProfile(member, profiles)),
        moreLabel: null,
      });
    });
    if (overflow) {
      slots.push({
        key: 'more',
        isSpeaker: false,
        isLead: false,
        faceHtml: null,
        moreLabel: `+${orderedMembers.length - (PRESENCE_MAX_AVATARS - 1)}`,
      });
    }
  }

  /** 群聊说话者展示名：优先 displayName，前缀是横排叠层里唯一能精确认出「谁在说话」的通道 */
  const speakerLabel = (() => {
    // 直接用 identity.kind 收窄，不能借 isGroup 布尔量：TS 不会通过它反推联合成员
    if (!speakerKnown || identity.kind !== 'group') return null;
    const profile = resolveProfile(identity.speaker ?? '', identity.profiles);
    return profile.displayName || profile.name || identity.speaker || null;
  })();

  return (
    <div
      className="conv-presence"
      data-presence={presence.kind}
      data-mode={isGroup ? 'group' : 'solo'}
      data-tone={tone}
      data-layout={layout}
      role="status"
      aria-label={t('presence.aria')}
    >
      <div className="conv-presence__avatars" data-blinkable={blinkable ? 'true' : 'false'}>
        {slots.map((slot) => (
          <span
            key={slot.key}
            className={
              slot.moreLabel === null
                ? 'conv-presence__avatar'
                : 'conv-presence__avatar conv-presence__avatar--more'
            }
            data-speaker={slot.isSpeaker ? 'true' : 'false'}
            data-lead={slot.isLead ? 'true' : 'false'}
            /*
             * 【空闲动作 (Rules)】idle 轮播换句的那一拍，头像侧一次头（420ms）。
             *   不能挂 CSS `infinite`：空闲态常驻动画只允许「呼吸 + 眨眼」，
             *   再挂一条无限循环就是第二焦点。这里由 tick 变化短暂置位，播完即归位。
             *   CSS 动画只在属性 false→true 时重播，所以 hook 里必须精确复位。
             */
            data-idle-turn={slot.isLead && idleQuip.turning ? 'true' : 'false'}
          >
            {slot.moreLabel !== null ? (
              slot.moreLabel
            ) : (
              <>
                {slot.isLead ? (
                  <>
                    <span className="conv-presence__halo" aria-hidden="true" />
                    <span className="conv-presence__ring" aria-hidden="true" />
                  </>
                ) : null}
                <span
                  className="conv-presence__face"
                  aria-hidden="true"
                  data-blink={slot.isLead && blinking ? 'true' : 'false'}
                  dangerouslySetInnerHTML={{ __html: slot.faceHtml ?? '' }}
                />
              </>
            )}
          </span>
        ))}
      </div>

      {/*
        【交叉淡入 (Rules)】必须带随状态与语气变化的 key。
        无 key 时 React 会复用同一个 DOM 节点、只替换文本子节点，
        而 CSS 动画只在元素首次插入时播放一次——「换气」效果会完全失效，
        用户看到的是生硬跳字（比淡入更晃眼）。
        【idle 轮播 (Rules)】空闲态也常驻文案（轮播短句），因此 key 必须带轮播序号，
        否则换句时节点被复用、淡入不播，读作硬跳字。
        【aria-hidden (Rules)】空闲轮播每 9s 换一句，若留在 `role="status"` 的 live region 里，
        屏幕阅读器会永久性地每 9s 播报一遍整行。空闲短句是氛围文案，必须对辅助技术静音。
      */}
      <span
        className="conv-presence__text"
        key={`${presence.kind}:${tone}:${text.isIdleQuip ? idleQuip.tick : ''}`}
        data-idle-quip={text.isIdleQuip ? 'true' : 'false'}
        aria-hidden={text.isIdleQuip ? 'true' : undefined}
      >
          {speakerLabel !== null ? (
            <>
              <span className="conv-presence__prefix">{speakerLabel}</span>
              <span className="conv-presence__sep">·</span>
            </>
          ) : null}
          {/*
            【规则】空串必须不渲染：`.conv-presence__text` 是 gap:6px 的 flex 容器，
            空 span 虽然宽度为 0，仍会贡献一个 6px 间隙，表现为目标前多出一段空白。
            长时长的工具文案（如「{target} 跑了有些久」）动词在目标之后，
            此时 verbBefore 就是空串。
          */}
          {text.verbBefore ? <span className="conv-presence__verb">{text.verbBefore}</span> : null}
          {text.showTarget && text.target ? (
            <span className="conv-presence__target">{text.target}</span>
          ) : null}
          {text.verbAfter ? <span className="conv-presence__verb">{text.verbAfter}</span> : null}
          {text.showBars ? (
            <span className="conv-presence__bars" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          ) : null}
      </span>
    </div>
  );
}
