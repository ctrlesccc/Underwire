"use client";

import DOMPurify from "isomorphic-dompurify";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import DetailsSheet from "../components/DetailsSheet";

// ---------- runtime config types ----------
type FeedsConfig = {
  categories: { key: string; label: string; emoji: string; order?: number; enabled?: boolean }[];
  feeds: Record<string, string[]>;
  filters?: {
    maxAgeDays?: number;
    blockedCategories?: string[];
  };
  tzOverrides?: Record<string, string>; // e.g. { "nos.nl": "Europe/Amsterdam" }
};


// ---------- app types ----------
type FeedItem = {
  id: string;
  title: string;
  link: string;
  published?: string;
  image?: string | null;
  source: string;
  description?: string;
  categories?: string[]; // <-- added
};





// ---- timezone formatting helpers ----
const TARGET_TZ = "Europe/Amsterdam" as const;   // was "Europe/Amsterdam"


const DEFAULT_LOCALE = "nl-NL" as const;
const DEFAULT_TZ = "Europe/Amsterdam" as const; // was "Europe/Amsterdam"

function formatInTZ(iso?: string, opts?: Intl.DateTimeFormatOptions) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";

  // Start with base; allow caller to override timeZone via opts.timeZone
  const tz = (opts && opts.timeZone) || DEFAULT_TZ;

  // Build options imperatively to keep TS happy
  const finalOpts: Intl.DateTimeFormatOptions = { timeZone: tz, hour12: false };

  const hasSpecific =
    !!opts &&
    (opts.year !== undefined || opts.month !== undefined || opts.day !== undefined ||
     opts.hour !== undefined || opts.minute !== undefined || opts.second !== undefined ||
     opts.timeZoneName !== undefined || opts.timeZone !== undefined);

  if (hasSpecific) {
    Object.assign(finalOpts, opts);

    // Avoid runtime error: timeZoneName can't be combined with dateStyle/timeStyle
    if (finalOpts.timeZoneName && (finalOpts.dateStyle || finalOpts.timeStyle)) {
      delete (finalOpts as any).dateStyle;
      delete (finalOpts as any).timeStyle;
    }
  } else {
    finalOpts.dateStyle = "short";
    finalOpts.timeStyle = "medium";
  }

  return d.toLocaleString(DEFAULT_LOCALE, finalOpts);
}


type FeedErrorLog = Record<
  string,
  { counts: Record<number, number>; last: number }
>;

const FEED_ERR_KEY = "uw-feedErrors";

function logFeedHttpError(url: string, status: number) {
  try {
    if (typeof window === "undefined") return;
    if (status !== 404 && status !== 502) return; // only track 404/502

    const raw = localStorage.getItem(FEED_ERR_KEY);
    const data: FeedErrorLog = raw ? JSON.parse(raw) : {};

    const entry = data[url] || { counts: {}, last: 0 };
    entry.counts[status] = (entry.counts[status] || 0) + 1;
    entry.last = Date.now();
    data[url] = entry;

    localStorage.setItem(FEED_ERR_KEY, JSON.stringify(data));
  } catch {}
}

function getBadFeeds(threshold = 1) {
  // threshold = min total 404+502 sightings to consider “bad”
  try {
    const raw = localStorage.getItem(FEED_ERR_KEY);
    if (!raw) return [];
    const data: FeedErrorLog = JSON.parse(raw);
    return Object.entries(data)
      .map(([url, v]) => ({
        url,
        "404": v.counts[404] || 0,
        "501": v.counts[501] || 0,
        "502": v.counts[502] || 0,
        "503": v.counts[502] || 0,
        "504": v.counts[502] || 0,
        total: (v.counts[404] || 0) + (v.counts[501] || 0)+ (v.counts[502] || 0)+ (v.counts[503] || 0)+ (v.counts[504] || 0),
        lastSeen: new Date(v.last).toISOString(),
      }))
      .filter((r) => r.total >= threshold)
      .sort((a, b) => b.total - a.total || a.url.localeCompare(b.url));
  } catch {
    return [];
  }
}

function clearBadFeedLog() {
  try {
    localStorage.removeItem(FEED_ERR_KEY);
  } catch {}
}

