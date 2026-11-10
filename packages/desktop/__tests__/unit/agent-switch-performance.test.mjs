import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Agent 切换性能与 Profile 自动同步接线守卫。
 *
 * 【设计意图 (Why)】
 *   Agent 点击卡顿的根因是"切换时全量重建消息列表 + 同一次点击重复全量渲染"。
 *   这些改动分散在渲染热路径里，普通功能测试无法证明它们没有被顺手重构删掉，
 *   因此用源码接线断言锁住关键不变量：一旦回归，本文件立即变红。
 *
 * 【约束与规则 (Rules)】
 *   只断言"生产代码存在且形态正确"，不复制实现；断言必须能随代码删除/改错而失败。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');

const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8');

const rendererSource = read('packages/desktop/src/renderer/index.ts');
const profileRefreshSource = read('packages/desktop/src/renderer/profileRefresh.ts');
const messageListSource = read('packages/ui/src/components-react/conversation/ConversationMessageList.tsx');
const messageRowSource = read('packages/ui/src/components-react/conversation/MessageRow.tsx');
const leftRailSource = read('packages/ui/src/components-react/LeftRail.tsx');
const buildSource = read('packages/desktop/scripts/build.mjs');

test('Agent 切换 - 缓存命中路径不得重复全量 render', () => {
  const start = rendererSource.indexOf('const cachedSessionId = botForeverChatCache.get(botProfile);');
  assert.ok(start > -1, '未找到 openBotChat 的 Forever Chat 缓存分支');
  const end = rendererSource.indexOf('return;', start);
  const branch = rendererSource.slice(start, end + 8);
  assert.match(branch, /const alreadyMounted =/, '缺少同一会话已挂载判定');
  assert.match(branch, /if \(alreadyMounted\) \{[\s\S]*?render\(\);/, '补渲染必须受 alreadyMounted 保护');
  assert.doesNotMatch(branch, /void fetchModelOptions\([^)]*\);\s*render\(\);/, '禁止在 selectSession 之后无条件补 render');
});

test('Agent 切换 - 主工位预取不得被头像提前 return 跳过', () => {
  const start = rendererSource.indexOf('async function fetchProfiles(');
  const end = rendererSource.indexOf('async function warmBotForeverChats', start);
  assert.ok(start > -1 && end > start, '未找到 fetchProfiles / warmBotForeverChats');
  const fetchProfilesSource = rendererSource.slice(start, end);
  const fetchProfilesCode = fetchProfilesSource.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  assert.doesNotMatch(fetchProfilesCode, /if \(p\.avatar\) \{/, '头像分支不得提前 return 跳过主工位预取');
  assert.match(rendererSource, /void warmBotForeverChats\(list, client\);/, '必须对所有 profile 启动主工位预取');
  assert.match(rendererSource, /if \(botForeverChatCache\.has\(p\.name\)\) continue;/, '已预取的主工位必须跳过重复探测');
});

test('Agent 切换 - 消息列表必须按有界窗口挂载，且向下滚动耗尽后才请求服务端', () => {
  assert.match(rendererSource, /const INITIAL_RENDER_WINDOW = 24;/, '初始挂载窗口必须存在且保持小窗口');
  assert.match(rendererSource, /const RENDER_WINDOW_STEP = 40;/, '窗口扩展步长必须存在');
  assert.match(
    rendererSource,
    /const MESSAGE_WINDOW_CAPACITY = \d+;/,
    '必须有挂载容量硬上限，否则长会话回溯时挂载量随轮次增长'
  );
  assert.match(
    rendererSource,
    /state\.messages\.slice\(messageWindowStart, messageWindowEnd\)/,
    '对话快照必须取有界区间 slice(start, end)，禁止 slice(start) 开放区间'
  );
  assert.doesNotMatch(
    rendererSource,
    /state\.messages\.slice\(messageWindowStart\)/,
    '严禁保留开放区间切片：这正是挂载量只增不减的根因'
  );
  assert.match(rendererSource, /messageWindowSessionId !== state\.activeSessionId/, '切会话必须重置窗口');
  assert.match(rendererSource, /const expanded = expandMessageWindow\(\);/, '顶部滚动必须先尝试扩展本地窗口');
  assert.match(
    rendererSource,
    /slideMessageWindowForward\(\)/,
    '向下滚到窗口尾部必须整体前移窗口，否则读者会撞上空白'
  );
  assert.match(rendererSource, /applyStreamAnchor\(anchor, false\)/, '窗口扩展后必须重放滚动锚点');
});

test('Agent 切换 - 左轨与标题栏按内容缓存推送，禁止 JSON 全量序列化热路径', () => {
  assert.match(rendererSource, /function sameLeftRailInputs\(/, '缺少左轨输入引用比较');
  assert.match(rendererSource, /snapshot !== lastPushedLeftRailSnapshot/, '左轨必须按快照引用跳过未变化推送');
  assert.doesNotMatch(rendererSource, /snapshotFingerprint\(getLeftRailSnapshot\(\)\)/, '禁止对 89 个会话的快照做 JSON.stringify');
});

test('Agent 切换 - 消息行与左轨行必须 memo，knownFiles 必须保持引用稳定', () => {
  assert.match(messageRowSource, /export const MessageRow = React\.memo\(function MessageRow/, 'MessageRow 必须 memo');
  assert.match(messageListSource, /const knownFilesRef = React\.useRef/, 'knownFiles 必须有跨渲染缓存');
  assert.match(messageListSource, /tools\.every\(\(tool, index\) => tool === previous\.tools\[index\]\)/, 'knownFiles 必须按工具数组引用判断是否重算');
  assert.match(leftRailSource, /const SessionRow = React\.memo\(function SessionRow/, 'SessionRow 必须 memo');
  assert.match(leftRailSource, /const AgentStationItem = React\.memo\(function AgentStationItem/, 'AgentStationItem 必须 memo');
  assert.match(leftRailSource, /const GroupRow = React\.memo\(function GroupRow/, 'GroupRow 必须 memo');
});

test('Agent 切换 - 渲染层构建必须使用 React production', () => {
  assert.match(buildSource, /'process\.env\.NODE_ENV': JSON\.stringify\(process\.env\.NODE_ENV === 'development' \? 'development' : 'production'\)/, '渲染层构建必须定义 production NODE_ENV');
});

test('Profile 自动同步 - 定时刷新、可见性守卫与显示名收敛必须接线', () => {
  assert.match(rendererSource, /const PROFILE_REFRESH_INTERVAL_MS = 60_000;/, 'Profile 定时刷新周期必须存在');
  assert.match(rendererSource, /function startProfileAutoRefresh\(\): void/, '缺少定时刷新启动');
  assert.match(rendererSource, /function stopProfileAutoRefresh\(\): void/, '缺少定时刷新停止');
  assert.match(rendererSource, /document\.visibilityState === 'hidden'/, '页面不可见时必须跳过刷新');
  assert.match(profileRefreshSource, /export function profilesDiffer\(/, '缺少 Profile 关键字段差异比较');
  assert.match(rendererSource, /import \{ profilesDiffer \} from '\.\/profileRefresh\.js'/, '渲染层必须消费 Profile 差异比较');
  assert.match(rendererSource, /function syncSessionBotDisplayNames\(/, '服务端改名后必须收敛旧会话的 botDisplayName');
  assert.match(rendererSource, /startProfileAutoRefresh\(\);/, '连接成功后必须启动定时刷新');
  assert.match(rendererSource, /stopProfileAutoRefresh\(\);/, '断开连接时必须停止定时刷新');
});
