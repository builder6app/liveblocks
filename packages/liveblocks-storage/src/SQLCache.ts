import type { Database } from "better-sqlite3";
import sqlite3 from "better-sqlite3";

import type { Json } from "~/lib/Json.js";

import type { Delta, NodeId } from "./types.js";
import { raise } from "./utils.js";

const ROOT = "root" as NodeId;

function createDB() {
  const db = sqlite3(":memory:");
  db.pragma("journal_mode = WAL");

  db.exec(
    `CREATE TABLE IF NOT EXISTS storage (
       nid    TEXT NOT NULL,
       key    TEXT NOT NULL,
       jval   TEXT NOT NULL,
       PRIMARY KEY (nid, key)
     )`
  );

  db.exec(
    `CREATE TABLE IF NOT EXISTS versions (
       nid    TEXT NOT NULL,
       key    TEXT NOT NULL,
       clock  INT UNSIGNED NOT NULL,
       jval   TEXT,
       PRIMARY KEY (nid, key, clock DESC)
     )`
  );

  return db;
}

function createQueries(db: Database) {
  const storage = {
    countAll: db.prepare<[], number>("SELECT COUNT(*) FROM storage").pluck(),

    exists: db
      .prepare<
        [nid: string, key: string],
        number // EXISTS doesn't return a boolean
      >("SELECT EXISTS(SELECT 1 FROM storage WHERE nid = ? AND key = ?)")
      .pluck(),

    selectKey: db
      .prepare<
        [nid: string, key: string],
        string
      >("SELECT jval FROM storage WHERE nid = ? AND key = ?")
      .pluck(),

    selectAllKeys: db
      .prepare<[], [nid: string, key: string]>("SELECT nid, key FROM storage")
      .raw(),

    selectAll: db
      .prepare<
        [],
        [nid: string, key: string, jval: string]
      >("SELECT nid, key, jval FROM storage")
      .raw(),

    upsertKeyValue: db.prepare<[nid: string, key: string, jval: string], void>(
      `INSERT INTO storage (nid, key, jval)
       VALUES (?, ?, ?)
       ON CONFLICT (nid, key) DO UPDATE SET jval = excluded.jval`
    ),

    deleteKey: db.prepare<[nid: string, key: string], void>(
      "DELETE FROM storage WHERE nid = ? AND key = ?"
    ),

    clear: db.prepare<[], void>("DELETE FROM storage"),
  };

  const versions = {
    clear: db.prepare<[], void>("DELETE FROM versions"),
  };

  return {
    begin: db.prepare<[], void>("BEGIN"),
    commit: db.prepare<[], void>("COMMIT"),
    rollback: db.prepare<[], void>("ROLLBACK"),

    storage,
    versions,
  };
}

type Queries = ReturnType<typeof createQueries>;

export class SQLCache {
  readonly #q: Queries;
  #clock: number = 0;

  constructor() {
    this.#q = createQueries(createDB());
  }

  // ----------------------------------------------------
  // "Convenience" accessors to make implementing mutations easier
  // ----------------------------------------------------

  getNumber(key: string): number | undefined {
    const value = this.get(key);
    return typeof value === "number" ? value : undefined;
  }

  // ----------------------------------------------------
  // "Multi-layer" cache idea
  // ----------------------------------------------------

  /**
   * Returns the number of items in the cache.
   */
  count(): number {
    return this.#q.storage.countAll.get()!;
  }

  has(key: string): boolean {
    return !!this.#q.storage.exists.get(ROOT, key);
  }

  get(key: string): Json | undefined {
    const jval = this.#q.storage.selectKey.get(ROOT, key);
    return jval !== undefined ? (JSON.parse(jval) as Json) : undefined;
  }

  set(key: string, value: Json): void {
    if (value === undefined) {
      this.delete(key);
    } else {
      this.#q.storage.upsertKeyValue.run(ROOT, key, JSON.stringify(value));
    }
  }

  delete(key: string): void {
    this.#q.storage.deleteKey.run(ROOT, key);
  }

  *keys(): IterableIterator<string> {
    const rows = this.#q.storage.selectAllKeys.iterate();
    for (const [_nid, key] of rows) {
      yield key;
    }
  }

  *entries(): IterableIterator<[key: string, value: Json]> {
    const rows = this.#q.storage.selectAll.iterate();
    for (const [_nid, key, jval] of rows) {
      yield [key, JSON.parse(jval)];
    }
  }

  [Symbol.iterator](): IterableIterator<[key: string, value: Json]> {
    return this.entries();
  }

  // ----------------------------------------------------
  // Transaction API
  // ----------------------------------------------------

  /**
   * Rolls back all transactions, and resets the LayeredCache to its initial,
   * empty, state.
   */
  reset(): void {
    try {
      this.rollback();
    } catch {
      // Ignore
    }

    this.startTransaction();
    try {
      this.#q.storage.clear.run();
      this.#q.versions.clear.run();
      this.commit();
    } catch (e) {
      this.commit();
    }
  }

  /**
   * Computes a Delta within the current transaction.
   */
  delta(): Delta {
    raise("DELTA not implemented yet");
  }

  startTransaction(): void { this.#q.begin.run(); } // prettier-ignore
  commit(): void { this.#q.commit.run(); } // prettier-ignore
  rollback(): void { this.#q.rollback.run(); } // prettier-ignore
}
