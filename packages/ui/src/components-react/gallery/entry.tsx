/*
 * Gallery 审查入口（仅人工打开用，不进入生产挂载点）。
 *
 * 设计意图(Why)：
 *   给截图审查提供一条最小启动路径：宿主 HTML 只需一个 #root，本文件负责 createRoot 并渲染样例页。
 *   之所以不放进 mount-shell-components，是因为样例页一旦接入生产挂载点就会被真实数据与布局争抢宿主。
 *
 * 防范的历史坑(Pitfall)：
 *   直接写 `document.getElementById('root')!` 会引入非空断言，一旦宿主 id 改名，
 *   运行时报的是"Cannot read properties of null (reading 'render')"这种与根因无关的错误；
 *   这里改为显式判空，宿主缺失时什么也不做，问题停在"有没有 #root"这一层。
 *
 * 约束与规则(Rules)：
 *   1. 本文件不是库导出，禁止被 src/index.ts 或任何 mount-* 引用；
 *   2. 只允许一次 createRoot，禁止在渲染中重复创建。
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Gallery } from './Gallery.js';

const host = document.getElementById('root');
if (host) {
  createRoot(host).render(<Gallery />);
}
