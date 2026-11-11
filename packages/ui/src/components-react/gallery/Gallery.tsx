/*
 * Gallery —— 设计系统原子的"真实形态"组合页。
 *
 * 设计意图(Why)：
 *   原子组件的规范是否被真正执行，靠单测是看不出来的（单测只证明类名字符串存在）。
 *   本页把 Surface / ListRow / Toolbar / Stat 四个原子拼成一个真实业务形态
 *   （模型供应商面板：工具条 + 三行状态各异的供应商 + 三个度量读数 + 说明区），
 *   让审查者对着一张截图就能判断"行高是否等高、圆角是否同档、字阶是否成对、受光线是否只在顶部"。
 *
 * 防范的历史坑(Pitfall)：
 *   1. 只用零散原子截图审查时，最容易漏的是"组合后的几何"：带边框的选中行比其它行高 2px、
 *      工具条带边框后总高 37px 这类问题只在拼装后才会暴露——因此本页刻意把
 *      selected / active / disabled 三种行并排放齐；
 *   2. 本页曾把文案硬编码中文，导致切语言时样例与真实界面不一致。这里全部走 t()。
 *
 * 约束与规则(Rules)：
 *   1. 本页是审查样例，禁止在宿主里挂载（入口只在 gallery/entry.tsx 里供人工打开）；
 *   2. 禁止在此直接写 bg-* + border + rounded-* 拼容器，必须复用四个原子——
 *      本页本身就是"业务侧只准用原子"的示范；
 *   3. 间距全部 4px 倍数，禁止任意值 class。
 */
import * as React from 'react';
import { t } from '../../i18n/index.js';
import { Badge } from '../primitives/Badge.js';
import { Button } from '../primitives/Button.js';
import { ListRow } from '../primitives/ListRow.js';
import { Stat } from '../primitives/Stat.js';
import { Surface } from '../primitives/Surface.js';
import { Toolbar } from '../primitives/Toolbar.js';

/** 行首用的小方点，只承载层级感，不承载业务语义。 */
function RowDot({ tone = 'muted' }: { tone?: 'muted' | 'primary' }): React.ReactElement {
  return <span className={tone === 'primary' ? 'size-6 rounded-full bg-primary-subtle' : 'size-6 rounded-full bg-muted'} />;
}

export function Gallery(): React.ReactElement {
  return (
    <div id="gallery-root" data-flux-island className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Surface level="panel" padding="none" specular={false}>
          <Toolbar
            leading={<span className="text-title font-semibold">{t('gallery.title')}</span>}
            trailing={
              <>
                <Button variant="outline" size="sm">
                  {t('gallery.sync')}
                </Button>
                <Button size="sm">{t('gallery.addProvider')}</Button>
              </>
            }
          />

          {/* 副标题下沉为列表的分区说明，而不是挤进工具条中段：
              工具条是"操作区"，正文说明混进去会让 16px 标题与 12px 说明贴在同一基线上。 */}
          <div className="px-2 pb-1 pt-3">
            <span className="text-aux text-muted-foreground">{t('gallery.subtitle', { count: 3 })}</span>
          </div>

          <div className="flex flex-col gap-1 p-2">
            <ListRow
              leading={<RowDot tone="primary" />}
              selected
              trailing={
                <>
                  <span className="text-aux text-muted-foreground">{t('gallery.providerModels', { count: 24 })}</span>
                  <Badge>{t('gallery.providerCurrent')}</Badge>
                </>
              }
            >
              {t('gallery.providerAnthropic')}
            </ListRow>

            <ListRow
              leading={<RowDot />}
              trailing={
                <>
                  <span className="text-aux text-muted-foreground">{t('gallery.providerModels', { count: 12 })}</span>
                  <Badge variant="secondary">{t('gallery.providerRecent')}</Badge>
                </>
              }
            >
              {t('gallery.providerOpenAI')}
            </ListRow>

            <ListRow
              leading={<RowDot />}
              disabled
              trailing={
                <>
                  <span className="text-aux text-muted-foreground">{t('gallery.providerModels', { count: 6 })}</span>
                  <Badge variant="outline">{t('gallery.providerDisabled')}</Badge>
                </>
              }
            >
              {t('gallery.providerLocal')}
            </ListRow>
          </div>
        </Surface>

        <div className="grid grid-cols-3 gap-4">
          <Stat label={t('gallery.statProviders')} value="3" delta={t('gallery.statProvidersDelta')} tone="success" />
          <Stat label={t('gallery.statModels')} value="42" delta={t('gallery.statModelsDelta')} />
          <Stat label={t('gallery.statLatency')} value="820ms" delta={t('gallery.statLatencyDelta')} tone="warning" />
        </div>

        <Surface level="card" padding="loose">
          <div className="flex flex-col gap-2">
            <span className="text-caption text-muted-foreground">{t('gallery.fontUiLabel')}</span>
            <span data-font="ui" className="block font-ui text-body text-foreground">
              {t('gallery.fontUiSample')}
            </span>
            <span className="text-caption text-muted-foreground">{t('gallery.fontCodeLabel')}</span>
            <code data-font="code" className="block font-code text-body text-foreground">
              {t('gallery.fontCodeSample')}
            </code>
          </div>
        </Surface>

        <Surface level="card" padding="loose">
          <div className="flex flex-col gap-1">
            <span className="text-section font-semibold text-foreground">{t('gallery.noticeTitle')}</span>
            <span className="text-body text-muted-foreground">{t('gallery.noticeBody')}</span>
          </div>
        </Surface>
      </div>
    </div>
  );
}
