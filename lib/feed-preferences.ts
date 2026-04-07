import { safeLocalStorageSetItem } from "./browser-storage";

export const FEED_ERR_KEY = "uw-feedErrors";
export const ENABLED_FEEDS_KEY = "uw-enabledFeeds";

type FeedErrorLog = Record<string, { counts: Record<number, number>; last: number }>;

function normalizeFeedErrorLog(input: unknown): FeedErrorLog {
  if (!input || typeof input !== "object") return {};

  const entries = Object.entries(input as Record<string, unknown>);
  const normalized: FeedErrorLog = {};

  for (const [url, value] of entries) {
    if (!value || typeof value !== "object") continue;

    const countsRaw =
      "counts" in value && value.counts && typeof value.counts === "object"
        ? (value.counts as Record<string, unknown>)
        : {};
    const counts: Record<number, number> = {};

    for (const [code, count] of Object.entries(countsRaw)) {
      const status = Number(code);
      const total = Number(count);
      if (Number.isFinite(status) && Number.isFinite(total)) {
        counts[status] = total;
      }
    }

    const lastRaw = "last" in value ? Number(value.last) : 0;
    normalized[url] = {
      counts,
      last: Number.isFinite(lastRaw) ? lastRaw : 0,
    };
  }

  return normalized;
}

export function getEnabledFeeds(): string[] | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(ENABLED_FEEDS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : null;
  } catch {
    return null;
  }
}

export function setEnabledFeeds(urls: string[]) {
  if (typeof window === "undefined") return;

  try {
    safeLocalStorageSetItem(ENABLED_FEEDS_KEY, JSON.stringify(Array.from(new Set(urls))));
  } catch {}
}

export function getFeedErrorLog(): FeedErrorLog {
  if (typeof window === "undefined") return {};

  try {
    const raw = localStorage.getItem(FEED_ERR_KEY);
    return raw ? normalizeFeedErrorLog(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function logFeedHttpError(url: string, status: number) {
  if (typeof window === "undefined") return;
  if (status !== 404 && status !== 502) return;

  try {
    const data = getFeedErrorLog();
    const entry = data[url] || { counts: {}, last: 0 };
    entry.counts[status] = (entry.counts[status] || 0) + 1;
    entry.last = Date.now();
    data[url] = entry;
    safeLocalStorageSetItem(FEED_ERR_KEY, JSON.stringify(data));
  } catch {}
}

export function getBadFeeds(threshold = 1) {
  const data = getFeedErrorLog();

  return Object.entries(data)
    .map(([url, value]) => ({
      url,
      "404": value.counts[404] || 0,
      "502": value.counts[502] || 0,
      total: (value.counts[404] || 0) + (value.counts[502] || 0),
      lastSeen: Number.isFinite(value.last) && value.last > 0 ? new Date(value.last).toISOString() : "",
    }))
    .filter((entry) => entry.total >= threshold)
    .sort((a, b) => b.total - a.total || a.url.localeCompare(b.url));
}

export function hasFeedError(url: string) {
  const data = getFeedErrorLog();
  const entry = data[url];
  if (!entry) return false;
  return (entry.counts[404] || 0) + (entry.counts[502] || 0) > 0;
}
