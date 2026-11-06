/**
 * React 流式渲染 spike（临时基准，不进生产）
 *
 * 目的：对比三种更新方式在 5000 条消息下的表现
 *   A. React 结构 + ref 直写正文（候选方案）
 *   B. 字符串模板 + innerHTML 整段重写（现状）
 *   C. React 结构 + setState 每 token（反例，验证不能走 diff）
 *
 * 结果写入 window.__spikeResults，由 run.mjs 通过 CDP 取回。
 */
import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';

const N = 5000;

type Row = { id: number; role: 'user' | 'assistant'; text: string };

function makeRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    role: i % 3 === 0 ? 'user' : 'assistant',
    text: `消息 ${i}：这是一段用于基准测试的正文，长度接近真实回复的一小段，用来撑起行高与滚动高度。`,
  }));
}

const raf2 = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

function measureFrames(ms: number, onFrame: () => void): Promise<{ fps: number; maxGap: number }> {
  return new Promise((resolve) => {
    const start = performance.now();
    let frames = 0;
    let maxGap = 0;
    let last = start;
    const tick = (t: number) => {
      frames++;
      if (frames > 1) maxGap = Math.max(maxGap, t - last);
      last = t;
      onFrame();
      if (t - start < ms) requestAnimationFrame(tick);
      else resolve({ fps: Math.round((frames / ((t - start) / 1000)) * 10) / 10, maxGap: Math.round(maxGap * 10) / 10 });
    };
    requestAnimationFrame(tick);
  });
}

function heapMB(): number {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? Math.round((m.usedJSHeapSize / 1048576) * 10) / 10 : -1;
}

function longTaskProbe(): { max: () => number; stop: () => void } {
  let max = 0;
  let po: PerformanceObserver | null = null;
  try {
    po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) max = Math.max(max, e.duration);
    });
    po.observe({ entryTypes: ['longtask'] });
  } catch {
    /* longtask 不支持时忽略 */
  }
  return {
    max: () => Math.round(max * 10) / 10,
    stop: () => po?.disconnect(),
  };
}

type Result = {
  mode: string;
  mountMs: number;
  scroll: { fps: number; maxGap: number };
  stream: { fps: number; maxGap: number };
  maxLongTaskMs: number;
  heapBeforeMB: number;
  heapAfterMB: number;
};

declare global {
  interface Window {
    __spikeResults?: Result[];
    __spikeDone?: boolean;
  }
}

function RowView({
  row,
  bodyRef,
}: {
  row: Row;
  bodyRef?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div className={`conv-message conv-message--${row.role}`} data-id={row.id}>
      <div className="conv-message__body" ref={bodyRef}>
        {row.text}
      </div>
    </div>
  );
}

function ReactApp({ onFinish }: { onFinish: () => void }) {
  const rows = React.useMemo(() => makeRows(N), []);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastBodyRef = useRef<HTMLDivElement | null>(null);
  const startedAt = useRef(performance.now());

  useEffect(() => {
    void (async () => {
      const mountMs = Math.round((performance.now() - startedAt.current) * 10) / 10;
      await raf2();
      const lt = longTaskProbe();
      const heapBefore = heapMB();

      const scroll = await measureFrames(3500, () => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop += 8;
        if (el.scrollTop >= el.scrollHeight - el.clientHeight) el.scrollTop = 0;
      });

      const stream = await measureFrames(3500, () => {
        const el = lastBodyRef.current;
        if (!el) return;
        el.textContent = `${el.textContent || ''}字`;
      });

      const heapAfter = heapMB();
      lt.stop();
      window.__spikeResults?.push({
        mode: 'react-ref',
        mountMs,
        scroll,
        stream,
        maxLongTaskMs: lt.max(),
        heapBeforeMB: heapBefore,
        heapAfterMB: heapAfter,
      });
      onFinish();
    })();
  }, [onFinish]);

  return (
    <div className="conv-stream" ref={scrollRef}>
      <div className="conv-canvas">
        {rows.map((r, i) => (
          <RowView key={r.id} row={r} bodyRef={i === rows.length - 1 ? (el) => (lastBodyRef.current = el) : undefined} />
        ))}
      </div>
    </div>
  );
}

