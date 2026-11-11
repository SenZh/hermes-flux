import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * 模型选择器交互接线守卫 (Model Picker Interaction Wiring Guard)
 *
 * 【设计意图 (Why)】
 *   「分组可折叠」「悬停出行思考级联」「点空白收起」三件事的**渲染产物**已由 ui 单测锁定，
 *   但真正让它们生效的是 renderer 里的事件绑定与状态传递。删掉其中任意一行，
 *   ui 测试依然全绿，而用户侧表现为「点了没反应」——正是这次要修的 bug 形态。
 *
 * 【约束与规则 (Rules)】
 *   只读源码文本、不执行渲染；按「调用块」而不是「全文包含」断言，
 *   防止未来新增合法调用点被误判。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererSource = readFileSync(path.resolve(__dirname, '../../src/renderer/index.ts'), 'utf8');

/** 取某个调用（如 `renderInputDock({`）的整段实参块。 */
function callBlocks(marker) {
  const blocks = [];
  let from = 0;
  for (;;) {
    const start = rendererSource.indexOf(marker, from);
    if (start < 0) break;
    let depth = 0;
    let end = start;
    for (let i = start + marker.length - 1; i < rendererSource.length; i += 1) {
      const ch = rendererSource[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    blocks.push(rendererSource.slice(start, end + 1));
    from = end + 1;
  }
  return blocks;
}

test('模型选择器交互接线守卫', async (t) => {
  await t.test('1. 折叠状态必须一路传给渲染层', () => {
    for (const [marker, label] of [
      ['renderInputDock({', 'renderInputDock'],
      ['renderModelPickerTree({', 'renderModelPickerTree'],
    ]) {
      const blocks = callBlocks(marker);
      assert.ok(blocks.length >= 1, `${label} 至少一个调用点`);
      blocks.forEach((block, index) => {
        assert.ok(
          block.includes('collapsedProviders: state.collapsedProviders'),
          `第 ${index + 1} 个 ${label} 调用必须传 collapsedProviders（否则折叠状态永远是空的）`,
        );
      });
    }
  });

  await t.test('2. 分组标题点击必须绑定折叠切换', () => {
    assert.ok(
      rendererSource.includes(".querySelectorAll('.model-provider-group-header')"),
      '必须查询分组标题并绑定点击',
    );
    assert.ok(
      rendererSource.includes('state.collapsedProviders.splice') &&
        rendererSource.includes('state.collapsedProviders.push'),
      '折叠切换必须真正改写 state.collapsedProviders',
    );
    assert.ok(
      rendererSource.includes('updateModelDropdownSubtree()'),
      '折叠必须走列表子树重建，而不是整舱 render（否则搜索框失焦）',
    );
  });

  await t.test('3. 模型行悬停必须驱动二级级联', () => {
    assert.ok(rendererSource.includes('el.onmouseenter = () => {'), '行悬停必须绑定');
    assert.ok(rendererSource.includes('showModelCascade(el)'), '悬停必须调用定位函数');
    assert.ok(rendererSource.includes("getElementById('model-reasoning-cascade')"), '必须锚定级联面板');
    assert.ok(rendererSource.includes('model-cascade--flip'), '右侧空间不足时必须能翻到左侧');
  });

  await t.test('4. 点空白收起必须走 capture 阶段且白名单完整', () => {
    const pointerdownAt = rendererSource.indexOf("'pointerdown'");
    assert.ok(pointerdownAt > 0, '必须存在 pointerdown 监听');
    const pointerdown = rendererSource.slice(
      rendererSource.lastIndexOf('document.addEventListener', pointerdownAt),
      rendererSource.indexOf("document.addEventListener('mousedown'", pointerdownAt),
    );
    // 【精确匹配】不能用 includes('true,')：注释里随便写一个 true, 就能骗过断言
    assert.match(pointerdown, /\}\s*,\s*true\s*,?\s*\)/, '必须在 capture 阶段注册（冒泡会被行内 stopPropagation 掐断）');
    for (const id of ['dock-model-dropdown', 'dock-model-selector-btn', 'model-reasoning-cascade']) {
      assert.ok(pointerdown.includes(`getElementById('${id}')`), `白名单必须包含 ${id}`);
    }
    assert.ok(
      !rendererSource.includes("document.querySelector('.pill-dropdown-wrapper')"),
      '旧的白名单选择器必须删除：只取第一个 wrapper 会误判菜单内外',
    );
  });

  await t.test('5. 输入舱 footer 不得再保留思考下拉绑定', () => {
    assert.ok(!rendererSource.includes('dock-reasoning-toggle-btn'), '旧思考按钮绑定必须移除');
    assert.ok(!rendererSource.includes('dock-reasoning-dropdown'), '旧思考下拉引用必须移除');
  });

  await t.test('6. 键盘路径：行聚焦唤醒级联、级联项可聚焦、Esc 回退', () => {
    // 【精确断言】必须验证 onfocus 的**函数体**真的唤醒级联：
    // 只查 `el.onfocus = () => {` 存在，把函数体掏空同样能通过（假绿）。
    const focusBlock = rendererSource.slice(
      rendererSource.indexOf('el.onfocus = () => {'),
      rendererSource.indexOf('el.onblur = () => {'),
    );
    assert.ok(focusBlock.length > 0, '模型行必须有 onfocus');
    assert.ok(focusBlock.includes('showModelCascade(el)'), 'onfocus 函数体必须真正唤醒级联');
    assert.ok(rendererSource.includes('el.onkeydown = (e) => {'), '模型行必须有键盘导航');
    const arrowRightBlock = rendererSource.slice(
      rendererSource.indexOf("if (e.key === 'ArrowRight')"),
      rendererSource.indexOf("if (e.key === 'Enter' || e.key === ' ')"),
    );
    assert.ok(arrowRightBlock.includes("el.dataset.locked === 'true'"), 'ArrowRight 必须拦截锁定行');
    assert.ok(arrowRightBlock.includes('cascadeSuppressUntil = 0'), '主动按 → 展开不能被之前的抑制窗口拦住');
    const pickBlock = rendererSource.slice(
      rendererSource.indexOf('function pickReasoningLevel'),
      rendererSource.indexOf('function scheduleHideModelCascade'),
    );
    assert.ok(pickBlock.length > 0, '点击与键盘必须共用同一应用路径 pickReasoningLevel');
    assert.ok(pickBlock.includes('LEVELS.has(raw)'), 'data-level 必须过白名单再断言类型，禁止裸 as');

    // 级联内部键盘导航（↑↓ Home End 与 Esc/← 退回原行）必须真实存在，不能只测首次进入
    const cascadeKeyStart = rendererSource.indexOf("const items = [...cascade.querySelectorAll<HTMLElement>('.model-cascade__item')]");
    const cascadeKeyEnd = rendererSource.indexOf('function pickReasoningLevel');
    const cascadeKbBlock = rendererSource.slice(cascadeKeyStart, cascadeKeyEnd);
    assert.ok(cascadeKbBlock.length > 0, '必须存在级联项键盘导航块');
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape', 'ArrowLeft']) {
      assert.ok(cascadeKbBlock.includes(`'${key}'`), `级联导航缺失按键 ${key}`);
    }
    assert.ok(cascadeKbBlock.includes('cascadeSuppressUntil'), 'Esc 退回原行必须开启抑制窗口，否则会触发 onfocus 立刻重弹');
  });

  await t.test('7. 级联定位必须做垂直夹取，避免短视口末尾档位点不到', () => {
    const showBlock = rendererSource.slice(
      rendererSource.indexOf('function showModelCascade'),
      rendererSource.indexOf('function updateModelDropdownSubtree'),
    );
    assert.ok(showBlock.includes('window.innerHeight'), '必须读取视口高度');
    assert.ok(showBlock.includes('Math.min(Math.max('), '必须对 top 做 clamp');
    assert.ok(showBlock.includes('viewportBottom'), '必须按视口底部夹取');
    assert.ok(showBlock.includes('model-cascade--inset'), '双侧空间不足时必须切到内缩模式防水平溢出');
  });

  await t.test('8. 列表滚动必须收起级联，避免面板与行错位', () => {
    const at = rendererSource.indexOf(".addEventListener('scroll'");
    assert.ok(at > 0, '滚动容器必须绑定 scroll');
    assert.ok(
      rendererSource.slice(at, at + 300).includes('hideModelCascade'),
      '滚动时必须收起（面板不在滚动容器内，无法跟随）',
    );
  });

  await t.test('9. 打开下拉必须先清空搜索词，避免看到上一次过滤后的残缺列表', () => {
    const openBlock = rendererSource.slice(
      rendererSource.indexOf('modelBtn.onclick'),
      rendererSource.indexOf('// Bind dropdown options'),
    );
    assert.ok(openBlock.includes('resetModelSearchOnOpen()'), '打开时必须无条件调用 resetModelSearchOnOpen()');
    // 【行为化】清空逻辑必须落在独立函数里，且函数体真的清空并重建——
    // 文本存在不等于执行可达：`if (false) { state.modelSearchQuery = '' }` 同样含这段文本。
    const fnBlock = rendererSource.slice(
      rendererSource.indexOf('function resetModelSearchOnOpen'),
      rendererSource.indexOf('function showModelCascade'),
    );
    assert.ok(fnBlock.length > 0, '必须存在 resetModelSearchOnOpen');
    assert.ok(fnBlock.includes("state.modelSearchQuery = ''"), '函数体必须清空搜索词');
    assert.ok(fnBlock.includes('lastInputDockSnapshot'), '清空搜索词时必须对齐 inputDock 快照，否则下次 render 会整舱重建');
    assert.ok(fnBlock.includes('updateModelDropdownSubtree()'), '函数体必须重建列表子树');
    assert.ok(
      !/if\s*\(\s*state\.modelSearchQuery\s*\)/.test(fnBlock),
      '清空逻辑不得挂在 if (state.modelSearchQuery) 里——条件为假时整段跳过',
    );
  });

  await t.test('10. 选完等级必须把焦点还给原模型行（键盘用户不得掉回 body）', () => {
    const pickBlock = rendererSource.slice(
      rendererSource.indexOf('function pickReasoningLevel'),
      rendererSource.indexOf('function resetModelSearchOnOpen'),
    );
    assert.ok(pickBlock.length > 0);
    assert.ok(pickBlock.includes('returnToModel'), '必须记下原行');
    assert.ok(pickBlock.includes('.focus({ preventScroll: true })'), '必须把焦点还回该行');
    assert.ok(!pickBlock.includes('.blur('), '禁止 blur 到 body：那会让 Tab 序从头开始');
  });

  await t.test('11. 打开/关闭必须同步 aria-expanded 与 lastInputDockSnapshot.modelMenuOpen', () => {
    const openBlock = rendererSource.slice(
      rendererSource.indexOf('modelBtn.onclick'),
      rendererSource.indexOf('// Bind dropdown options'),
    );
    assert.ok(openBlock.includes("modelBtn.setAttribute('aria-expanded'"), '点击打开/关闭必须实时同步 aria-expanded');
    assert.ok(openBlock.includes('modelMenuOpen: state.modelMenuOpen'), '直写 DOM 打开时必须同步对齐 lastInputDockSnapshot.modelMenuOpen，否则不选模型直接点空白无法收起');

    const closeBlock = rendererSource.slice(
      rendererSource.indexOf('function closeModelMenu'),
      rendererSource.indexOf('function updateModelDropdownSubtree'),
    );
    assert.ok(closeBlock.includes('hideModelCascade()'), 'closeModelMenu 必须收起级联');
    assert.ok(closeBlock.includes("dropdown.style.display = 'none'"), 'closeModelMenu 必须直写 DOM display: none 兜底');
    assert.ok(closeBlock.includes("trigger.setAttribute('aria-expanded', 'false')"), 'closeModelMenu 必须同步 aria-expanded=false');

    const pointerdownAt = rendererSource.indexOf("'pointerdown'");
    const pointerdown = rendererSource.slice(
      rendererSource.lastIndexOf('document.addEventListener', pointerdownAt),
      rendererSource.indexOf("document.addEventListener('mousedown'", pointerdownAt),
    );
    assert.ok(pointerdown.includes('closeModelMenu()'), '点空白必须走 closeModelMenu()');
    const escBlock = rendererSource.slice(
      rendererSource.indexOf("if (e.key === 'Escape')"),
      rendererSource.indexOf("if (e.key === 'Enter' && state.confirmModal)"),
    );
    assert.ok(escBlock.includes('closeModelMenu()'), 'Escape 必须走 closeModelMenu()');
  });
});
