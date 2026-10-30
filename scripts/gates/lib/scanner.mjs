/**
 * Hermes Flux Quality Gate - 源文件扫描基础设施
 *
 * 设计意图 (Why):
 *   所有门禁（架构 / 换肤 / i18n / 性能）都建立在同一套「源码行视图」之上：
 *   必须先剥离注释，才能避免把文档里的 `// 例如 #FF0000` 误判为死色值；
 *   但字符串字面量（含 TS 模板字符串内的 HTML/CSS）必须原样保留，
 *   因为组件把样式与文案写在模板字符串里，那正是门禁要抓的目标。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 用正则 `//.*` 粗暴删注释会把 `http://` / `https://` 之后的半行代码全部吞掉，
 *      导致 URL 后面的硬编码文案/色值漏检 -> 必须用状态机区分字符串态与代码态。
 *   2. 剥离注释时若不保留换行符，行号会整体错位，报告出来的 file:line 全部指向错误位置。
 *   3. Windows 下路径分隔符为 `\`，报告中必须统一成 `/` 才能与 git 输出、baseline 键对齐。
 *
 * 约束与规则 (Rules):
 *   - 本模块为纯函数 + 只读文件系统访问，不产生任何副作用写入。
 *   - 不得依赖任何第三方包（门禁必须在干净 environment 下可运行）。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根目录（scripts/gates/lib -> repo root 共 3 层） */
export const REPO_ROOT = path.resolve(HERE, '../../..');

/** 统一成 POSIX 风格的仓库相对路径，保证跨平台与 git 输出一致 */
export function toRel(absPath) {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
}

/**
 * 递归收集目录下的源码文件。
 * @param {string} relDir 仓库相对目录
 * @param {{exts?: string[], ignoreDirs?: string[]}} [opts]
 * @returns {string[]} 仓库相对路径数组
 */
export function listSourceFiles(relDir, opts = {}) {
  const exts = opts.exts ?? ['.ts', '.tsx', '.js', '.mjs'];
  const ignoreDirs = new Set(opts.ignoreDirs ?? ['node_modules', 'dist', 'release', 'build', 'coverage', '__tests__', 'preview']);
  const absDir = path.join(REPO_ROOT, relDir);
  const out = [];

  if (!fs.existsSync(absDir)) return out;

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (ignoreDirs.has(entry.name)) continue;
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith('.d.ts') || entry.name.endsWith('.d.mts')) continue;
      if (!exts.some((ext) => entry.name.endsWith(ext))) continue;
      out.push(toRel(abs));
    }
  };

  walk(absDir);
  return out.sort();
}

/**
 * 状态机剥离注释，保留字符串字面量与换行位置。
 *
 * 关键不变量：返回值 length 与输入完全一致，且所有 `\n` 位置不变。
 * 因此 `lineOf(src, stripped, index)` 可以直接用同一 index 映射回原始源码行号。
 *
 * @param {string} src
 * @returns {{ stripped: string, codeLines: string[], rawLines: string[] }}
 */
