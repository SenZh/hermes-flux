/**
 * Fixed Capacity Ring Buffer for Subagent Streaming Logs
 * (packages/core/src/subagent/ringBuffer.ts)
 *
 * 设计意图 (Why):
 *   当子代理执行自动化构建、批量静态分析或测试时，可能在几秒内产出数万行 stdout/stderr 日志。
 *   若无界存放在客户端 JS 内存中，移动端（iOS / Android）WebView 将迅速发生 OOM 闪退，
 *   桌面端也会因巨型数组造成 GC 卡顿。因此必须用定长环形缓冲区进行截断保护。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 内存雪崩：严禁使用普通的无界 Array.push()，必须在达到 capacity 时自动覆盖最旧数据。
 *   2. 顺序错乱：环形读取必须保证按时间顺序（从最旧到最新）线形输出。
 *
 * 约束与规则 (Rules):
 *   - 纯 TypeScript，零外部或宿主依赖。
 *   - capacity 默认 1000 条，超出自动丢弃头部。
 */

export class RingBuffer<T> {
  private buffer: Array<T | undefined>;
  private capacity: number;
  private head = 0; // 最早写入的数据位置
  private tail = 0; // 下一个写入的数据位置
  private size = 0;

  constructor(capacity = 1000) {
    if (capacity <= 0) {
      throw new Error(`RingBuffer capacity must be positive, got ${capacity}`);
    }
    this.capacity = capacity;
    this.buffer = new Array<T | undefined>(capacity);
  }

  /**
   * 追加一条数据，如果已满则自动挤掉最旧的数据
   */
  public push(item: T): void {
    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;

    if (this.size < this.capacity) {
      this.size++;
    } else {
      // 缓冲区已满，head 指针顺推覆盖最旧的数据
      this.head = (this.head + 1) % this.capacity;
    }
  }

  /**
   * 按严格的时间先后顺序（最早到最新）导出当前所有元素
   */
  public toArray(): T[] {
    const result: T[] = new Array(this.size);
    for (let i = 0; i < this.size; i++) {
      const idx = (this.head + i) % this.capacity;
      const val = this.buffer[idx];
      if (val !== undefined) {
        result[i] = val;
      }
    }
    return result;
  }

  /**
   * 获取当前缓冲区元素数量
   */
  public getSize(): number {
    return this.size;
  }

  /**
   * 获取最大容量
   */
  public getCapacity(): number {
    return this.capacity;
  }

  /**
   * 清空缓冲区
   */
  public clear(): void {
    this.buffer.fill(undefined);
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }
}
