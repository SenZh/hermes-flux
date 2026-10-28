/**
 * Streaming Token Render Coalescing Engine
 * Coalesces rapid stream token chunks into frame-aligned render batches (60-120fps).
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

  constructor(onFlush: (flushed: Map<string, { content: string; thought: string }>) => void) {
    this.onFlush = onFlush;
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

    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.rafId !== null) return;

    if (typeof requestAnimationFrame !== 'undefined') {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.flush();
      });
    } else {
      // Fallback for non-browser environments
      setTimeout(() => {
        this.rafId = null;
        this.flush();
      }, 16);
    }
  }

  public flush(): void {
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
