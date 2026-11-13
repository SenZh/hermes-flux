/**
 * 在场指示器两套布局的实景验证（真实 Blink，加载构建产物）
 *
 * 【为什么必须截真实应用】桩 DOM 只能证明 CSS 写对了，证明不了：
 *   1. `dock` 变体的宿主绝对定位是否真的贴住输入舱上沿（依赖 `.input-dock-container`
 *      的包含块与 `padding` 数学，只有真实排版能给答案）；
 *   2. 头像外沿是否与输入舱左边框逐像素对齐（用户裁定的对齐线）；
 *   3. 设置切换 → localStorage → 重启恢复的闭环是否成立。
 *
 * 【产物】artifacts/verification/presence-dock-layout/{screenshot.png,evidence.json}
 */

const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '../..');
const DIST = path.join(ROOT, 'packages/desktop/dist/renderer');
const OUT = path.join(ROOT, 'artifacts/verification/presence-dock-layout');
const FEATURE = 'presence-dock-layout';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function serve() {
  return http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = path.join(DIST, url === '/' ? 'index.html' : url);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
}

const AVATAR_SVG = `<svg viewBox="0 0 36 36" fill="none"><rect x="4" y="4" width="28" height="28" rx="14" fill="var(--foreground)"/><g class="conv-presence__eyes"><circle cx="13.5" cy="17" r="1.9" fill="var(--background)"/><circle cx="22.5" cy="17" r="1.9" fill="var(--background)"/></g></svg>`;

/** 与 AgentPresence.tsx 输出结构一致的指示器骨架 */
function presenceHtml(kind, layout, textHtml) {
  return `
    <div class="conv-presence" data-presence="${kind}" data-mode="solo" data-tone="fresh" data-layout="${layout}" role="status" aria-label="Agent 当前状态">
      <div class="conv-presence__avatars" data-blinkable="true">
        <span class="conv-presence__avatar" data-speaker="true" data-lead="true" data-idle-turn="false">
          <span class="conv-presence__halo"></span>
          <span class="conv-presence__ring"></span>
          <span class="conv-presence__face" data-blink="false">${AVATAR_SVG}</span>
        </span>
      </div>
      <span class="conv-presence__text" ${kind === 'idle' ? 'data-idle-quip="true" aria-hidden="true"' : ''}>${textHtml}</span>
    </div>`;
}

const DOCK_HTML = `
  <div class="input-dock-container" data-phase="ready">
    <div class="input-card-box composer-dock">
      <div class="composer-dock__editor"><div class="probe-placeholder">给 Hermes 下达任务…（Enter 发送，Shift+Enter 换行）</div></div>
      <div class="composer-dock__footer">
        <div class="composer-dock__footer-group"><span class="probe-chip">gpt-4o</span></div>
        <div class="composer-dock__footer-group composer-dock__footer-group--end"><span class="probe-chip">默认</span><span class="probe-send">↑</span></div>
      </div>
    </div>
  </div>`;

const SCENES = [
  { label: 'stage-thinking', theme: 'obsidian-gold', layout: 'stage', kind: 'thinking',
    text: '<span class="conv-presence__verb">正在思考</span>' },
  { label: 'dock-thinking', theme: 'obsidian-gold', layout: 'dock', kind: 'thinking',
    text: '<span class="conv-presence__verb">正在读</span><span class="conv-presence__target">core/gateway.ts</span>' },
  { label: 'dock-idle', theme: 'obsidian-gold', layout: 'dock', kind: 'idle',
    text: '<span class="conv-presence__verb">闲着也是闲着，顺手擦了擦工具</span>' },
  { label: 'dock-writing-light', theme: 'warm-paper', layout: 'dock', kind: 'writing',
    text: '<span class="conv-presence__verb">努力工作中</span><span class="conv-presence__bars" aria-hidden="true"><i></i><i></i><i></i></span>' },
];

