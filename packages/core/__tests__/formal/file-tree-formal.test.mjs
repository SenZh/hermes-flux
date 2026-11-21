/**
 * 工作区文件树纯数学模型形式化不变量证明 (packages/core/__tests__/formal/file-tree-formal.test.mjs)
 *
 * 守卫 docs/invariants.json 中的 INV-FS-01 ~ INV-FS-04：
 *   - INV-FS-01: sortFileTreeNodes 目录严格前置、同类按码点单调且幂等（不改变原数组）；
 *   - INV-FS-02: buildTreeFromFlatPaths 路径守恒、同路径去重且二次重建强幂等；
 *   - INV-FS-03: mergeDirectoryChildren 仅更新目标目录节点，非目标子树零扰动且幂等；
 *   - INV-FS-04: filterFileTree 过滤查询空串原样保留，非空过滤命中节点必携带全部祖先且保留子树一致性。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  sortFileTreeNodes,
  buildTreeFromFlatPaths,
  mergeDirectoryChildren,
  filterFileTree,
  evaluateFilePreviewGuard,
  MAX_PREVIEW_FILE_BYTES,
  MAX_PREVIEW_IMAGE_BYTES,
} from '../../dist/index.js';

function collectLeafPaths(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.isDirectory) {
      if (n.children && n.children.length > 0) {
        out.push(...collectLeafPaths(n.children));
      } else {
        out.push(`${n.path}/`);
      }
    } else {
      out.push(n.path);
    }
  }
  return out;
}

function findNodeByPath(nodes, target) {
  for (const n of nodes) {
    if (n.path === target) return n;
    if (n.children) {
      const hit = findNodeByPath(n.children, target);
      if (hit) return hit;
    }
  }
  return undefined;
}

function assertOrderedAndDirFirst(nodes) {
  let seenFile = false;
  for (let i = 0; i < nodes.length; i += 1) {
    const cur = nodes[i];
    if (!cur.isDirectory) seenFile = true;
    else if (seenFile) assert.fail(`文件之前之后禁止再出现目录: ${cur.path}`);

    if (i > 0) {
      const prev = nodes[i - 1];
      if (prev.isDirectory === cur.isDirectory) {
        assert.ok(
          prev.name <= cur.name,
          `同类节点必须按码点单调递增: "${prev.name}" <= "${cur.name}"`,
        );
      }
    }
    if (cur.children) assertOrderedAndDirFirst(cur.children);
  }
}

test('Formal Invariant Verifier: Workspace File Tree Pure Model', async (t) => {
  const segmentArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,8}$/);
  const flatPathArb = fc
    .tuple(fc.array(segmentArb, { minLength: 1, maxLength: 4 }), fc.boolean())
    .map(([segs, isDir]) => segs.join('/') + (isDir ? '/' : ''));

  const leafNodeArb = fc.record({
    name: segmentArb,
    path: fc.tuple(segmentArb, segmentArb).map(([a, b]) => `/ws/${a}/${b}`),
    isDirectory: fc.boolean(),
  });

  await t.test('INV-FS-01: sortFileTreeNodes 目录优先、同类全序且幂等', () => {
    fc.assert(
      fc.property(fc.array(leafNodeArb, { maxLength: 30 }), (nodes) => {
        const snapshot = JSON.stringify(nodes);
        const once = sortFileTreeNodes(nodes);
        const twice = sortFileTreeNodes(once);
        assert.equal(JSON.stringify(nodes), snapshot, '排序不得修改输入原数组');
        assertOrderedAndDirFirst(once);
        assert.deepEqual(twice, once, 'sortFileTreeNodes 必须满足幂等性');
      }),
      { numRuns: 500 },
    );
  });

  await t.test('INV-FS-02: buildTreeFromFlatPaths 路径守恒、去重收敛与有序', () => {
    fc.assert(
      fc.property(fc.array(flatPathArb, { maxLength: 25 }), (paths) => {
        const tree1 = buildTreeFromFlatPaths(paths, '/ws');
        const tree2 = buildTreeFromFlatPaths([...paths, ...paths], '/ws');
        assertOrderedAndDirFirst(tree1);
        assert.deepEqual(tree2, tree1, '重复输入同一批路径建树必须强幂等');
        assert.deepEqual(
          buildTreeFromFlatPaths(collectLeafPaths(tree1), '/ws'),
          tree1,
          '由树提取出的叶路径再次建树必须还原同构树',
        );
      }),
      { numRuns: 400 },
    );
  });

  await t.test('INV-FS-03: mergeDirectoryChildren 仅替换目标目录并保持非目标子树与幂等性', () => {
    fc.assert(
      fc.property(
        fc.array(flatPathArb, { minLength: 2, maxLength: 20 }),
        fc.array(segmentArb, { minLength: 1, maxLength: 6 }),
        (paths, childNames) => {
          const base = buildTreeFromFlatPaths(paths, '/ws');
          const dirs = [];
          for (const node of base) {
            if (node.isDirectory) dirs.push(node);
          }
          if (dirs.length === 0) return;

          const targetDir = dirs[0];
          const newChildren = childNames.map((name) => ({
            name,
            path: `${targetDir.path}/${name}`,
            isDirectory: false,
          }));

          const mergedOnce = mergeDirectoryChildren(base, targetDir.path, newChildren);
          const mergedTwice = mergeDirectoryChildren(mergedOnce, targetDir.path, newChildren);
          assert.deepEqual(mergedTwice, mergedOnce, '同一子集重复 merge 必须幂等');

          const updatedTarget = findNodeByPath(mergedOnce, targetDir.path);
          assert.equal(updatedTarget?.childrenLoaded, true, '目标目录必须标记 childrenLoaded: true');
          for (const other of dirs.slice(1)) {
            assert.deepEqual(
              findNodeByPath(mergedOnce, other.path),
              other,
              '非目标兄弟子树必须原封不动',
            );
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  await t.test('INV-FS-04: filterFileTree 空查询恒等且非空过滤所有节点均可回溯命中关键字', () => {
    const verifyFiltered = (nodes, q) => {
      for (const n of nodes) {
        const selfMatch =
          n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q);
        if (n.isDirectory) {
          if (!selfMatch) {
            assert.ok(
              Array.isArray(n.children) && n.children.length > 0,
              `未自命中的保留祖先目录 ${n.path} 必须至少携带一个匹配子孙`,
            );
            verifyFiltered(n.children, q);
          }
        } else {
          assert.ok(selfMatch, `保留的文件叶节点 ${n.path} 必须匹配关键字 ${q}`);
        }
      }
    };

    fc.assert(
      fc.property(
        fc.array(flatPathArb, { maxLength: 25 }),
        fc.stringMatching(/^[a-zA-Z0-9_-]{0,4}$/),
        (paths, rawQ) => {
          const tree = buildTreeFromFlatPaths(paths, '/ws');
          assert.deepEqual(filterFileTree(tree, ''), tree, '空查询必须原样返回');
          assert.deepEqual(filterFileTree(tree, '   '), tree, '纯空白查询必须原样返回');

          const q = rawQ.trim().toLowerCase();
          if (!q) return;
          const filtered = filterFileTree(tree, q);
          verifyFiltered(filtered, q);
        },
      ),
      { numRuns: 400 },
    );
  });

  await t.test('INV-FS-05: evaluateFilePreviewGuard 二进制阻断恒优先且单调、图片不受误杀', () => {
    const binaryExtArb = fc.constantFrom('exe', 'dll', 'so', 'zip', 'pdf', 'wasm', 'bin', '7z', 'db');
    const imageExtArb = fc.constantFrom('png', 'jpg', 'jpeg', 'gif', 'webp', 'svg');
    const textExtArb = fc.constantFrom('ts', 'md', 'json', 'py', 'txt', 'log');

    fc.assert(
      fc.property(
        binaryExtArb,
        fc.integer({ min: 0, max: 50_000_000 }),
        fc.boolean(),
        (ext, byteSize, truncated) => {
          const res = evaluateFilePreviewGuard({
            filePath: `/workspace/artifact.${ext}`,
            isImage: false,
            byteSize,
            serverTruncated: truncated,
          });
          assert.equal(res.status, 'binary', '二进制扩展名无论体积大小都必须裁定为 binary');
        },
      ),
      { numRuns: 300 },
    );

    fc.assert(
      fc.property(
        textExtArb,
        fc.integer({ min: 0, max: 5_000_000 }),
        (ext, byteSize) => {
          const res = evaluateFilePreviewGuard({
            filePath: `/workspace/file.${ext}`,
            isImage: false,
            byteSize,
          });
          if (byteSize > MAX_PREVIEW_FILE_BYTES) {
            assert.equal(res.status, 'too_large');
          } else {
            assert.equal(res.status, 'ok');
          }
        },
      ),
      { numRuns: 300 },
    );

    fc.assert(
      fc.property(
        imageExtArb,
        fc.integer({ min: 0, max: 20_000_000 }),
        (ext, byteSize) => {
          const res = evaluateFilePreviewGuard({
            filePath: `/workspace/photo.${ext}`,
            isImage: true,
            byteSize,
          });
          assert.notEqual(res.status, 'binary', '合法图片扩展名绝不可被误判为不可预览二进制');
          if (byteSize > MAX_PREVIEW_IMAGE_BYTES) {
            assert.equal(res.status, 'too_large');
          } else {
            assert.equal(res.status, 'ok');
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
