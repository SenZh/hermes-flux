/** 代际使过期的全量列表快照失效，避免删除操作被旧响应覆盖。 */
export class SessionListGeneration {
  private generation = 0;

  public beginFetch(): number {
    this.generation += 1;
    return this.generation;
  }

  public invalidateForDelete(): number {
    this.generation += 1;
    return this.generation;
  }

  public mayCommit(snapshotGeneration: number): boolean {
    return snapshotGeneration === this.generation;
  }
}