function injectScript(scene) {
  return `(() => {
    /*
     * 【未连接不渲染的证据 (Rules)】注入之前先数一遍真实应用已经画出来的指示器。
     *   注意不能数 #react-conv-presence-host：那个空宿主是 MiddlePod 模板的静态占位，
     *   恒存在；真正的判据是里面有没有 .conv-presence 子树。
     *   本探针随后会手写注入指示器，注入后无法再分辨「真实应用有没有渲染」，
     *   所以必须在清理/注入之前采样：未连接网关时应恒为 0。
     */
    const hostBeforeInjection = document.querySelectorAll('#react-conv-presence-host').length;
    const presenceBeforeInjection = document.querySelectorAll('.conv-presence').length;
    /*
     * 连接态判据：dock 变体的输入舱只在网关连上时渲染。
     *   探针若跑在一台已连真实网关的机器上，这里会 > 0 —— 「未连接不渲染」这条规则
     *   在该环境下不可证伪，断言按条件跳过（见 evidence.assertions 注释）。
     */
    const dockBeforeInjection = document.querySelectorAll('.input-dock-container').length;
    document.querySelectorAll('.conv-presence, #react-conv-presence-host, .input-dock-container, #probe-underlay, #probe-style').forEach((n) => n.remove());

    const style = document.createElement('style');
    style.id = 'probe-style';
    style.textContent = \`
      .probe-placeholder { padding: 14px 16px 18px; color: var(--faint); font: 13px/1.5 var(--conv-font-sans, sans-serif); }
      .composer-dock__footer { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-top: 1px solid var(--border-subtle); }
      .composer-dock__footer-group { display: flex; align-items: center; gap: 8px; }
      .probe-chip { font: 12px/1 var(--conv-font-sans, sans-serif); color: var(--secondary-foreground); padding: 4px 8px; border: 1px solid var(--border); border-radius: 9999px; }
      .probe-send { width: 24px; height: 24px; border-radius: 8px; background: #2D6BEA; color: #fff; display: grid; place-items: center; font-size: 12px; }
      #probe-underlay { position: absolute; inset: 0; padding: 96px 120px 0; color: var(--foreground); font: 13px/1.9 var(--conv-font-sans, sans-serif); z-index: 0; }
    \`;
    document.head.appendChild(style);

    const pod = document.querySelector('.flux-middle-pod') || document.body;
    const under = document.createElement('div');
    under.id = 'probe-underlay';
    under.innerHTML = '<div>第一行：这条消息正好在指示器正后方，用来看它压掉了多少内容。</div>'
      + '<div>第二行：second line of the message body sitting right under the presence indicator.</div>'
      + '<div>第三行：第三条消息，不该被吃掉。</div>';
    pod.appendChild(under);

    const layout = ${JSON.stringify(scene.layout)};
    const presence = ${JSON.stringify(presenceHtml(scene.kind, scene.layout, scene.text))};

    if (layout === 'dock') {
      pod.insertAdjacentHTML('beforeend', ${JSON.stringify(DOCK_HTML)});
      const dock = pod.querySelector('.input-dock-container');
      const host = document.createElement('div');
      host.id = 'react-conv-presence-host';
      host.className = 'presence-host--dock';
      host.innerHTML = presence;
      dock.insertBefore(host, dock.firstElementChild);
    } else {
      const host = document.createElement('div');
      host.id = 'react-conv-presence-host';
      host.innerHTML = presence;
      const stream = pod.querySelector('#conversation-stream');
      pod.insertBefore(host, stream?.nextSibling ?? pod.firstChild);
    }

    const el = document.querySelector('.conv-presence');
    const r = el.getBoundingClientRect();
    // 【量测口径 (Rules)】必须量 avatar 槽位而不是 face：face 上挂着 thinking 的旋转形变，
    //   getBoundingClientRect 会因旋转膨胀到 21px 并左移 1px，量它等于在量动画帧。
    const avatarRect = el.querySelector('.conv-presence__avatar').getBoundingClientRect();
    const faceRect = el.querySelector('.conv-presence__face').getBoundingClientRect();
    const textEl = el.querySelector('.conv-presence__text');
    const textRect = textEl.getBoundingClientRect();
    /*
     * 【驱动到终态，而不是改写属性 (Rules)】隐藏窗口下 Chromium 会冻结动画时间线，
     *   convPresenceTextIn（160ms，both）停在首帧 opacity 0：截图里头像在、文案完全消失。
     *   早期做法是直接写 textEl.style.opacity = '1'——但那是「自己写值、自己量值」：
     *   应用侧任何 opacity 回归都会被这行内联样式压掉，墨迹断言永远绿。
     *   这里改为把已注册的动画 finish() 到终态：应用终态若真的是 0，墨迹会立刻掉 0 判红。
     */
    const frozenOpacity = getComputedStyle(textEl).opacity;
    if (typeof textEl.getAnimations === 'function') {
      for (const animation of textEl.getAnimations()) {
        // 无限动画不能 finish（会抛 InvalidStateError）；本元素的入场动画是有限时长
        try {
          animation.finish();
        } catch {
          /* 忽略无法收尾的无限动画 */
        }
      }
    }
    const dockBox = document.querySelector('.composer-dock')?.getBoundingClientRect() ?? null;
    const cardBox = document.querySelector('.gateway-onboarding-card')?.getBoundingClientRect() ?? null;
    const beforeStyle = getComputedStyle(el, '::before');
    const faceStyle = getComputedStyle(el.querySelector('.conv-presence__face'));
    const textStyle = getComputedStyle(textEl);
    /*
     * 【墨迹采样必须只取内容盒 (Rules)】胶囊自身有 1px 描边 + 4px/8~12px 内距：
     *   直接截整块矩形时，描边与圆角在 --card 底色上的色差会被算成「墨迹」，
     *   实测把文案全部 visibility:hidden 后仍有 2.1%~4.1%，于是 2% 阈值恒绿。
     *   内容盒（rect 内缩 border + padding）里只剩文字与打字波：隐藏时恒为 0，
     *   可见时 17%~28%，阈值才有真实杀伤力。
     */
    const px = (value) => parseFloat(value) || 0;
    const contentRect = {
      x: Math.round(textRect.left + px(textStyle.borderLeftWidth) + px(textStyle.paddingLeft)),
      y: Math.round(textRect.top + px(textStyle.borderTopWidth) + px(textStyle.paddingTop)),
      width: Math.round(
        textRect.width - px(textStyle.borderLeftWidth) - px(textStyle.borderRightWidth)
          - px(textStyle.paddingLeft) - px(textStyle.paddingRight),
      ),
      height: Math.round(
        textRect.height - px(textStyle.borderTopWidth) - px(textStyle.borderBottomWidth)
          - px(textStyle.paddingTop) - px(textStyle.paddingBottom),
      ),
    };

    return {
      layout: el.getAttribute('data-layout'),
      hostBeforeInjection,
      presenceBeforeInjection,
      dockBeforeInjection,
      presence: { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) },
      /** 根节点自身必须完全透明：底板只能挂在文案行上，否则就是按容器铺开的旧遮罩 */
      presenceBackground: getComputedStyle(el).backgroundColor,
      onboarding: cardBox ? { top: Math.round(cardBox.top) } : null,
      avatar: { size: Math.round(avatarRect.width), left: Math.round(avatarRect.left) },
      face: { size: Math.round(faceRect.width), left: Math.round(faceRect.left) },
      text: { left: Math.round(textRect.left), width: Math.round(textRect.width),
              rect: { x: Math.round(textRect.left), y: Math.round(textRect.top),
                      width: Math.round(textRect.width), height: Math.round(textRect.height) },
              contentRect,
              fontSize: textStyle.fontSize, lineHeight: textStyle.lineHeight,
              textShadow: textStyle.textShadow === 'none' ? 'none' : 'present',
              background: textStyle.backgroundColor, borderRadius: textStyle.borderRadius,
              padding: textStyle.padding, opacity: textStyle.opacity,
              frozenOpacity },
      dock: dockBox ? { left: Math.round(dockBox.left), top: Math.round(dockBox.top), width: Math.round(dockBox.width) } : null,
      /** 头像槽位外沿与输入舱左边框的差值：0 表示逐像素对齐（用户裁定的对齐线） */
      alignDelta: dockBox ? Math.round(avatarRect.left - dockBox.left) : null,
      /** 指示器与输入舱上沿的间距 */
      gapToDock: dockBox ? Math.round(dockBox.top - r.bottom) : null,
      /** 指示器背后不得有任何面（对比度遮罩已整块删除） */
      maskContent: beforeStyle.content,
      maskBackground: beforeStyle.backgroundImage,
      faceAnimation: faceStyle.animationName,
    };
  })()`;
}

