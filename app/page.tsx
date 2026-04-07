"use client";

import DOMPurify from "isomorphic-dompurify";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import Link from "next/link";
import DetailsSheet from "../components/DetailsSheet";
import { safeLocalStorageSetItem } from "../lib/browser-storage";
import { formatAbsoluteTimestamp, timeAgo } from "../lib/date-format";
import type { FeedItem, FeedsConfig } from "../lib/feed";
import { getBadFeeds, getEnabledFeeds, logFeedHttpError } from "../lib/feed-preferences";

const FEED_CONCURRENCY = 6;
const FEED_ITEM_LIMIT = 20;
const VIEW_MODE_KEY = "reader:viewMode";

type ViewMode = "grid4" | "list" | "frontpage";

function domainFromURL(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(html?: string | null) {
  if (!html) return "";

  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function summaryFromItem(item: FeedItem, maxLength = 220) {
  const text = stripHtml(item.description);
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

function NewspaperPreview({
  item,
  className,
  onOpen,
  summaryLength = 180,
  titleClassName,
  imageRatioClassName = "aspect-[16/10]",
  imageHeightClassName,
  showImage = true,
}: {
  item: FeedItem;
  className?: string;
  onOpen: (item: FeedItem) => void;
  summaryLength?: number;
  titleClassName?: string;
  imageRatioClassName?: string;
  imageHeightClassName?: string;
  showImage?: boolean;
}) {
  const summary = summaryFromItem(item, summaryLength);
  const hasImage = !isBadImage(item.image);

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className={`block w-full text-left ${className || ""}`}
      aria-label={`Open article: ${item.title}`}
    >
      <article className="h-full border border-[var(--border)] p-3 md:p-4">
        {showImage && hasImage && (
          <div className="mb-3 overflow-hidden border border-[var(--border)]">
            <div className={`${imageHeightClassName || imageRatioClassName} bg-[var(--background-alt)]`}>
              <img src={item.image!} alt="" className="h-full w-full object-cover" loading="lazy" />
            </div>
          </div>
        )}

        <div className="font-mono text-[10px] uppercase tracking-[0.18em] muted-text">
          {domainFromURL(item.link || item.source)}
        </div>
        <h3 className={`font-display mt-2 leading-tight ${titleClassName || "text-[1.6rem] md:text-[1.9rem]"}`}>
          {item.title}
        </h3>
        {summary && <p className="mt-3 text-sm leading-6 muted-text">{summary}</p>}
        <div className="mt-4 flex items-end justify-between gap-3 border-t border-[var(--border)] pt-2 text-[10px]">
          <span className="font-mono uppercase tracking-[0.16em]">
            {item.published ? formatAbsoluteTimestamp(item.published) : "Latest edition"}
          </span>
          {item.published && <span className="font-mono">{timeAgo(item.published)}</span>}
        </div>
      </article>
    </button>
  );
}

function NewspaperFrontPage({
  items,
  onOpen,
}: {
  items: FeedItem[];
  onOpen: (item: FeedItem) => void;
}) {
  const frontPage = items.slice(0, 30);
  const lead = frontPage[0];
  const rightRailTop = frontPage[1];
  const rightRailBottom = frontPage[2];
  const bodyStories = frontPage.slice(3);

  if (!lead) return null;

  return (
    <section className="border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]">
      <div className="grid gap-0 xl:grid-cols-[1.65fr_0.95fr]">
        <div className="border-b border-r border-[var(--border)] xl:border-b-0">
          <NewspaperPreview
            item={lead}
            onOpen={onOpen}
            className="h-full"
            summaryLength={340}
            titleClassName="text-[2.2rem] md:text-[3.4rem]"
            imageHeightClassName="h-[20rem] md:h-[32rem]"
          />
        </div>
        <div className="grid border-b border-[var(--border)] xl:border-b-0 xl:grid-rows-2">
          {rightRailTop && (
            <div className="border-b border-[var(--border)]">
              <NewspaperPreview
                item={rightRailTop}
                onOpen={onOpen}
                className="h-full"
                summaryLength={150}
                titleClassName="text-[1.6rem] md:text-[2rem]"
                imageHeightClassName="h-[14rem] md:h-[16rem]"
              />
            </div>
          )}
          {rightRailBottom && (
            <div>
              <NewspaperPreview
                item={rightRailBottom}
                onOpen={onOpen}
                className="h-full"
                summaryLength={150}
                titleClassName="text-[1.45rem] md:text-[1.8rem]"
                imageRatioClassName="aspect-[16/8]"
              />
            </div>
          )}
        </div>
      </div>

      {bodyStories.length > 0 && (
        <div className="border-t border-[var(--border)] px-0 py-0 lg:columns-2 lg:gap-0">
          {bodyStories.map((item, index) => (
            (() => {
              const variant = index % 8;
              const summaryLength =
                variant === 0 ? 235 :
                variant === 1 ? 85 :
                variant === 2 ? 145 :
                variant === 3 ? 110 :
                variant === 4 ? 175 :
                variant === 5 ? 70 :
                variant === 6 ? 125 :
                95;
              const titleClassName =
                variant === 0 ? "text-[1.9rem] md:text-[2.55rem]" :
                variant === 1 ? "text-[1.02rem] md:text-[1.18rem]" :
                variant === 2 ? "text-[1.3rem] md:text-[1.7rem]" :
                variant === 3 ? "text-[1.15rem] md:text-[1.35rem]" :
                variant === 4 ? "text-[1.55rem] md:text-[2rem]" :
                variant === 5 ? "text-[1rem] md:text-[1.12rem]" :
                variant === 6 ? "text-[1.22rem] md:text-[1.5rem]" :
                "text-[1.08rem] md:text-[1.28rem]";
              const imageHeightClassName =
                variant === 0 ? "h-[17rem] md:h-[23rem]" :
                variant === 2 ? "h-[11rem] md:h-[14rem]" :
                variant === 4 ? "h-[14rem] md:h-[18rem]" :
                variant === 7 ? "h-[10rem] md:h-[13rem]" :
                undefined;
              const imageRatioClassName =
                variant === 3 ? "aspect-[16/8]" :
                variant === 6 ? "aspect-[4/5]" :
                "aspect-[16/10]";
              const showImage = ![1, 5].includes(variant);

              return (
                <div
                  key={item.id}
                  className={`break-inside-avoid ${index > 0 ? "border-t border-[var(--border)]" : ""}`}
                >
                  <NewspaperPreview
                    item={item}
                    onOpen={onOpen}
                    summaryLength={summaryLength}
                    titleClassName={titleClassName}
                    imageHeightClassName={imageHeightClassName}
                    imageRatioClassName={imageRatioClassName}
                    showImage={showImage}
                  />
                </div>
              );
            })()
          ))}
        </div>
      )}

    </section>
  );
}

function ViewIcon({
  mode,
  active,
}: {
  mode: ViewMode;
  active: boolean;
}) {
  const stroke = active ? "currentColor" : "currentColor";

  if (mode === "grid4") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke={stroke} strokeWidth="1.5">
        <rect x="2.5" y="2.5" width="5" height="5" />
        <rect x="12.5" y="2.5" width="5" height="5" />
        <rect x="2.5" y="12.5" width="5" height="5" />
        <rect x="12.5" y="12.5" width="5" height="5" />
      </svg>
    );
  }

  if (mode === "frontpage") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke={stroke} strokeWidth="1.5">
        <rect x="2.5" y="3" width="15" height="14" />
        <path d="M5 6h7" />
        <path d="M5 9h7" />
        <path d="M5 12h4" />
        <rect x="11.5" y="11" width="3.5" height="3.5" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke={stroke} strokeWidth="1.5">
      <path d="M3 5.5h14" />
      <path d="M3 10h14" />
      <path d="M3 14.5h14" />
    </svg>
  );
}

