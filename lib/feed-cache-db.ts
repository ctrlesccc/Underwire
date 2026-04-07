import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { FeedItem } from "./feed";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "underwire.db");

type CacheRow = {
  cache_key: string;
  feed_url: string;
  tz_override: string | null;
  item_limit: number;
  items_json: string;
  fetched_at: number;
  last_status: number | null;
  last_error: string | null;
};

let dbInstance: Database.Database | null = null;

function getDb() {
  if (dbInstance) return dbInstance;

  fs.mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS feed_cache (
      cache_key TEXT PRIMARY KEY,
      feed_url TEXT NOT NULL,
      tz_override TEXT,
      item_limit INTEGER NOT NULL,
      items_json TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      last_status INTEGER,
      last_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_feed_cache_fetched_at
    ON feed_cache(fetched_at DESC);
  `);

  dbInstance = db;
  return db;
}

export function getFeedCache(cacheKey: string) {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM feed_cache WHERE cache_key = ?")
    .get(cacheKey) as CacheRow | undefined;

  if (!row) return null;

  try {
    return {
      ...row,
      items: JSON.parse(row.items_json) as FeedItem[],
    };
  } catch {
    return null;
  }
}

export function upsertFeedCache(input: {
  cacheKey: string;
  feedUrl: string;
  tzOverride?: string;
  itemLimit: number;
  items: FeedItem[];
  fetchedAt: number;
  lastStatus?: number;
  lastError?: string | null;
}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO feed_cache (
      cache_key, feed_url, tz_override, item_limit, items_json, fetched_at, last_status, last_error
    ) VALUES (
      @cacheKey, @feedUrl, @tzOverride, @itemLimit, @itemsJson, @fetchedAt, @lastStatus, @lastError
    )
    ON CONFLICT(cache_key) DO UPDATE SET
      feed_url = excluded.feed_url,
      tz_override = excluded.tz_override,
      item_limit = excluded.item_limit,
      items_json = excluded.items_json,
      fetched_at = excluded.fetched_at,
      last_status = excluded.last_status,
      last_error = excluded.last_error
  `).run({
    cacheKey: input.cacheKey,
    feedUrl: input.feedUrl,
    tzOverride: input.tzOverride ?? null,
    itemLimit: input.itemLimit,
    itemsJson: JSON.stringify(input.items),
    fetchedAt: input.fetchedAt,
    lastStatus: input.lastStatus ?? null,
    lastError: input.lastError ?? null,
  });
}

export function updateFeedCacheError(cacheKey: string, status: number, error: string) {
  const db = getDb();
  db.prepare(`
    UPDATE feed_cache
    SET last_status = ?, last_error = ?
    WHERE cache_key = ?
  `).run(status, error, cacheKey);
}

export function pruneFeedCache(maxAgeMs: number) {
  const db = getDb();
  const cutoff = Date.now() - maxAgeMs;
  db.prepare("DELETE FROM feed_cache WHERE fetched_at < ?").run(cutoff);
}

export function getFeedCachePath() {
  return DB_PATH;
}