// Get the timezone offset (in minutes) for a given IANA zone at a given UTC instant.
function tzOffsetMinutesAt(date: Date, timeZone: string): number {
  // Format the UTC instant in the target zone, then rebuild a UTC timestamp from those parts.
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const data: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") data[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(data.year),
    Number(data.month) - 1,
    Number(data.day),
    Number(data.hour),
    Number(data.minute),
    Number(data.second || "0")
  );
  // Positive result means zone is ahead of UTC (e.g., CEST = +120)
  return Math.round((asUTC - date.getTime()) / 60000);
}

/**
 * Treat an ISO moment as if its *wall time* belongs to `timeZone`.
 * Example: "2025-08-19T18:55:00Z" + Europe/Amsterdam (UTC+2) -> "2025-08-19T16:55:00Z"
 * Use ONLY for mislabelled feeds that stuck "Z" on local times.
 */
function coerceIsoAssumingLocalZone(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const offMin = tzOffsetMinutesAt(d, timeZone);
  const corrected = new Date(d.getTime() - offMin * 60_000);
  return corrected.toISOString();
}

// Find override TZ for a feed URL using config.tzOverrides (key match by substring)
function resolveTzOverride(feedUrl: string, cfg?: FeedsConfig | null): string | null {
  const map = cfg?.tzOverrides;
  if (!map) return null;
  for (const key of Object.keys(map)) {
    if (feedUrl.includes(key)) return map[key];
  }
  return null;
}



// Handy preset when you want the TZ in the tooltip:
function formatInTZWithTZName(iso?: string) {
  return formatInTZ(iso, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}



// ---------- helpers ----------
const fifteenMinutes = 15 * 60 * 1000;

function domainFromURL(url: string) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function cacheKey(feedUrl: string) {
  return `rsscache:${feedUrl}`;
}

function extractFirstImg(el: Element): string | null {
  const candidates = ["content:encoded", "content", "description", "summary"];
  for (const tag of candidates) {
    const node = el.getElementsByTagName(tag)[0];
    if (!node) continue;
    const html = node.textContent || "";
    const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m) return m[1];
  }
  return null;
}

function normalizeLink(url: string) {
  try {
    const u = new URL(url);
    const drop = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ito",
      "icid",
      "mc_cid",
      "mc_eid",
      "mbid",
      "cmpid",
      "smid",
      "ref",
      "fbclid",
      "gclid",
      "igshid",
      "xtor",
    ];
    drop.forEach((p) => u.searchParams.delete(p));
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
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

    container.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href")!;
      try {
        const abs = new URL(
          href,
          baseHref || window.location.origin
        ).toString();
        a.setAttribute("href", abs);
      } catch {}
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });

    return container.innerHTML;
  } catch {
    return html;
  }
};


function isBadImage(url?: string | null) {
  if (!url) return true;
  const lower = url.toLowerCase();
  return /spacer|pixel|blank|\.gif(\?|$)/.test(lower);
}

function timeAgo(iso?: string) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";

  const now = Date.now();
  let diff = now - t;               // ms
  const future = diff < 0;
  diff = Math.abs(diff);

  const mins = Math.floor(diff / 60_000);
  const hrs  = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (mins < 1) return future ? "in <1m" : "just now";
  if (mins < 60) return future ? `in ${mins}m` : `${mins}m ago`;
  if (hrs  < 24) return future ? `in ${hrs}h`  : `${hrs}h ago`;
  return future ? `in ${days}d` : `${days}d ago`;
}