function ActionIcon({ kind }: { kind: "feeds" | "health" | "refresh" | "theme" }) {
  if (kind === "feeds") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 5h14" />
        <path d="M3 10h14" />
        <path d="M3 15h14" />
        <path d="M6 5v10" />
      </svg>
    );
  }

  if (kind === "health") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 10h3l2-4 3 8 2-4h4" />
      </svg>
    );
  }

  if (kind === "refresh") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M16 10a6 6 0 1 1-1.76-4.24" />
        <path d="M16 4v4h-4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="10" cy="10" r="3.5" />
      <path d="M10 2.5v2" />
      <path d="M10 15.5v2" />
      <path d="M2.5 10h2" />
      <path d="M15.5 10h2" />
      <path d="M4.7 4.7l1.4 1.4" />
      <path d="M13.9 13.9l1.4 1.4" />
      <path d="M15.3 4.7l-1.4 1.4" />
      <path d="M6.1 13.9l-1.4 1.4" />
    </svg>
  );
}

function resolveTzOverride(feedUrl: string, config?: FeedsConfig | null) {
  const map = config?.tzOverrides;
  if (!map) return null;

  for (const key of Object.keys(map)) {
    if (feedUrl.includes(key)) return map[key];
  }

  return null;
}

const sanitizeHtml = (html?: string | null, baseHref?: string): string => {
  if (!html) return "";
  if (typeof window === "undefined") return html;

  try {
    const clean = DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["script", "style"],
      FORBID_ATTR: ["onerror", "onclick"],
      RETURN_DOM: true,
    }) as DocumentFragment;

    const container = document.createElement("div");
    container.appendChild(clean);

    container.querySelectorAll("a[href]").forEach((anchor) => {
      const href = anchor.getAttribute("href");
      if (!href) return;

      try {
        anchor.setAttribute("href", new URL(href, baseHref || window.location.origin).toString());
      } catch {}

      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    });

    container.querySelectorAll("img[src]").forEach((img) => {
      const src = img.getAttribute("src");
      if (!src) return;

      try {
        img.setAttribute("src", new URL(src, baseHref || window.location.origin).toString());
      } catch {}

      img.setAttribute("loading", "lazy");
      img.setAttribute("decoding", "async");
    });

    return container.innerHTML;
  } catch {
    return html;
  }
};

