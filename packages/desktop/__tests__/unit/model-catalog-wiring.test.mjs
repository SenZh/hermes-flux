import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * 模型目录接线级源码守卫 (Model Catalog Wiring Guard)
 *
 * 【设计意图 (Why)】
 *   `resolveModelPickerRows` / `modelLabelFromCatalog` 的纯函数行为已由 ui/core 单测证明，
 *   但「renderer 是否真的把目录接进渲染链」「不可用模型是否真的被点击拦截」
 *   属于接线问题：删掉对应一行，纯函数测试依然全绿。
 *   本守卫对源码做结构性断言，让这两条接线被摘除时必然变红。
 *
 * 【防范的历史坑 (Pitfall)】
 *   上一轮真实缺陷：输入舱主标签算出了 `modelLabel` 却仍渲染 `props.selectedModel`，
 *   纯函数测试全部通过、用户看到的仍是裸 ID。同类问题还包括
 *   「失败分支不清陈旧目录」——旧目录继续可点，切过去必然失败。
 *
 * 【约束与规则 (Rules)】
 *   只读源码文本、不执行；断言精确到调用点数量与相邻语句，禁止放宽为"包含即可"。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererSource = readFileSync(path.resolve(__dirname, '../../src/renderer/index.ts'), 'utf8');

test('模型目录接线源码守卫', async (t) => {
  const count = (re) => (rendererSource.match(re) || []).length;

  await t.test('1. 输入舱与选择器必须把 modelCatalog / currentProvider 一路传下去', () => {
    // 【规则】断言"每个渲染调用块内都传了"，而不是"全文件恰好 N 处"——
    // 精确计数会对未来新增合法调用点误报，属脆弱断言。
    const renderCallBlocks = (fnName) => {
      const blocks = [];
      const marker = `${fnName}({`;
      let from = 0;
      for (;;) {
        const start = rendererSource.indexOf(marker, from);
        if (start < 0) break;
        // 取到配平后的第一个 `})` 为止（这些调用点都是单层对象字面量）
        const end = rendererSource.indexOf('})', start);
        blocks.push(rendererSource.slice(start, end + 2));
        from = end + 2;
      }
      return blocks;
    };

    const dockBlocks = renderCallBlocks('renderInputDock');
    const treeBlocks = renderCallBlocks('renderModelPickerTree');

    assert.ok(dockBlocks.length >= 2, `renderInputDock 至少 2 个调用点，实得 ${dockBlocks.length}`);
    assert.ok(treeBlocks.length >= 1, `renderModelPickerTree 至少 1 个调用点，实得 ${treeBlocks.length}`);

    for (const [index, block] of dockBlocks.entries()) {
      assert.ok(block.includes('modelCatalog: state.modelCatalog'), `第 ${index + 1} 个 renderInputDock 调用必须传 modelCatalog`);
      assert.ok(block.includes('currentProvider: state.currentProvider'), `第 ${index + 1} 个 renderInputDock 调用必须传 currentProvider`);
    }
    for (const [index, block] of treeBlocks.entries()) {
      assert.ok(block.includes('modelCatalog: state.modelCatalog'), `第 ${index + 1} 个 renderModelPickerTree 调用必须传 modelCatalog`);
      assert.ok(block.includes('currentProvider: state.currentProvider'), `第 ${index + 1} 个 renderModelPickerTree 调用必须传 currentProvider`);
    }
  });

  await t.test('2. 拉取成功后必须同时写入目录与目录指纹', () => {
    assert.ok(
      /state\.modelCatalog = catalog\.entries;[\s\S]{0,400}?state\.modelCatalogHash =/.test(rendererSource),
      '目录赋值后必须紧随指纹赋值（否则显示名变化不会触发重绘）',
    );
    assert.ok(
      /state\.modelCatalogHash = modelCatalogFingerprint\(catalog\.entries\);/.test(rendererSource),
      '指纹必须由 core 的 modelCatalogFingerprint 计算（覆盖 unavailable/quant/context 等全部渲染字段），禁止在此手写子集',
    );
  });

  await t.test('3. 两个失败分支都必须同时清空目录与指纹（禁止陈旧目录静默存活）', () => {
    // 分支 A：未连接网关
    assert.ok(
      /if \(!gatewayClient\)[\s\S]{0,400}?state\.modelCatalog = \[\];[\s\S]{0,200}?state\.modelCatalogHash = '';/.test(
        rendererSource,
      ),
      '!gatewayClient 分支必须清空 modelCatalog 与 modelCatalogHash',
    );
    // 分支 B：拉取失败
    assert.ok(
      /if \(!catalog\.ok\)[\s\S]{0,700}?state\.modelCatalog = \[\];[\s\S]{0,300}?state\.modelCatalogHash = '';/.test(
        rendererSource,
      ),
      '拉取失败分支必须清空 modelCatalog 与 modelCatalogHash',
    );
  });

  await t.test('4. 不可用模型必须在校点击前被拦截（data-locked 早退）', () => {
    assert.ok(
      /dataset\.locked === 'true'\)\s*return;/.test(rendererSource),
      '点击处理器必须对 data-locked="true" 提前 return',
    );
    const handlerStart = rendererSource.indexOf("querySelectorAll('.model-option')");
    assert.ok(handlerStart > 0, '必须存在模型行点击绑定');
    const handlerRegion = rendererSource.slice(handlerStart, handlerStart + 900);
    assert.ok(handlerRegion.includes("dataset.locked === 'true'"), '早退必须位于该处理器内，不是别处同名代码');
    assert.ok(
      handlerRegion.indexOf("dataset.locked === 'true'") < handlerRegion.indexOf('void switchModel('),
      '早退必须发生在 switchModel 之前',
    );
  });
});