function parseRssDateToISO(input?: string): string | undefined {
  if (!input) return undefined;
  let s = input.trim();

  // Drop trailing "(CEST)" etc.
  s = s.replace(/\s*\([^)]+\)\s*$/, "");

  // Normalize known textual zones before trying native parse.

  // 1) UT/UTC/GMT → +0000
  if (/\s(?:UT|UTC|GMT)$/i.test(s)) {
    s = s.replace(/\s(?:UT|UTC|GMT)$/i, " +0000");
  }

  // 2) Single-letter military zones (RFC 2822). J is unused.
  const m = s.match(/\s([A-IK-Z])$/i);
  if (m) {
    const z = m[1].toUpperCase();
    const map: Record<string, string> = {
      Z: "+0000",
      A: "-0100",
      B: "-0200",
      C: "-0300",
      D: "-0400",
      E: "-0500",
      F: "-0600",
      G: "-0700",
      H: "-0800",
      I: "-0900",
      K: "-1000",
      L: "-1100",
      M: "-1200",
      N: "+0100",
      O: "+0200",
      P: "+0300",
      Q: "+0400",
      R: "+0500",
      S: "+0600",
      T: "+0700",
      U: "+0800",
      V: "+0900",
      W: "+1000",
      X: "+1100",
      Y: "+1200",
    };
    const off = map[z];
    if (off) s = s.replace(/\s([A-IK-Z])$/i, " " + off);
  }

  // 3) (Optional) Common abbreviations seen in feeds
  // (DST zones are heuristic; improves real-world feeds)
  s = s.replace(/\s([A-Z]{2,4})$/, (_m, abbr: string) => {
    const tz = {
      CET: "+0100",
      CEST: "+0200",
      EET: "+0200",
      EEST: "+0300",
      GMT: "+0000",
      WET: "+0000",
      WEST: "+0100",
      IST: "+0530", // India; beware Irish summer time ambiguity
      JST: "+0900",
      PST: "-0800",
      PDT: "-0700",
      MST: "-0700",
      MDT: "-0600",
      CST: "-0600",
      CDT: "-0500",
      EST: "-0500",
      EDT: "-0400",
      AEST: "+1000",
      AEDT: "+1100",
      ACST: "+0930",
      ACDT: "+1030",
      NZST: "+1200",
      NZDT: "+1300",
  
    } as Record<string, string>;
    const key = String(abbr).toUpperCase();
    return tz[key] ? " " + tz[key] : " " + abbr;
  });

  // 4) Now try native parse
  let d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString();

  // 5) 'YYYY-MM-DD HH:mm[:ss]' → assume UTC
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)) {
    d = new Date(s.replace(" ", "T") + "Z");
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  // 6) (Optional) 2-digit year repair (RFC 2822 guidance)
  // 00–49 → 2000–2049, 50–99 → 1950–1999
  const y2 = s.replace(
    /(^|,\s)(\d{1,2}\s+[A-Za-z]{3}\s+)(\d{2})(\s+\d{2}:\d{2}(?::\d{2})?(\s|$))/,
    (_m, pre, preDate, yy, post) => {
      const n = parseInt(yy, 10);
      const full = n >= 50 ? 1900 + n : 2000 + n;
      return `${pre}${preDate}${full}${post}`;
    }
  );
  if (y2 !== s) {
    d = new Date(y2);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  return undefined;
}
function parseRSS(xml: string, feedUrl: string, forceLocalTZ?: string): FeedItem[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const entries = Array.from(doc.querySelectorAll("entry, item")).slice(0, 50);

  return entries.map((el, i) => {
    const title = el.querySelector("title")?.textContent?.trim() || "(untitled)";

    let link =
      (el.querySelector("link[rel='alternate']") as Element | null)?.getAttribute("href") ||
      el.querySelector("link")?.textContent ||
      (el.querySelector("link") as Element | null)?.getAttribute("href") || "";
    link = normalizeLink(link || "");

    const publishedRaw =
      el.getElementsByTagName("published")[0]?.textContent ||
      el.getElementsByTagName("updated")[0]?.textContent ||
      el.getElementsByTagName("pubDate")[0]?.textContent ||
      el.getElementsByTagName("dc:date")[0]?.textContent ||
      el.getElementsByTagName("dcterms:created")[0]?.textContent ||
      el.getElementsByTagName("dcterms:modified")[0]?.textContent ||
      undefined;

    let publishedISO = parseRssDateToISO(publishedRaw);

    // If the feed is known to have "Z" but actually means local, correct it:
    if (forceLocalTZ && publishedISO) {
      publishedISO = coerceIsoAssumingLocalZone(publishedISO, forceLocalTZ);
    }

    const media =
      el.getElementsByTagName("media:content")[0]?.getAttribute("url") ||
      el.getElementsByTagName("media:thumbnail")[0]?.getAttribute("url") ||
      el.querySelector("enclosure[type^='image/']")?.getAttribute("url") ||
      (el.getElementsByTagName("itunes:image")[0] as Element | undefined)?.getAttribute("href") ||
      extractFirstImg(el);

    const rawDesc =
      el.getElementsByTagName("content:encoded")[0]?.textContent ||
      el.getElementsByTagName("content")[0]?.textContent ||
      el.getElementsByTagName("description")[0]?.textContent ||
      el.getElementsByTagName("summary")[0]?.textContent || "";

    const cats = [
      ...Array.from(el.getElementsByTagName("category")),
      ...Array.from(el.getElementsByTagName("dc:subject")),
    ]
      .map((c) => (c.getAttribute("term") || c.textContent || "").trim())
      .filter(Boolean);

    const id =
      el.querySelector("id")?.textContent ||
      el.querySelector("guid")?.textContent ||
      link || `${feedUrl}#${i}`;

    return {
      id,
      title,
      link: link || "",
      published: publishedISO, // ISO UTC string
      image: media || null,
      source: domainFromURL(feedUrl),
      description: rawDesc || undefined,
      categories: cats.length ? cats : undefined,
    };
  });
}



async function fetchFeed(
  feedUrl: string,
  signal?: AbortSignal,
  forceLocalTZ?: string,
  bust?: number
): Promise<FeedItem[]> {
  
  const key = cacheKey(feedUrl);
  const skipCache = !!bust; // when busting, ignore localStorage cache

  const cachedRaw = !skipCache && typeof window !== "undefined" ? localStorage.getItem(key) : null;
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw) as { t: number; items: FeedItem[]; tz?: string | null };
      // cache is still valid only if the same tz override applies
      const sameTZ = (cached as any).tz === (forceLocalTZ || null);
      if (Date.now() - cached.t < fifteenMinutes && sameTZ) return cached.items;
    } catch {}
  }

  const resp = await fetch(
    `/api/rss?u=${encodeURIComponent(feedUrl)}&b=${bust ?? 0}`,
    { signal, cache: "no-store" }
  );
  
  if (!resp.ok) {
  // record only 404/502 for pruning
  logFeedHttpError(feedUrl, resp.status);

  const err: any = new Error(`HTTP ${resp.status} for ${feedUrl}`);
  err.status = resp.status;
  err.url = feedUrl;
  throw err;
}
  
  if (!resp.ok) throw new Error(`Failed ${resp.status}`);
  const xml = await resp.text();

  // Pass override into parse; it will fix mislabelled Z→local
  const items = parseRSS(xml, feedUrl, forceLocalTZ);