function isBadImage(url?: string | null) {
  if (!url) return true;
  return /spacer|pixel|blank|\.gif(\?|$)/i.test(url);
}

async function fetchFeed(
  feedUrl: string,
  signal?: AbortSignal,
  forceLocalTZ?: string,
  bust?: number
): Promise<FeedItem[]> {
  const params = new URLSearchParams({
    u: feedUrl,
    limit: String(FEED_ITEM_LIMIT),
    b: String(bust ?? 0),
  });

  if (forceLocalTZ) params.set("tz", forceLocalTZ);

  const response = await fetch(`/api/rss?${params.toString()}`, {
    signal,
    cache: "no-store",
  });

  if (!response.ok) {
    logFeedHttpError(feedUrl, response.status);
    const error = new Error(`HTTP ${response.status} for ${feedUrl}`) as Error & {
      status?: number;
      url?: string;
    };
    error.status = response.status;
    error.url = feedUrl;
    throw error;
  }

  const items = (await response.json()) as FeedItem[];
  return items.map((item) => ({
    ...item,
    description: item.description ? sanitizeHtml(item.description, item.link || feedUrl) : undefined,
  }));
}

async function runWithConcurrency<T>(
  items: string[],
  limit: number,
  worker: (item: string) => Promise<T>
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(items.length);
  let nextIndex = 0;

  async function runner() {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;

      try {
        results[current] = {
          status: "fulfilled",
          value: await worker(items[current]),
        };
      } catch (reason) {
        results[current] = {
          status: "rejected",
          reason,
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runner())
  );

  return results;
}

export default function Page() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [bust, setBust] = useState(0);
  const [config, setConfig] = useState<FeedsConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [active, setActive] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid4");
  const [enabledFeeds, setEnabledFeeds] = useState<string[] | null>(null);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeedItem | null>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const syncEnabledFeeds = () => setEnabledFeeds(getEnabledFeeds());

    syncEnabledFeeds();
    window.addEventListener("storage", syncEnabledFeeds);
    window.addEventListener("focus", syncEnabledFeeds);

    return () => {
      window.removeEventListener("storage", syncEnabledFeeds);
      window.removeEventListener("focus", syncEnabledFeeds);
    };
  }, []);

  useEffect(() => {
    try {
      const stored =
        typeof window !== "undefined"
          ? localStorage.getItem(VIEW_MODE_KEY)
          : null;
      if (stored === "grid4" || stored === "list" || stored === "frontpage") {
        setViewMode(stored);
      }
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setConfigError(null);
        const response = await fetch(`/feeds.json?b=${bust}`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Failed to load feeds.json (${response.status})`);
        }

        const json = (await response.json()) as FeedsConfig;
        if (!cancelled) setConfig(json);
      } catch (err) {
        if (!cancelled) {
          setConfigError(err instanceof Error ? err.message : "Failed to load feeds.json");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bust]);

  const categories = useMemo(() => {
    if (!config) return [] as FeedsConfig["categories"];

    const base = [...config.categories]
      .filter((category) => category.enabled !== false)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    return [{ key: "all", label: "All", emoji: "" }, ...base];
  }, [config]);

  useEffect(() => {
    if (!categories.length) return;

    const last =
      typeof window !== "undefined"
        ? localStorage.getItem("reader:lastCategory")
        : null;

    const initial =
      last && categories.some((category) => category.key === last)
        ? last
        : categories[0].key;

    setActive(initial);
  }, [categories]);

  useEffect(() => {
    if (active) safeLocalStorageSetItem("reader:lastCategory", active);
  }, [active]);

  useEffect(() => {
    safeLocalStorageSetItem(VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (!active) return;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [active]);

  const feedsForActive = useMemo(() => {
    if (!config) return [];

    if (active === "all") {
      const enabledKeys = config.categories
        .filter((category) => category.enabled !== false)
        .map((category) => category.key);

      const allFeeds = Array.from(new Set(enabledKeys.flatMap((key) => config.feeds[key] ?? [])));
      return enabledFeeds ? allFeeds.filter((url) => enabledFeeds.includes(url)) : allFeeds;
    }

    const categoryFeeds = config.feeds[active] ?? [];
    return enabledFeeds ? categoryFeeds.filter((url) => enabledFeeds.includes(url)) : categoryFeeds;
  }, [active, config, enabledFeeds]);

  useEffect(() => {
    if (!active) return;

    const loadCategory = async () => {
      if (!feedsForActive.length) {
        setItems([]);
        setError(null);
        return;
      }

      const myId = ++requestIdRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);
      setSelected(null);

      const all = await runWithConcurrency(
        feedsForActive,
        FEED_CONCURRENCY,
        (url) => fetchFeed(url, controller.signal, resolveTzOverride(url, config) || undefined, bust)
      );

      if (myId !== requestIdRef.current) return;

      const failedFeeds = all.filter((result) => result.status === "rejected");

      const seenLinks = new Set<string>();
      const seenTitles = new Set<string>();
      const mergedWithTS = all
        .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
        .filter((item) => {
          const normalizedLink = item.link.trim();
          if (normalizedLink) {
            if (seenLinks.has(normalizedLink)) return false;
            seenLinks.add(normalizedLink);
          }

          const normalized = normalizeTitle(item.title);
          if (!normalized) return true;
          if (seenTitles.has(normalized)) return false;
          seenTitles.add(normalized);
          return true;
        })
        .map((item) => {
          const timestamp = item.published ? Date.parse(item.published) : Number.NaN;
          return { ...item, _ts: Number.isFinite(timestamp) ? timestamp : -Infinity };
        })
        .sort((a, b) => (b._ts - a._ts) || b.link.localeCompare(a.link));

      const maxAgeDays = Math.max(0, config?.filters?.maxAgeDays ?? 7);
      const ageCutoff = maxAgeDays > 0 ? Date.now() - maxAgeDays * 86_400_000 : null;
      const ageFiltered =
        ageCutoff === null
          ? mergedWithTS
          : mergedWithTS.filter((item) => item._ts >= ageCutoff);

      const blocked = (config?.filters?.blockedCategories ?? []).map((value) => value.toLowerCase());
      const filtered =
        blocked.length === 0
          ? ageFiltered
          : ageFiltered.filter((item) => {
              const categories = (item.categories || []).map((category) => category.toLowerCase());
              return !blocked.some((entry) => categories.some((category) => category.includes(entry)));
            });

      setItems(filtered.map(({ _ts, ...item }) => item));

      if (failedFeeds.length === feedsForActive.length) {
        setError("Failed to load every feed in this category.");
      } else if (failedFeeds.length > 0) {
        setError(`Loaded with ${failedFeeds.length} feed failure${failedFeeds.length === 1 ? "" : "s"}.`);
      }

      setLoading(false);
    };

    loadCategory().catch((err) => {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed");
      setLoading(false);
    });
  }, [active, bust, config, feedsForActive]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return (
    <main className="mx-auto max-w-7xl px-3 pb-24 pt-4 md:px-5">
      <section className="surface-panel-strong relative overflow-hidden rounded-[2rem] px-4 py-5 md:px-8 md:py-7">
        <div className="relative">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex items-center gap-4">
                <img
                  src="/underwire_light.png"
                  alt="UNDERWIRE"
                  className="h-14 w-auto dark:hidden md:h-16"
                />
                <img
                  src="/underwire_dark.png"
                  alt="UNDERWIRE"
                  className="hidden h-14 w-auto dark:block md:h-16"
                />
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 border-t border-[var(--border)] pt-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <nav className="overflow-x-auto">
                <div className="inline-flex gap-2 pb-1">
                  {categories.map((category) => (
                    <button
                      key={category.key}
                      onClick={() => setActive(category.key)}
                      aria-pressed={category.key === active}
                      className={`font-ui px-3 py-1.5 text-xs transition ${
                        category.key === active
                          ? "theme-button-active"
                          : "theme-button"
                      }`}
                    >
                      <span className="mr-1.5">{category.emoji}</span>
                      {category.label}
                    </button>
                  ))}
                </div>
              </nav>

              <div className="flex flex-wrap gap-2">
                <div className="flex border border-[var(--border)]">
                  {(["grid4", "list", "frontpage"] as ViewMode[]).map((mode) => {
                    const activeMode = viewMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setViewMode(mode)}
                        aria-pressed={activeMode}
                        title={
                          mode === "grid4"
                            ? "Dense grid"
                            : mode === "list"
                              ? "List view"
                              : "Newspaper front page"
                        }
                        className={`flex items-center justify-center border-r border-[var(--border)] px-3 py-1.5 text-xs last:border-r-0 ${
                          activeMode
                            ? "theme-button-active"
                            : "theme-button"
                        }`}
                      >
                        <ViewIcon mode={mode} active={activeMode} />
                      </button>
                    );
                  })}
                </div>
                <Link
                  href="/feeds"
                  className="theme-button inline-flex items-center justify-center px-3 py-1.5 text-xs transition"
                  aria-label="Manage feeds"
                  title="Manage feeds"
                >
                  <ActionIcon kind="feeds" />
                </Link>
                <button
                  onClick={() => {
                    const bad = getBadFeeds(1);
                    if (bad.length) {
                      console.table(bad);
                      alert(`Printed ${bad.length} bad feeds to the console.\n(404/502 only)`);
                    } else {
                      alert("No bad feeds logged yet.");
                    }
                  }}
                  className="theme-button inline-flex items-center justify-center px-3 py-1.5 text-xs transition"
                  aria-label="Feed health"
                  title="Feed health"
                >
                  <ActionIcon kind="health" />
                </button>
                <button
                  onClick={() => setBust((value) => value + 1)}
                  className="theme-button inline-flex items-center justify-center px-3 py-1.5 text-xs transition"
                  aria-label="Refresh"
                  title="Refresh"
                >
                  <ActionIcon kind="refresh" />
                </button>
                {mounted && (
                  <button
                    onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                    className="theme-button inline-flex items-center justify-center px-3 py-1.5 text-xs transition"
                    aria-label="Toggle theme"
                    title={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
                  >
                    <ActionIcon kind="theme" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {!config && !configError && (
        <div className="surface-panel mt-6 rounded-[1.75rem] px-5 py-4 text-sm muted-text">
          Loading sources…
        </div>
      )}
      {configError && (
        <div className="surface-panel mt-6 rounded-[1.75rem] px-5 py-4 text-sm">
          {configError}
        </div>
      )}

      {config && (
        <section className="mt-6">
          {loading && (
            <div className="surface-panel mb-4 rounded-[1.5rem] px-5 py-4 text-sm muted-text">
              Loading {categories.find((category) => category.key === active)?.label}…
            </div>
          )}
          {!loading && !error && !items.length && (
            <div className="surface-panel mb-4 rounded-[1.5rem] px-5 py-5 text-sm muted-text">
              No articles are available right now. Review your source selections on{" "}
              <Link href="/feeds" className="underline underline-offset-4">
                the feeds page
              </Link>
              .
            </div>
          )}

          {viewMode === "frontpage" ? (
            <NewspaperFrontPage
              items={items}
              onOpen={setSelected}
            />
          ) : (
            <ul
              className={`grid gap-4 ${
                viewMode === "list"
                  ? "grid-cols-1"
                  : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
              }`}
            >
              {items.map((item) => {
                const showImg = !isBadImage(item.image) ? item.image : null;
                const isSelected = selected?.id === item.id;

                return (
                  <li
                    key={item.id}
                    className={`surface-panel group overflow-hidden rounded-[1.75rem] transition duration-300 ${
                      isSelected ? "ring-1 ring-[var(--foreground)]" : "hover:-translate-y-0.5"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelected(item)}
                      className="block w-full text-left"
                      aria-label={`Preview: ${item.title}`}
                    >
                      <div className={viewMode === "list" ? "flex flex-col md:flex-row" : ""}>
                        <div className={`relative ${viewMode === "list" ? "md:w-[18rem] md:min-w-[18rem]" : ""}`}>
                          <div className={`overflow-hidden bg-[var(--background-alt)] ${viewMode === "list" ? "aspect-[16/10] md:h-full md:min-h-[12rem] md:aspect-auto" : "aspect-[16/10]"}`}>
                            {showImg ? (
                              <img
                                src={showImg}
                                alt=""
                                loading="lazy"
                                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                              />
                            ) : (
                              <div className="flex h-full items-end bg-[var(--background-alt)] p-5">
                                <div className="font-mono muted-text text-xs uppercase tracking-[0.24em]">
                                  {domainFromURL(item.link || item.source)}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className={`p-5 ${viewMode === "list" ? "flex min-w-0 flex-1 flex-col" : "flex min-h-[15rem] flex-col"}`}>
                          <div className="flex-1">
                            <h3
                              className={`font-display leading-tight ${
                                viewMode === "grid4"
                                  ? "mt-1 text-[1.08rem] md:text-[1.15rem]"
                                  : viewMode === "list"
                                    ? "mt-0 text-[1.2rem] md:text-[1.35rem]"
                                    : "mt-2 text-[1.25rem] md:text-[1.35rem]"
                              }`}
                            >
                              {item.title}
                            </h3>

                            {Array.isArray(item.categories) && item.categories.length > 0 && (
                              <div className="mt-4 flex flex-wrap gap-2">
                                {item.categories.slice(0, viewMode === "grid4" ? 2 : 3).map((category) => (
                                  <span
                                    key={`${item.id}-${category}`}
                                    className="accent-chip px-2.5 py-1 text-[11px]"
                                    title={category}
                                  >
                                    {category}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="mt-5">
                            {isSelected && (
                              <div className="mb-2 text-right text-xs muted-text">
                                Reading now
                              </div>
                            )}
                            <div className="flex items-end justify-between gap-3 text-[10px]">
                              <span className="font-mono uppercase tracking-[0.16em]">
                                {domainFromURL(item.link || item.source)}
                              </span>
                              {item.published && (
                                <time
                                  className="font-mono"
                                  dateTime={item.published}
                                  title={formatAbsoluteTimestamp(item.published)}
                                >
                                  {timeAgo(item.published)}
                                </time>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <DetailsSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        item={selected}
      />
    </main>
  );
}
