/**
 * Streaming Token Render Coalescing Engine (流式 Token 渲染合流与自适应节奏引擎)
 * 
 * 【设计意图 (Why)】
 * 1. 解决高频流式消息直接触发 React/DOM setState 导致的 150 FPS 灾难性重排掉帧；
 * 2. 解决大模型突发分块（如 TCP 传输合流后一次性推送 50+ 字符）导致文字突变蹦出的不良体验；
 * 3. 通过 RAF (16.6ms / 60-120 FPS) 垂直同步节拍器，提供打字机般丝滑平顺的逐字流水输出。
 * 
 * 【防范的陷阱 (Pitfall)】
 * - 避免一次性把几百字突变全拍到 DOM 上丢失打字质感；
 * - 避免字符消费不均匀引发卡顿停滞，采用自适应动态步长（积累多则自动倍速追赶，防止延时积压）。
 * 
 * 【核心规则 (Rules)】
 * - 正常时钟下按自适应 step 逐帧输出；
 * - 当外部调用 flush()（如回合完成 message.complete）时，必须一次性清空所有剩余缓冲并同步投递。
 */

export interface TokenChunk {
  messageId: string;
  delta: string;
  isThought?: boolean;
}

export class TokenCoalescer {
  private buffer: Map<string, { content: string; thought: string }> = new Map();
  private rafId: number | null = null;
  private onFlush: (flushed: Map<string, { content: string; thought: string }>) => void;
  private cadence = true;

  constructor(
    onFlush: (flushed: Map<string, { content: string; thought: string }>) => void,
    options: { cadence?: boolean } = {}
  ) {
    this.onFlush = onFlush;
    this.cadence = options.cadence ?? true;
  }

  public push(chunk: TokenChunk): void {
    let current = this.buffer.get(chunk.messageId);
    if (!current) {
      current = { content: '', thought: '' };
      this.buffer.set(chunk.messageId, current);
    }

    if (chunk.isThought) {
      current.thought += chunk.delta;
    } else {
      current.content += chunk.delta;
    }

    this.scheduleStep();
  }

  private scheduleStep(): void {
    if (this.rafId !== null) return;

    const tick = () => {
      this.rafId = null;
      this.step();
    };

    if (typeof requestAnimationFrame !== 'undefined') {
      this.rafId = requestAnimationFrame(tick);
    } else {
      setTimeout(tick, 16);
    }
  }

  /** Advances one frame step, pacing characters for smooth streaming typewriter rhythm */
  private step(): void {
    if (this.buffer.size === 0) return;

    let hasRemaining = false;
    const batch = new Map<string, { content: string; thought: string }>();

    for (const [msgId, entry] of this.buffer.entries()) {
      let emitContent = '';
      let emitThought = '';

      if (entry.thought) {
        emitThought = entry.thought;
        entry.thought = '';
      }

      if (entry.content) {
        if (!this.cadence || entry.content.length <= 4) {
          emitContent = entry.content;
          entry.content = '';
        } else {
          // Dynamic adaptive cadence: 2 to 6 chars per frame for fluent stream flow
          const stepSize = Math.max(2, Math.min(entry.content.length, Math.ceil(entry.content.length / 6)));
          emitContent = entry.content.slice(0, stepSize);
          entry.content = entry.content.slice(stepSize);
        }
      }

      if (entry.content.length > 0 || entry.thought.length > 0) {
        hasRemaining = true;
      } else {
        this.buffer.delete(msgId);
      }

      if (emitContent || emitThought) {
        batch.set(msgId, { content: emitContent, thought: emitThought });
      }
    }

    if (batch.size > 0) {
      this.onFlush(batch);
    }

    if (hasRemaining) {
      this.scheduleStep();
    }
  }

  /** Immediately flushes all remaining buffered content in one shot */
  public flush(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.buffer.size === 0) return;

    const batch = new Map(this.buffer);
    this.buffer.clear();
    this.onFlush(batch);
  }

  public clear(): void {
    this.buffer.clear();
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