/**
 * 统计一张文案行截图里的「墨迹」像素。
 *
 * 【为什么必须用像素 (Rules)】`computed opacity` 可以被探针自己写成 1 再断言等于 1，
 *   是恒真的假测试；像素是唯一能证明「字真的被画到屏幕上」的证据。
 *   以胶囊底色为基准，RGB 曼哈顿距离 > 60 记为墨迹（文字 / 描边 / 打字波都算）。
 */
function measureInk(image, backgroundCss) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(backgroundCss || '');
  const { width, height } = image.getSize();
  const total = width * height;
  if (!m || total === 0) return { ratio: 0, ink: 0, total };
  const baseR = Number(m[1]);
  const baseG = Number(m[2]);
  const baseB = Number(m[3]);
  const bitmap = image.toBitmap();
  let ink = 0;
  for (let i = 0; i + 3 < bitmap.length; i += 4) {
    const b = bitmap[i];
    const g = bitmap[i + 1];
    const r = bitmap[i + 2];
    if (Math.abs(r - baseR) + Math.abs(g - baseG) + Math.abs(b - baseB) > 60) ink += 1;
  }
  return { ratio: ink / total, ink, total };
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = serve();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 820,
    backgroundColor: '#0E0F13',
    /*
     * 【禁用 offscreen (Rules)】`webPreferences.offscreen: true` 在部分 Windows/Electron 34
     *   组合上退出时会以 0xC0000005 崩溃（实测 `app.exit(0)` 仍返回 -1073741819），
     *   使脚本无法作为门禁使用。隐藏的普通窗口仍是真实 Blink 渲染与真实排版。
     */
  });

  const report = [];
  let firstScreenshot = null;

  for (const scene of SCENES) {
    await win.loadURL(`http://127.0.0.1:${port}/`);
    await new Promise((resolve) => setTimeout(resolve, 3200));
    await win.webContents.executeJavaScript(
      `document.documentElement.setAttribute('data-theme', ${JSON.stringify(scene.theme)}); true`,
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    const geometry = await win.webContents.executeJavaScript(injectScript(scene), true);
    await new Promise((resolve) => setTimeout(resolve, 700));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, `${scene.label}.png`), image.toPNG());
    /*
     * 【文案可见性必须由像素证明 (Rules)】只断言 computed opacity 会被「先写 1 再读 1」
     *   自证（本探针历史缺陷）。这里直接截取文案行的真实像素，统计与胶囊底色差异显著的
     *   「墨迹」占比：文字没被画出来时该值恒为 0，任何 opacity/clip/z-index 缺陷都会掉到 0。
     */
    const textInkShot = await win.webContents.capturePage(geometry.text.contentRect);
    fs.writeFileSync(path.join(OUT, `text-${scene.label}.png`), textInkShot.toPNG());
    const textInk = measureInk(textInkShot, geometry.text.background);
    geometry.text.inkRatio = Number(textInk.ratio.toFixed(4));
    geometry.text.inkPixels = textInk.ink;
    /*
     * 【判据自检 (Rules)】隐藏文案子元素（保留胶囊底板）后再量一次同一个内容盒：
     *   文字消失时墨迹必须归零，否则说明这条判据在量描边/背景而不是字。
     *   上一版用整块矩形口径时正是这里露馅——隐藏字形后仍有 2.1%~4.1% 的「墨迹」。
     */
    await win.webContents.executeJavaScript(
      `(() => {
        const t = document.querySelector('.conv-presence__text');
        if (t) t.querySelectorAll('*').forEach((n) => { n.style.visibility = 'hidden'; });
        return true;
      })()`,
      true,
    );
    // 等一拍合成器：capturePage 抓的是已提交帧，设置样式后立即截图可能拿到旧帧
    await new Promise((resolve) => setTimeout(resolve, 160));
    const hiddenInk = measureInk(
      await win.webContents.capturePage(geometry.text.contentRect),
      geometry.text.background,
    );
    geometry.text.hiddenInkRatio = Number(hiddenInk.ratio.toFixed(4));
    await win.webContents.executeJavaScript(
      `(() => {
        const t = document.querySelector('.conv-presence__text');
        if (t) t.querySelectorAll('*').forEach((n) => { n.style.visibility = ''; });
        return true;
      })()`,
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (!firstScreenshot) firstScreenshot = image;
    report.push({ scene: scene.label, theme: scene.theme, kind: scene.kind, ...geometry });
    console.log(
      `${scene.label.padEnd(20)} layout=${geometry.layout} face=${geometry.face.size}px ` +
        `text=${geometry.text.width}px plate=${geometry.text.background} ink=${(geometry.text.inkRatio * 100).toFixed(1)}% ` +
        `presenceBottom=${geometry.presence.top + geometry.presence.height} cardTop=${geometry.onboarding?.top ?? '-'} ` +
        `alignDelta=${geometry.alignDelta} gapToDock=${geometry.gapToDock} mask=${geometry.maskContent}`,
    );
  }

  /*
   * 设置切换闭环：点击「输入框上方」→ 断言 aria-pressed 与 localStorage，
   * 然后 reload 断言冷启动恢复（这一条正是历史 P0：键名声明晚于 state 时恒回 stage）。
   */
  await win.loadURL(`http://127.0.0.1:${port}/`);
  await new Promise((resolve) => setTimeout(resolve, 3200));
  await win.webContents.executeJavaScript(
    `localStorage.removeItem('hermes_flux_presence_layout'); document.getElementById('btn-open-settings')?.click(); true`,
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const switched = await win.webContents.executeJavaScript(
    `(() => {
      const buttons = [...document.querySelectorAll('button')];
      const dockBtn = buttons.find((b) => b.textContent && b.textContent.trim() === '输入框上方');
      dockBtn?.click();
      return { found: Boolean(dockBtn), pressed: dockBtn?.getAttribute('aria-pressed') ?? null,
               stored: localStorage.getItem('hermes_flux_presence_layout') };
    })()`,
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 600));

  await win.reload();
  await new Promise((resolve) => setTimeout(resolve, 3200));
  /*
   * 【量测口径 (Rules)】未连接网关时宿主根本不渲染指示器（`state.gatewayConnected` 为假），
   *   因此冷启动恢复不能靠「host 在不在输入舱里」来断言。改为读设置面板的选中态：
   *   它直接由 `state.presenceLayout` 驱动，是这条链路上唯一可观测的真值出口。
   */
  const restored = await win.webContents.executeJavaScript(
    `(async () => {
      document.getElementById('btn-open-settings')?.click();
      await new Promise((r) => setTimeout(r, 900));
      const buttons = [...document.querySelectorAll('button')];
      const dockBtn = buttons.find((b) => b.textContent && b.textContent.trim() === '输入框上方');
      const stageBtn = buttons.find((b) => b.textContent && b.textContent.trim() === '对话区顶部');
      return {
        stored: localStorage.getItem('hermes_flux_presence_layout'),
        dockPressed: dockBtn?.getAttribute('aria-pressed') ?? null,
        stagePressed: stageBtn?.getAttribute('aria-pressed') ?? null,
      };
    })()`,
    true,
  );

  const evidence = {
    generatedAt: new Date().toISOString(),
    feature: FEATURE,
    url: `http://127.0.0.1:${port}/`,
    scenes: report,
    /*
     * 诊断量（不阻断门禁）。
     *
     * 【stage 与 onboarding 卡片的重叠 (Rules)】本探针会把指示器**强制注入**到未连接的首屏，
     *   因此这里能量到 stage 底边与 onboarding 卡片顶边的重叠（实测卡片 107px / 指示器 160px，
     *   重叠 53px）。真实应用已在 `ensureAgentPresenceHost()` 里加了「未连接不渲染」的早退分支，
     *   所以这个重叠只可能出现在探针的注入场景——保留为诊断，用来验证守卫确实必要。
     */
    diagnostics: {
      /** 探针机是否连上了真实网关（决定「未连接不渲染」这条断言是否适用） */
      probeConnected: report.map((r) => ({
        scene: r.scene,
        connected: r.dockBeforeInjection > 0,
        presenceRendered: r.presenceBeforeInjection,
      })),
      stageOnboardingOverlap: report
        .filter((r) => r.layout === 'stage' && r.onboarding)
        .map((r) => ({
          scene: r.scene,
          presenceBottom: r.presence.top + r.presence.height,
          onboardingTop: r.onboarding.top,
          overlapPx: r.presence.top + r.presence.height - r.onboarding.top,
        })),
    },
    settingsSwitch: switched,
    coldStartRestore: restored,
    assertions: {
      /** 用户裁定的对齐线：dock 下头像外沿必须与输入舱左边框重合 */
      dockAlignsFaceToDockLeft: report
        .filter((r) => r.layout === 'dock')
        .every((r) => r.alignDelta === 0),
      /** dock 与输入舱之间固定 8px，且不得因占流把输入舱顶起来 */
      dockGapIsEight: report.filter((r) => r.layout === 'dock').every((r) => r.gapToDock === 8),
      /** 背后不得有任何面 */
      noMaskBehindIndicator: report.every((r) => r.maskContent === 'none' && r.maskBackground === 'none'),
      /** dock 文案不得带字形阴影（会变成脏边） */
      dockTextShadowOff: report.filter((r) => r.layout === 'dock').every((r) => r.text.textShadow === 'none'),
      /** 文案必须自带局部底板：裸字压在会话流上会与消息互相穿透 */
      textPlatePresent: report.every((r) => r.text.background !== 'rgba(0, 0, 0, 0)'),
      /** 底板只能在文案行上：根节点必须完全透明（否则就是按容器铺开的旧遮罩） */
      rootHasNoPlate: report.every((r) => r.presenceBackground === 'rgba(0, 0, 0, 0)'),
      /** dock 底板的宽度必须由内容决定：文案 + 头像 + 8px 间距不得撑满整个指示器宽度 */
      dockPlateFitsText: report
        .filter((r) => r.layout === 'dock')
        .every((r) => r.text.width + r.avatar.size + 8 <= r.presence.width),
      /** 文字必须真的被画出来：内容盒内像素墨迹占比 > 2%（文字消失时恒为 0） */
      textInkPixels: report.every((r) => r.text.inkRatio > 0.02),
      /** 判据自检：隐藏文案子元素后同一内容盒的墨迹必须归零（否则量到的是 chrome 不是字） */
      textInkCalibrated: report.every((r) => r.text.hiddenInkRatio < 0.005),
      /** 入场动画终态必须不透明（探针用 getAnimations().finish() 驱动，不改写属性） */
      textSettledOpacity: report.every((r) => Number(r.text.opacity) === 1),
      /** 设置切换写盘 */
      settingsPersists: switched.stored === 'dock',
      /** 冷启动恢复（历史 P0 回归） */
      coldStartRestoresDock:
        restored.stored === 'dock' && restored.dockPressed === 'true' && restored.stagePressed === 'false',
    },
  };

  /*
   * 【未连接不渲染只能条件断言 (Rules)】探针若跑在已连真实网关的机器上（输入舱存在），
   *   `disconnectedHidesPresence` 在该环境下不可证伪。此时整条移出 assertions 并在
   *   diagnostics 标注 skipped——不能写成「恒 true」，否则证据里会变成一条永不失败的假绿。
   */
  const disconnectedScenes = report.filter((r) => r.dockBeforeInjection === 0);
  if (disconnectedScenes.length > 0) {
    evidence.assertions.disconnectedHidesPresence = disconnectedScenes.every(
      (r) => r.presenceBeforeInjection === 0,
    );
  } else {
    evidence.diagnostics.disconnectedHidesPresence = 'skipped：探针机已连真实网关（输入舱存在）';
  }
  /** 探针冻结帧与驱动终态的对照，仅作诊断（断言见 assertions.textSettledOpacity） */
  evidence.diagnostics.textSettledOpacity = report.map((r) => ({
    scene: r.scene,
    settled: r.text.opacity,
    frozen: r.text.frozenOpacity,
  }));

  fs.writeFileSync(path.join(OUT, 'screenshot.png'), firstScreenshot.toPNG());
  fs.writeFileSync(path.join(OUT, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  const failures = Object.entries(evidence.assertions).filter(([, ok]) => !ok);
  console.log(`\n==== ${report.length} 场景已截图，断言 ${Object.keys(evidence.assertions).length} 条 ====`);
  console.log(JSON.stringify(evidence.assertions, null, 2));
  console.log(`输出目录：artifacts/verification/${FEATURE}/`);

  server.close();
  app.exit(failures.length === 0 ? 0 : 1);
});
