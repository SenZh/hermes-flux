import * as React from 'react';
import { t } from '../../i18n/index.js';
import type { SettingsBotRow } from './settingsModel.js';
import { BotAvatarChip } from './BotAvatarToggle.js';

/**
 * 「保存时配置到」的成员选择。
 *
 * 【设计意图 (Why)】
 *   这里问的问题和提供商列表里的「生效于」是同一个：「这条提供商要配置到哪些 Bot」。
 *   交互必须同源——点头像选择——否则用户要在一处辨认 12px 复选框、在另一处
 *   辨认 44px 头像，同一个动作两种手感。长相仍由 `BotAvatarToggle` 家族的组件统一，
 *   本文件只做数据适配与布局。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 历史实现是原生复选框 + 24 显示单位长名列表，与列表页的头像网格完全不是一套语言；
 *      长名被截断成 `auralis-infrastructure-…`，用户还得靠 title 才认得出是谁。
 *   2. 上一版把当前 Bot 从列表里过滤掉，用户看不到"这条会写到谁身上"，只能靠副标题猜。
 *      当前 Bot 必须出现并显示为已勾选且锁定：它本来就是保存目标。
 *   3. 换成列表页的 44px 网格后，弹框高度受硬限，头像网格把「保存」推出首屏。
 *      这里必须用紧凑规格（32px 头像 + 名称同排），把垂直预算留给动作条。
 *
 * 【约束与规则 (Rules)】
 *   1. 只做勾选展示与回调，不持有状态、不读快照；
 *   2. `lockedProfile` 恒为已勾选且不可取消，回调对它不生效，且必须用锁形角标区别于普通勾选；
 *   3. 不使用绿环：新建端点时这些 Bot 还没有"默认提供商"这回事；
 *   4. 名称截断、头像兜底、角标语义全部由组件决定，本文件不得覆盖。
 */
export function FanOutMemberList({
  bots,
  selected,
  lockedProfile,
  onToggle,
}: {
  bots: readonly SettingsBotRow[];
  selected: readonly string[];
  /** 保存目标本身：永远勾选且不可取消。 */
  lockedProfile: string;
  onToggle: (profile: string) => void;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap gap-1">
      {bots.map((bot) => {
        const locked = bot.profile === lockedProfile;
        return (
          <BotAvatarChip
            key={bot.profile}
            profile={bot.profile}
            displayName={bot.displayName}
            avatar={bot.avatar}
            checked={locked || selected.includes(bot.profile)}
            disabled={locked}
            locked={locked}
            statusText={locked ? t('settings.customEndpointApplyToLocked') : undefined}
            onToggle={() => {
              if (locked) return;
              onToggle(bot.profile);
            }}
          />
        );
      })}
    </div>
  );
}
