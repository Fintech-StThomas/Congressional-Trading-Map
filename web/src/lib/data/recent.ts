// A bounded in-memory store of parsed data files per release: keeps the files of the N most recently used releases
// and drops the rest, so a long-running server that sees many releases does not grow without bound.
// Keys are `<release>|<rel>` in effect. Pure, so node --test loads it.
export class RecentStore<V> {
  private readonly releases = new Map<string, Map<string, V>>();
  private readonly keep: number;
  constructor(keep: number) {
    this.keep = keep;
  }

  /** Mark `release` as just used and return its files, dropping the least recently used releases beyond `keep`. */
  private touch(release: string): Map<string, V> {
    let files = this.releases.get(release);
    if (files) this.releases.delete(release); // re-insert below: Map order is use order
    else files = new Map();
    this.releases.set(release, files);
    while (this.releases.size > this.keep) this.releases.delete(this.releases.keys().next().value as string);
    return files;
  }

  get(release: string, rel: string): V | undefined {
    return this.touch(release).get(rel);
  }

  set(release: string, rel: string, value: V): void {
    this.touch(release).set(rel, value);
  }

  /** The releases currently held, least recently used first. */
  held(): string[] {
    return [...this.releases.keys()];
  }
}
