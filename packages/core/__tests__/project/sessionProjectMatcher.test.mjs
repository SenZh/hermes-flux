import test from 'node:test';
import assert from 'node:assert/strict';
import {
  doesSessionBelongToProject,
  normalizeFsPath,
} from '../../dist/project/sessionProjectMatcher.js';

test('sessionProjectMatcher Unit Tests - Multi-Quadrant & Mutation Proof', async (t) => {
  await t.test('1. normalizeFsPath 路径规范化：去除反斜杠、多余斜杠与大小写归一', () => {
    assert.equal(normalizeFsPath('D:\\Workspace\\Shop\\'), 'd:/workspace/shop');
    assert.equal(normalizeFsPath('///var//log///hermes///'), '/var/log/hermes');
    assert.equal(normalizeFsPath(''), '');
  });

  await t.test('2. 依据 projectId 强标识精准匹配', () => {
    const project = { id: 'proj-123', name: '商城系统' };
    const matchedSession = { id: 'sess-1', projectId: 'proj-123' };
    const unmatchedSession = { id: 'sess-2', projectId: 'proj-999' };

    assert.equal(doesSessionBelongToProject(matchedSession, project), true);
    assert.equal(doesSessionBelongToProject(unmatchedSession, project), false);
  });

  await t.test('3. 依据 projectName 大小写不敏感匹配', () => {
    const project = { id: 'proj-1', name: 'Commerce Hub' };
    const session = { id: 'sess-1', projectName: 'commerce hub' };
    const sessionDiff = { id: 'sess-2', projectName: 'Payment System' };

    assert.equal(doesSessionBelongToProject(session, project), true);
    assert.equal(doesSessionBelongToProject(sessionDiff, project), false);
  });

  await t.test('4. 依据 Windows/UNIX 文件工作区路径前缀与子目录层级匹配', () => {
    const project = { id: 'proj-1', name: '后端系统', path: 'D:\\workspace\\project-alpha' };

    // 4.1 完全相等的目录
    assert.equal(
      doesSessionBelongToProject({ id: 's1', cwd: 'd:/workspace/project-alpha' }, project),
      true
    );

    // 4.2 子目录层级
    assert.equal(
      doesSessionBelongToProject({ id: 's2', cwd: 'D:\\workspace\\project-alpha\\src\\services' }, project),
      true
    );

    // 4.3 仅仅是名称相似但非同级子目录（防范前缀误伤）
    assert.equal(
      doesSessionBelongToProject({ id: 's3', cwd: 'D:\\workspace\\project-alpha-extra' }, project),
      false
    );
  });

  await t.test('5. 极限边界：空对象、缺失字段等防御性降级', () => {
    assert.equal(doesSessionBelongToProject(null, { id: 'p', name: 'n' }), false);
    assert.equal(doesSessionBelongToProject({ id: 's' }, null), false);
    assert.equal(doesSessionBelongToProject({ id: 's' }, { id: 'p', name: 'n' }), false);
  });
});