if (!skipCache && typeof window !== "undefined") {
     localStorage.setItem(key, JSON.stringify({ t: Date.now(), items, tz: forceLocalTZ || null }));
  }
  return items;
}

// ---------- component ----------
export default function Page() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  
  const [bust, setBust] = useState(0);

// load runtime config (from /public/feeds.json)
const [config, setConfig] = useState<FeedsConfig | null>(null);
const [configError, setConfigError] = useState<string | null>(null);

useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      setConfigError(null);
      const res = await fetch(`/feeds.json?b=${bust}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load feeds.json (${res.status})`);
      const json = (await res.json()) as FeedsConfig;
      if (!cancelled) {
        setConfig(json);
        // helpful one-time visibility:
        console.debug("feeds.json loaded", {
          categories: json.categories.map(c => c.key),
          photographyCount: (json.feeds?.photography || []).length,
          photography: json.feeds?.photography
        });
      }
    } catch (e: any) {
      if (!cancelled) setConfigError(e?.message || "Failed to load feeds.json");
    }
  })();
  return () => { cancelled = true; };
}, [bust]);
;

  // categories and feeds derived from config
  const categories = useMemo(() => {
    if (!config) return [] as FeedsConfig["categories"];

    const base = [...config.categories]
      .filter((c) => c.enabled !== false)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    // Synthetic "All" item at the front (not in feeds.json)
    const allCat = { key: "all", label: "All", emoji: "" };
    return [allCat, ...base];
  }, [config]);

  const [active, setActive] = useState<string>("");
  useEffect(() => {
    if (!categories.length) return;
    const last =
      typeof window !== "undefined"
        ? localStorage.getItem("reader:lastCategory")
        : null;
    const initial =
      last && categories.some((c) => c.key === last) ? last : categories[0].key;
    setActive(initial);
  }, [categories]);

  useEffect(() => {
    if (active) localStorage.setItem("reader:lastCategory", active);
  }, [active]);

  // ⬇️ Scroll to top whenever the active category changes
  useEffect(() => {
    if (!active) return;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [active]);

  {
    /* const feedsForActive = useMemo(() => (config?.feeds[active] ?? []), [config, active]); */
  }
  const feedsForActive = useMemo(() => {
    if (!config) return [];

    if (active === "all") {
      // Use only *enabled* categories
      const enabledKeys = (config.categories || [])
        .filter((c) => c.enabled !== false)
        .map((c) => c.key);

      const urls = enabledKeys.flatMap((k) => config.feeds[k] ?? []);
      // De-dupe feed URLs to avoid duplicate fetches
      return Array.from(new Set(urls));
    }

    return config.feeds[active] ?? [];
  }, [config, active]);

  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeedItem | null>(null);
  


  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

async function loadCategory() {
  if (!feedsForActive.length) {
    setItems([]);
    return;
  }

 console.debug("Loading", active, "feeds:", feedsForActive);

  const myId = ++requestIdRef.current;
  abortRef.current?.abort();
  const controller = new AbortController();
  abortRef.current = controller;

  setLoading(true);
  setError(null);
  setSelected(null);

  try {
const all = await Promise.allSettled(
  feedsForActive.map((u) => {
    const tz = resolveTzOverride(u, config); // e.g., "Europe/Amsterdam" or null
    return fetchFeed(u, controller.signal, tz || undefined, bust);
  })
);
    if (myId !== requestIdRef.current) return;

    // Merge + de-dupe by link, compute numeric timestamp once
    const mergedWithTS = all
      .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
      .filter((v, i, arr) => v.link && arr.findIndex((x) => x.link === v.link) === i)
      .map((it) => {
        const ts = it.published ? Date.parse(it.published) : NaN; // published is ISO (Z) when parse succeeded
        return { ...it, _ts: Number.isFinite(ts) ? ts : -Infinity }; // undated → bottom
      })
      // newest first; tie-break by link for stable order
      .sort((a, b) => (b._ts - a._ts) || b.link.localeCompare(a.link));

    // Age filter via numeric _ts (skip if maxAgeDays === 0)
    const maxAgeDays = Math.max(0, config?.filters?.maxAgeDays ?? 7);
    const ageCutoff = maxAgeDays > 0 ? Date.now() - maxAgeDays * 86_400_000 : null;
    const ageFiltered = ageCutoff !== null
      ? mergedWithTS.filter((it) => it._ts >= ageCutoff)
      : mergedWithTS;

    // Category blocklist (case-insensitive "contains")
    const blockedLC = (config?.filters?.blockedCategories ?? []).map((s) => s.toLowerCase());
    const finalItemsWithTS = blockedLC.length
      ? ageFiltered.filter((it) => {
          const cats = (it.categories || []).map((c) => c.toLowerCase());
          return !blockedLC.some((b) => cats.some((c) => c.includes(b)));
        })
      : ageFiltered;

    // Strip helper field before setting state
    setItems(finalItemsWithTS.map(({ _ts, ...it }) => it));
  } catch (e: any) {
    if (e?.name !== "AbortError") setError(e?.message || "Failed");
  } finally {
    if (myId === requestIdRef.current) setLoading(false);
  }
}

const handleRefresh = async () => {
  // 1) Best-effort: clear Cache Storage (if a SW/PWA is involved)
  try {
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
  } catch {}

// 2) Clear any local/session storage your app uses
try {
  for (const k of Object.keys(localStorage)) {
    if (
      k.toLowerCase().includes("underwire") ||
      k.toLowerCase().includes("feed") ||
      k.startsWith("uw-") ||
      k.startsWith("rsscache:")
    ) {
      localStorage.removeItem(k);
    }
  }
  for (const k of Object.keys(sessionStorage)) {
    if (
      k.toLowerCase().includes("underwire") ||
      k.toLowerCase().includes("feed") ||
      k.startsWith("uw-") ||
      k.startsWith("rsscache:")
    ) {
      sessionStorage.removeItem(k);
    }
  }
} catch {}


  setBust((n) => n + 1);
};


useEffect(() => {
  if (active) loadCategory();
}, [active, feedsForActive, bust]);


  useEffect(() => () => abortRef.current?.abort(), []);

  return (
    <main className="max-w-7xl mx-auto px-3 pb-20">

      <header className="sticky top-0 z-40 bg-white dark:bg-[#0b0b0e] border-b border-black/5 dark:border-white/10">
        <div className="max-w-7xl mx-auto px-3 py-3 md:flex md:items-center md:gap-6">
          {/* LEFT: logo + desktop categories */}
          {/*<div className="flex items-center gap-4 min-w-0 flex-1">*/}
          <div className="flex flex-col items-start gap-2 min-w-0 flex-1">
            {/* logos */}
            <img
              src="/underwire_light.png"
              alt="UNDERWIRE"
              className="h-12 sm:h-14 md:h-16 w-auto dark:hidden"
            />
            <img
              src="/underwire_dark.png"
              alt="UNDERWIRE"
              className="hidden dark:block h-12 sm:h-14 md:h-16 w-auto"
            />

            {/* desktop categories inline */}
            {/*<nav className="hidden md:block min-w-0 overflow-x-auto">*/}
              <nav className="hidden md:block w-full mt-1 overflow-x-auto">
              <div className="inline-flex gap-1">
                {categories.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setActive(c.key)}
                    aria-pressed={c.key === active}
                    className={`px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition ${
                      c.key === active
                        ? "bg-gray-900 text-white dark:bg-white dark:text-black"
                        : "bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20"
                    }`}
                  >
                    <span className="mr-1">{c.emoji}</span>
                    {c.label}
                  </button>
                ))}
              </div>
            </nav>
          </div>

          {/* RIGHT: controls pinned top-right on desktop */}
          <div className="hidden md:flex items-center gap-2 ml-auto self-center">

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
  className="text-sm px-3 py-1.5 rounded-md bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20"