export function stripComments(src) {
  const n = src.length;
  const buf = new Array(n);
  /**
   * 状态栈：注释剥离可能发生在「代码态」也可能发生在「模板字符串态」，
   * 必须记住进入注释前的状态，退出时精确还原。
   * 否则 HTML 注释 `<!-- -->` 结束后会错误地回到代码态，
   * 导致后续模板内容被当作 JS 解析、甚至吞掉整段源码。
   */
  const stack = [];
  let state = 'code'; // code | line | block | single | double | template | htmlComment | interpolation
  let escaped = false;

  /**
   * 插值表达式的大括号深度栈。
   * `\`${ {a:1} }\`` 这类写法里插值内部自身可能含 `{}`，
   * 因此必须精确配平大括号，不能见到第一个 `}` 就退出插值态。
   */
  const interpDepths = [];

  const enter = (nextState) => {
    stack.push(state);
    state = nextState;
  };
  const leave = () => {
    state = stack.length > 0 ? stack.pop() : 'code';
  };

  for (let i = 0; i < n; i++) {
    const c = src[i];
    const next = src[i + 1];

    if (state === 'interpolation') {
      // 插值内部是真实 JS：注释、字符串、嵌套模板都必须按代码语义解析。
      if (c === '/' && next === '/') {
        buf[i] = ' ';
        buf[i + 1] = ' ';
        i += 1;
        enter('line');
        continue;
      }
      if (c === '/' && next === '*') {
        buf[i] = ' ';
        buf[i + 1] = ' ';
        i += 1;
        enter('block');
        continue;
      }
      if (c === "'") {
        enter('single');
        buf[i] = c;
        continue;
      }
      if (c === '"') {
        enter('double');
        buf[i] = c;
        continue;
      }
      if (c === '`') {
        enter('template');
        buf[i] = c;
        continue;
      }
      if (c === '{') {
        interpDepths[interpDepths.length - 1] += 1;
        buf[i] = c;
        continue;
      }
      if (c === '}') {
        if (interpDepths[interpDepths.length - 1] === 0) {
          buf[i] = c;
          interpDepths.pop();
          leave();
        } else {
          interpDepths[interpDepths.length - 1] -= 1;
          buf[i] = c;
        }
        continue;
      }
      buf[i] = c;
      continue;
    }

    if (state === 'line') {
      if (c === '\n') {
        leave();
        buf[i] = '\n';
      } else {
        buf[i] = ' ';
      }
      continue;
    }

    if (state === 'block') {
      if (c === '*' && next === '/') {
        buf[i] = ' ';
        buf[i + 1] = ' ';
        i += 1;
        leave();
      } else {
        buf[i] = c === '\n' ? '\n' : ' ';
      }
      continue;
    }

    if (state === 'single' || state === 'double' || state === 'template') {
      // 模板字符串内嵌的是 HTML/CSS/JS 片段，其中的注释同样不是有效代码，
      // 必须在字符串态内单独遮蔽，否则「<!-- 思考下拉菜单 -->」会被误判为硬编码文案。
      if (state === 'template' && !escaped) {
        // 关键：`${ ... }` 是插值表达式，其内部是**真实 JS 代码**，可能再嵌套模板字符串。
        // 若不进入 code 态，内层反引号会被误当作外层闭合，导致整段源码被吞、
        // 状态栈永久失衡（实测 MiddlePod.ts 失衡后 27 处行注释泄漏为代码）。
        if (c === '$' && next === '{') {
          buf[i] = c;
          buf[i + 1] = next;
          i += 1;
          interpDepths.push(0);
          enter('interpolation');
          continue;
        }
        if (c === '/' && next === '*') {
          buf[i] = ' ';
          buf[i + 1] = ' ';
          i += 1;
          enter('block');
          continue;
        }
        // 注意：模板态里的 `//` 是**字面文本**（常见于 URL、路径、用户文案），
        // 绝不能当作行注释遮蔽——否则会把同一行后续的 `` ` `` 一起吞掉，
        // 造成模板永不闭合、整段源码丢失。行注释只在真实代码态与插值态才是注释。
        if (c === '<' && next === '!' && src[i + 2] === '-' && src[i + 3] === '-') {
          buf[i] = ' ';
          buf[i + 1] = ' ';
          buf[i + 2] = ' ';
          buf[i + 3] = ' ';
          i += 3;
          enter('htmlComment');
          continue;
        }
      }

      buf[i] = c;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === '\\') {
        escaped = true;
        continue;
      }
      if (
        (state === 'single' && c === "'") ||
        (state === 'double' && c === '"') ||
        (state === 'template' && c === '`')
      ) {
        // 必须用 leave() 还原**进入字符串前的状态**，不能直接写 'code`。
        // 历史坑：这里曾写作 `state = 'code'`，导致模板内嵌插值里的字符串闭合后
        // 状态栈被整体丢弃（depth 1 -> 0），外层模板从此被当作代码，后续所有行注释漏检。
        leave();
      }
      continue;
    }

    if (state === 'htmlComment') {
      if (c === '-' && next === '-' && src[i + 2] === '>') {
        buf[i] = ' ';
        buf[i + 1] = ' ';
        buf[i + 2] = ' ';
        i += 2;
        leave();
      } else {
        buf[i] = c === '\n' ? '\n' : ' ';
      }
      continue;
    }

    // state === 'code' 或 'template' 之外的字符串态
    if (c === '/' && next === '/') {
      buf[i] = ' ';
      buf[i + 1] = ' ';
      i += 1;
      enter('line');
      continue;
    }
    if (c === '/' && next === '*') {
      buf[i] = ' ';
      buf[i + 1] = ' ';
      i += 1;
      enter('block');
      continue;
    }
    // 正则字面量识别：JS 里 `/` 既可能是除号也可能是正则起始。
    // 若不识别，正则内部的反引号（如 /`([^`]+)`/g）会被误当成模板字符串边界，
    // 导致状态机永久失衡（实测 MiddlePod.ts 因此 27 处行注释漏检）。
    // 判定依据：上一个非空白有效字符是「非法值结尾」时，`/` 才能开正则。
    if (c === '/') {
      let j = i - 1;
      while (j >= 0 && /\s/.test(src[j])) j -= 1;
      const prevChar = j >= 0 ? src[j] : '';
      const regexAllowed =
        prevChar === '' ||
        /[(,=:[!&|?{};+\-*%^~<>]/.test(prevChar) ||
        /\b(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)\s*$/.test(
          src.slice(Math.max(0, j - 12), j + 1),
        );
      if (regexAllowed) {
        const start = i;
        let k = i + 1;
        let inClass = false;
        let closed = false;
        while (k < n) {
          const ch = src[k];
          if (ch === '\\') { k += 2; continue; }
          if (ch === '\n') break; // 正则不能跨行，未闭合则回退
          if (ch === '[') inClass = true;
          else if (ch === ']') inClass = false;
          else if (ch === '/' && !inClass) { closed = true; break; }
          k += 1;
        }
        if (closed) {
          // 连同 flags 一起原样保留（正则内的色值/文案不是 UI 违规）
          for (let m = start; m <= k; m++) buf[m] = src[m];
          let m = k + 1;
          while (m < n && /[a-z]/i.test(src[m])) { buf[m] = src[m]; m += 1; }
          i = m - 1;
          continue;
        }
      }
    }
    if (c === "'") {
      enter('single');
      buf[i] = c;
      continue;
    }
    if (c === '"') {
      enter('double');
      buf[i] = c;
      continue;
    }
    if (c === '`') {
      enter('template');
      buf[i] = c;
      continue;
    }
    buf[i] = c;
  }

  const stripped = buf.join('');
  return {
    stripped,
    codeLines: stripped.split('\n'),
    rawLines: src.split('\n'),
  };
}

/**
 * 诊断用：返回每一行行首所处的解析状态。
 *
 * 用途：状态机失衡（字符串/模板永不闭合）会让后半段全部源码被当作字符串，
 * 从而让行注释漏检。这种缺陷极其隐蔽，必须能精确定位「从哪一行开始失真」。
 *
 * @param {string} src
 * @returns {{ line: number, state: string, depth: number, text: string }[]}
 */
export function traceLineStates(src) {
  const n = src.length;
  const out = [{ line: 1, state: 'code', depth: 0, text: '' }];
  const stack = [];
  const interpDepths = [];
  let state = 'code';
  let escaped = false;
  let line = 1;
  let lineStartDepth = 0;

  const enter = (s) => {
    stack.push(state);
    state = s;
  };
  const leave = () => {
    state = stack.length > 0 ? stack.pop() : 'code';
  };

  for (let i = 0; i < n; i++) {
    const c = src[i];
    const next = src[i + 1];

    if (c === '\n') {
      line += 1;
      const rawLine = src.slice(0, i).split('\n');
      out.push({
        line,
        state,
        depth: stack.length,
        text: (rawLine[rawLine.length - 1] ?? '').trim().slice(0, 90),
      });
      if (state === 'line') leave();
      continue;
    }

    if (state === 'interpolation') {
      if (c === '/' && next === '/') { i += 1; enter('line'); continue; }
      if (c === '/' && next === '*') { i += 1; enter('block'); continue; }
      if (c === "'") { enter('single'); continue; }
      if (c === '"') { enter('double'); continue; }
      if (c === '`') { enter('template'); continue; }
      if (c === '{') { interpDepths[interpDepths.length - 1] += 1; continue; }
      if (c === '}') {
        if (interpDepths[interpDepths.length - 1] === 0) { interpDepths.pop(); leave(); }
        else interpDepths[interpDepths.length - 1] -= 1;
        continue;
      }
      continue;
    }

    if (state === 'line') {
      continue;
    }

    if (state === 'block') {
      if (c === '*' && next === '/') { i += 1; leave(); }
      continue;
    }

    if (state === 'htmlComment') {
      if (c === '-' && next === '-' && src[i + 2] === '>') { i += 2; leave(); }
      continue;
    }

    if (state === 'single' || state === 'double' || state === 'template') {
      if (state === 'template' && !escaped) {
        if (c === '$' && next === '{') { i += 1; interpDepths.push(0); enter('interpolation'); continue; }
        if (c === '/' && next === '*') { i += 1; enter('block'); continue; }
        if (c === '<' && next === '!' && src[i + 2] === '-' && src[i + 3] === '-') { i += 3; enter('htmlComment'); continue; }
      }
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if ((state === 'single' && c === "'") || (state === 'double' && c === '"') || (state === 'template' && c === '`')) leave();
      continue;
    }

    if (c === '/' && next === '/') { i += 1; enter('line'); continue; }
    if (c === '/' && next === '*') { i += 1; enter('block'); continue; }
    if (c === "'") { enter('single'); continue; }
    if (c === '"') { enter('double'); continue; }
    if (c === '`') { enter('template'); continue; }
  }

  void lineStartDepth;
  return out;
}

/**
 * 读取并解析单个源文件。
 * 支持从磁盘读取或从 Git 暂存区 (git show :<file>) 流式抽取，以防御 partial staging 漏洞。
 *
 * @param {string} relPath 仓库相对路径
 * @param {{ fromIndex?: boolean }} [opts] 是否强制从 Git Index 读取
 */
export function readSource(relPath, opts = {}) {
  const abs = path.join(REPO_ROOT, relPath);
  let src = '';
  if (opts.fromIndex) {
    try {
      // 关键防御：使用同步子进程读取 Git 暂存区中的精确快照，
      // 彻底杜绝 git add -p 部分暂存时，读工作区磁盘导致漏检或误判的漏洞。
      src = execFileSync('git', ['show', `:${relPath}`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch {
      // 若读取暂存区失败（如未跟踪文件或 git 不可用），优雅降级到工作区磁盘读取
      src = fs.readFileSync(abs, 'utf8');
    }
  } else {
    src = fs.readFileSync(abs, 'utf8');
  }
  const parsed = stripComments(src);
  return { relPath, absPath: abs, src, ...parsed };
}

/**
 * 行内豁免机制 (Inline Allowance)。
 *
 * 设计意图：门禁必须有「合法例外」出口，但例外必须显式写进代码、可被 review 审计，
 * 而不是散落在脚本里的隐式白名单（那会让门禁随白名单腐烂而失效）。
 *
 * 用法：在违规行的上一行或同一行写 `gate-theme-allow: 理由`。
 *
 * @param {string[]} rawLines 原始源码行（含注释）
 * @param {number} lineIdx 0-based 行下标
 * @param {string} tag 例如 'theme' | 'i18n' | 'perf' | 'arch'
 */
export function hasInlineAllowance(rawLines, lineIdx, tag) {
  const marker = `gate-${tag}-allow`;
  const current = rawLines[lineIdx] ?? '';
  const prev = lineIdx > 0 ? rawLines[lineIdx - 1] : '';
  return current.includes(marker) || prev.includes(marker);
}

/** 稳定短哈希，用于生成 baseline 指纹（不落原始内容，避免 baseline 泄露代码） */
export function shortHash(text) {
  return crypto.createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 12);
}

/** 把 JS 正则安全地用于逐行扫描，返回所有匹配 */
export function matchAll(line, regex) {
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
  const out = [];
  let m;
  while ((m = re.exec(line)) !== null) {
    out.push(m);
    if (m.index === re.lastIndex) re.lastIndex += 1; // 零宽匹配保护
  }
  return out;
}
