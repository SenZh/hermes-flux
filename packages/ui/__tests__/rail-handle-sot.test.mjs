/**
 * 拖拽把手几何单一真值源守卫（PR-3c）。
 *
 * 【设计意图 (Why)】左右把手的宽度与高亮只允许有一个定义处：styles.css 的
 *   --geo-resize-handle 与 .rail-resize-handle 规则。组件侧再写宽度/偏移/色值即分叉。
 * 【防范的历史坑 (Pitfall)】左把手曾在 React 写 Tailwind w-2/-right-1、右把手曾在模板内联
 *   6px/-3px，两套实现漂移成用户可见的 8px vs 3px 蓝带不对称（2026-11-04 像素级复现）。
 * 【约束与规则 (Rules)】高亮色必须经皮肤 Token 派生（color-mix + var(--primary)），
 *   禁止硬编码 rgba；把手必须完整落在各自轨道内。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const styles = read('packages/desktop/src/renderer/styles.css');
const leftRail = read('packages/ui/src/components-react/LeftRail.tsx');
const pod = read('packages/ui/src/components/InspectionPod/InspectionPod.ts');

test('把手真值源：styles.css 定义 --geo-resize-handle 且 .rail-resize-handle 消费它', () => {
  assert.ok(/--geo-resize-handle:\s*6px;/.test(styles), 'styles.css 必须定义 --geo-resize-handle: 6px');
  assert.ok(/\.rail-resize-handle\s*\{[^}]*width:\s*var\(--geo-resize-handle\);/.test(styles), '.rail-resize-handle 宽度必须来自 var(--geo-resize-handle) 且禁止回退值兜底（缺定义必须显式暴露而非静默漂移）');
});

test('移动端媒体查询内物理剥离把手（桌面专属残影控件红线）', () => {
  assert.ok(/@media \(max-width: 768px\)[\s\S]*?\.rail-resize-handle\s*\{[^}]*display:\s*none\s*!important;/.test(styles), '≤768px 下 .rail-resize-handle 必须 display:none——移动端宽度被媒体查询锁死，--rail-w-left 写入失效，保留即不可用控件');
});

test('把手高亮禁止硬编码色值，必须经皮肤 Token 派生', () => {
  const hoverBlock = styles.slice(styles.indexOf('.rail-resize-handle:hover'));
  const hoverRule = hoverBlock.slice(0, hoverBlock.indexOf('}') + 1);
  assert.ok(/color-mix\(in srgb,\s*var\(--primary\)/.test(hoverRule), 'hover 高亮必须用 color-mix(var(--primary))');
  assert.ok(!/rgba?\(/.test(hoverRule), 'hover 规则内禁止任何硬编码色值');
});

test('React 左把手禁止自带宽度/偏移类，且必须 right-0 完整落在轨道内', () => {
  const handleLine = leftRail.split('\n').find((line) => line.includes('data-rail-handle="left"'));
  assert.ok(handleLine, '左把手必须存在');
  assert.ok(!/\bw-/.test(handleLine) && !/\bbg-/.test(handleLine) && !/-right-\d/.test(handleLine), '左把手不得再写 Tailwind 宽度/背景/偏移类（w-*/bg-*/-right-*）');
  assert.ok(/right-0/.test(handleLine), '左把手必须 right-0，完整落在 aside 内');
});

test('滚动容器必须让出把手带（命中竞态守卫：全局滚动条 6px 与把手全量重叠会劫走滑块拖拽）', () => {
  for (const id of ['session-list-container']) {
    const line = leftRail.split('\n').find((l) => l.includes(id));
    assert.ok(line, `${id} 必须存在`);
    assert.ok(line.includes('mr-[var(--geo-resize-handle)]'), `${id} 必须 mr-[var(--geo-resize-handle)]，把滚动条移出把手命中带`);
  }
  // 项目甲板随微轨项目入口一并移除，其滚动容器不得残留（残留会重新引入把手命中竞态面）。
  assert.equal(leftRail.includes('rail-projects-deck'), false, '项目甲板滚动容器必须随入口一并删除');
});

test('模板右把手禁止内联宽度/负偏移/背景，必须 left-0 避开 overflow 裁剪', () => {
  const start = pod.indexOf('data-rail-handle="right"');
  const block = pod.slice(start, pod.indexOf('"></div>`', start));
  assert.ok(block, '右把手必须存在');
  assert.ok(!/left:\s*-/.test(block), '右把手禁止负 left 偏移（会被 pod overflow:hidden 裁半，历史坑 6px→3px）');
  assert.ok(!/width:/.test(block), '右把手禁止内联宽度，宽度归 --geo-resize-handle 真值源');
  assert.ok(!/background:/.test(block), '右把手禁止内联背景，高亮归皮肤 Token');
  assert.ok(/left:\s*0;/.test(block), '右把手必须 left:0，完整落在 pod 内');
});