function SetStateApp({ onFinish }: { onFinish: () => void }) {
  const [rows] = React.useState(() => makeRows(N));
  const [tail, setTail] = React.useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const startedAt = useRef(performance.now());

  useEffect(() => {
    void (async () => {
      const mountMs = Math.round((performance.now() - startedAt.current) * 10) / 10;
      await raf2();
      const lt = longTaskProbe();
      const heapBefore = heapMB();

      const scroll = await measureFrames(3500, () => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop += 8;
        if (el.scrollTop >= el.scrollHeight - el.clientHeight) el.scrollTop = 0;
      });

      // setState 每帧一次：验证 React diff 在整条列表上的代价
      const stream = await measureFrames(3500, () => {
        setTail((t) => `${t}字`);
      });

      const heapAfter = heapMB();
      lt.stop();
      window.__spikeResults?.push({
        mode: 'react-setstate',
        mountMs,
        scroll,
        stream,
        maxLongTaskMs: lt.max(),
        heapBeforeMB: heapBefore,
        heapAfterMB: heapAfter,
      });
      onFinish();
    })();
  }, [onFinish]);

  return (
    <div className="conv-stream" ref={scrollRef}>
      <div className="conv-canvas">
        {rows.map((r, i) => (
          <RowView key={r.id} row={i === rows.length - 1 ? { ...r, text: r.text + tail } : r} />
        ))}
      </div>
    </div>
  );
}

function LegacyApp({ onFinish }: { onFinish: () => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const startedAt = useRef(performance.now());

  useEffect(() => {
    void (async () => {
      const host = hostRef.current;
      if (!host) return;
      const rows = makeRows(N);
      host.innerHTML = `<div class="conv-canvas">${rows
        .map((r) => `<div class="conv-message conv-message--${r.role}"><div class="conv-message__body">${r.text}</div></div>`)
        .join('')}</div>`;
      const mountMs = Math.round((performance.now() - startedAt.current) * 10) / 10;
      await raf2();
      const lt = longTaskProbe();
      const heapBefore = heapMB();

      const scroll = await measureFrames(3500, () => {
        host.scrollTop += 8;
        if (host.scrollTop >= host.scrollHeight - host.clientHeight) host.scrollTop = 0;
      });

      const lastBody = host.querySelector('.conv-message:last-child .conv-message__body') as HTMLDivElement | null;
      let tail = lastBody?.textContent || '';
      const stream = await measureFrames(3500, () => {
        if (!lastBody) return;
        tail += '字';
        lastBody.innerHTML = tail;
      });

      const heapAfter = heapMB();
      lt.stop();
      window.__spikeResults?.push({
        mode: 'legacy-innerhtml',
        mountMs,
        scroll,
        stream,
        maxLongTaskMs: lt.max(),
        heapBeforeMB: heapBefore,
        heapAfterMB: heapAfter,
      });
      onFinish();
    })();
  }, [onFinish]);

  return <div className="conv-stream" ref={hostRef} />;
}

async function runScenario(Component: React.ComponentType<{ onFinish: () => void }>): Promise<void> {
  const mount = document.createElement('div');
  mount.style.cssText = 'position:absolute;inset:0;';
  document.body.appendChild(mount);
  const root = createRoot(mount);
  await new Promise<void>((resolve) => {
    root.render(<Component onFinish={() => setTimeout(resolve, 100)} />);
  });
  root.unmount();
  mount.remove();
}

async function boot(): Promise<void> {
  window.__spikeResults = [];
  await runScenario(ReactApp);
  await runScenario(SetStateApp);
  await runScenario(LegacyApp);
  window.__spikeDone = true;
}

void boot();