>
  Bad feeds
</button>


<button
  onClick={handleRefresh}
   className="text-sm px-3 py-1.5 rounded-md bg-gray-100 dark:bg-white/10 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-white/20"
>
  Refresh
</button>
            {mounted && (
              <button
                onClick={() =>
                  setTheme(resolvedTheme === "dark" ? "light" : "dark")
                }
                className="text-sm px-3 py-1.5 rounded-md bg-gray-100 dark:bg-white/10 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-white/20"
                aria-label="Toggle theme"
                title={`Switch to ${
                  resolvedTheme === "dark" ? "light" : "dark"
                } mode`}
              >
                {resolvedTheme === "dark" ? "🌞" : "🌙"}
              </button>
            )}
          </div>

          {/* MOBILE: categories on second row */}
          <nav className="md:hidden w-full mt-2">
            <div className="flex flex-wrap gap-0.5">
              {categories.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setActive(c.key)}
                  aria-pressed={c.key === active}
                  className={`px-1.5 py-0.5 rounded-md text-xs leading-4 transition ${
                    c.key === active
                      ? "bg-gray-900 text-white dark:bg-white dark:text-black"
                      : "bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20"
                  }`}
                >
                  <span className="mr-0.5">{c.emoji}</span>
                  {c.label}
                </button>
              ))}
            </div>
          </nav>
        </div>
      </header>

      {/* Config loading / error */}
      {!config && !configError && (
        <p className="mt-4 text-sm opacity-70">Loading sources…</p>
      )}
      {configError && (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">
          {configError}
        </p>
      )}

      {/* Two-column layout: list + conditional details */}
      {config && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* LIST */}
          <div className="md:col-span-3">
            {loading && (
              <p className="mt-2 text-sm opacity-70">
                Loading {categories.find((c) => c.key === active)?.label}…
              </p>
            )}
            {error && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}

            <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {items.map((it) => {
                const hasGoodImg = !isBadImage(it.image);
                const showImg = !isBadImage(it.image) ? (it.image as string) : null;
                const isSelected = selected?.id === it.id;

                return (
                  <li
                    key={it.id}
                    className="group rounded-xl border border-black/5 dark:border-white/10 bg-white/60 dark:bg-white/5 hover:bg-white/80 dark:hover:bg-white/10 transition cursor-pointer"
                    onClick={() => setSelected(it)}
                  >
                    {/* Image area */}
                    {showImg ? (
                      <button
                        type="button"
                        onClick={() => setSelected(it)}
                        className="block w-full"
                        aria-label={`Preview: ${it.title}`}
                      >
                        <div className="relative w-full">
                          <div className="aspect-[16/9] overflow-hidden rounded-2xl bg-gray-100 dark:bg-white/10">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={showImg}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          </div>
                          {/* Square-corner overlay aligned left, full width */}
                          <div className="absolute inset-x-0 bottom-0">
                            <div className="bg-black/45 backdrop-blur px-3 py-2 text-white text-sm leading-snug text-left rounded-none">
                              <span className="block whitespace-normal break-words [overflow-wrap:anywhere]">
                                {it.title}
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setSelected(it)}
                        className="block w-full"
                        aria-label={`Preview: ${it.title}`}
                      >
                        <div className="relative w-full">
                          <div className="aspect-[16/9] bg-gray-100 dark:bg-white/10" />
                          <div className="absolute inset-x-0 bottom-0">
                            <div className="bg-black/45 backdrop-blur px-3 py-2 text-white text-sm leading-snug text-left rounded-none">
                              <span className="block whitespace-normal break-words [overflow-wrap:anywhere]">
                                {it.title}
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    )}

                    <div className="p-3 text-xs">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <div className="min-w-0">
                          <div className="opacity-70 truncate">
                            {domainFromURL(it.link || it.source)}
                          </div>

                          {Array.isArray(it.categories) &&
                            it.categories.length > 0 && (
                              <div
                                className="opacity-60 truncate mt-0.5"
                                title={it.categories.join(", ")}
                              >
                                {it.categories.join(", ")}
                              </div>
                            )}
                        </div>

{it.published && (
  <time
    className="opacity-60 whitespace-nowrap"
    dateTime={it.published}
    title={formatInTZ(it.published, {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      timeZoneName: "short",
      timeZone: TARGET_TZ,              // ← override display TZ here
    })}
  >
    {timeAgo(it.published)}
  </time>
)}
                      </div>

                      {/* Show external link only when selected */}
                      <div className={`mt-2 ${isSelected ? "" : "hidden"}`}>
                        <a
                          className="text-xs opacity-70 hover:opacity-100 underline"
                          href={it.link}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open article ↗
                        </a>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
      <DetailsSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        item={selected}
      />
    </main>
  );
}

function ArticlePanel({
  item,
  onClose,
}: {
  item: FeedItem;
  onClose: () => void;
}) {
  const hasGoodImg = !isBadImage(item.image);
  const showImg = !isBadImage(item.image) ? (item.image as string) : null;

  return (
    <div className="p-4">
      <div className="flex items-start gap-2">
        <h2
          id="article-title"
          className="text-base font-semibold leading-snug flex-1"
        >
          {item.title}
        </h2>
        <button
          onClick={onClose}
          className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20"
          aria-label="Close preview"
        >
          Close ✕
        </button>
      </div>

      <div className="mt-4 text-xs opacity-60">{domainFromURL(item.link)}</div>

      <div className="mt-3 aspect-[16/9] overflow-hidden rounded bg-gray-100 dark:bg-white/10">
        {showImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={showImg} alt="" className="w-full h-full object-cover" />
        ) : null}
      </div>

// DetailsPanel — replace the published block
{item.published && (() => {
  const abs = formatInTZ(item.published, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZoneName: "short",
    timeZone: TARGET_TZ,
  });
  return (
    <div className="mt-2 text-xs opacity-60" title={abs}>
      {abs} · {timeAgo(item.published)}
    </div>
  );
})()}
    </div>
  );
}
