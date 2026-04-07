import { NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";
import type { FeedItem } from "../../../lib/feed";
import { getFeedCache, pruneFeedCache, updateFeedCacheError, upsertFeedCache } from "../../../lib/feed-cache-db";

export const runtime = "nodejs";

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 2_500_000;
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_ITEM_LIMIT = 20;
const MAX_ITEM_LIMIT = 50;
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
  parseTagValue: false,
});

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const urlParam = searchParams.get("u");
  const forceLocalTZ = searchParams.get("tz") || undefined;
  const limit = clampLimit(searchParams.get("limit"));
  const bust = Number(searchParams.get("b") || "0") > 0;

  if (!urlParam) {
    return NextResponse.json({ error: "Missing ?u=" }, { status: 400, headers: corsHeaders() });
  }

  let feedUrl: URL;
  try {
    feedUrl = new URL(urlParam);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400, headers: corsHeaders() });
  }

  if (!/^https?:$/.test(feedUrl.protocol)) {
    return NextResponse.json({ error: "Only http(s) URLs allowed" }, { status: 400, headers: corsHeaders() });
  }

  if (isPrivateHostname(feedUrl.hostname)) {
    return NextResponse.json({ error: "URL not allowed" }, { status: 400, headers: corsHeaders() });
  }

  const cacheKey = `${feedUrl.toString()}|${forceLocalTZ || ""}|${limit}`;
  const cached = getFeedCache(cacheKey);
  if (!bust && cached && Date.now() - cached.fetched_at < CACHE_TTL_MS) {
    return NextResponse.json(cached.items, {
      headers: {
        "cache-control": "no-store",
        "x-cache": "SQLITE-HIT",
        ...corsHeaders(),
      },
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(feedUrl.toString(), {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; Underwire/1.0; +https://example.local)",
        accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8",
        "accept-language": "en-US,en;q=0.8,nl;q=0.7",
        referer: feedUrl.origin + "/",
      },
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });

    if (!upstream.ok) {
      if (cached?.items?.length) {
        updateFeedCacheError(cacheKey, upstream.status, `Upstream returned ${upstream.status}`);
        return NextResponse.json(cached.items, {
          headers: {
            "cache-control": "no-store",
            "x-cache": "STALE",
            "x-upstream-status": String(upstream.status),
            ...corsHeaders(),
          },
        });
      }

      return NextResponse.json(
        { error: `Upstream returned ${upstream.status}` },
        { status: upstream.status, headers: corsHeaders() }
      );
    }

    const contentType = upstream.headers.get("content-type") || "";
    const contentLength = Number(upstream.headers.get("content-length") || "0");
    if (contentLength && contentLength > MAX_BYTES) {
      return NextResponse.json({ error: "Feed too large" }, { status: 413, headers: corsHeaders() });
    }

    let body = "";
    if (upstream.body) {
      const reader = upstream.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        received += value.byteLength;
        if (received > MAX_BYTES) {
          try {
            reader.cancel();
          } catch {}
          return NextResponse.json({ error: "Feed too large" }, { status: 413, headers: corsHeaders() });
        }

        chunks.push(value);
      }

      body = new TextDecoder("utf-8").decode(concatUint8(chunks));
    } else {
      body = await upstream.text();
    }

    const looksXml =
      /xml|rss|atom/i.test(contentType) ||
      /^\s*<\?xml/i.test(body) ||
      /^\s*<rss\b/i.test(body) ||
      /^\s*<feed\b/i.test(body);

    if (!looksXml) {
      return NextResponse.json(
        { error: "Upstream did not return XML" },
        { status: 502, headers: corsHeaders() }
      );
    }

    const items = parseRSS(body, feedUrl.toString(), {
      forceLocalTZ,
      limit,
    });

    upsertFeedCache({
      cacheKey,
      feedUrl: feedUrl.toString(),
      tzOverride: forceLocalTZ,
      itemLimit: limit,
      items,
      fetchedAt: Date.now(),
      lastStatus: 200,
      lastError: null,
    });
    pruneFeedCache(CACHE_RETENTION_MS);

    return NextResponse.json(items, {
      headers: {
        "cache-control": "no-store",
        "x-cache": cached ? "SQLITE-REFRESH" : "SQLITE-MISS",
        ...corsHeaders(),
      },
    });
  } catch (err: unknown) {
    const aborted = typeof err === "object" && err !== null && "name" in err && err.name === "AbortError";
    const message =
      typeof err === "object" && err !== null && "message" in err
        ? String(err.message)
        : "Fetch failed";

    if (cached?.items?.length) {
      updateFeedCacheError(cacheKey, aborted ? 504 : 502, message);
      return NextResponse.json(cached.items, {
        headers: {
          "cache-control": "no-store",
          "x-cache": "STALE",
          "x-upstream-error": message,
          ...corsHeaders(),
        },
      });
    }

    return NextResponse.json(
      { error: aborted ? "Upstream timeout" : message },
      { status: aborted ? 504 : 502, headers: corsHeaders() }
    );
  } finally {
    clearTimeout(timeout);
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower === "127.0.0.1" || lower === "::1" || lower.endsWith(".local")) {
    return true;
  }

  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;

  const [a, b] = match.slice(1).map(Number);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  return false;
}

function concatUint8(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return out;
}

function clampLimit(raw: string | null) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_ITEM_LIMIT;
  return Math.max(1, Math.min(MAX_ITEM_LIMIT, Math.floor(parsed)));
}

function domainFromURL(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function normalizeLink(url: string) {
  try {
    const parsed = new URL(url);
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
    drop.forEach((param) => parsed.searchParams.delete(param));
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function extractFirstImgFromHtml(html?: string): string | null {
  if (!html) return null;
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function tzOffsetMinutesAt(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  const asUTC = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second || "0")
  );

  return Math.round((asUTC - date.getTime()) / 60000);
}

function coerceIsoAssumingLocalZone(iso: string, timeZone: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;

  const offsetMinutes = tzOffsetMinutesAt(date, timeZone);
  return new Date(date.getTime() - offsetMinutes * 60_000).toISOString();
}

function parseRssDateToISO(input?: string) {
  if (!input) return undefined;
  let value = input.trim();
  value = value.replace(/\s*\([^)]+\)\s*$/, "");

  if (/\s(?:UT|UTC|GMT)$/i.test(value)) {
    value = value.replace(/\s(?:UT|UTC|GMT)$/i, " +0000");
  }

  const militaryZone = value.match(/\s([A-IK-Z])$/i);
  if (militaryZone) {
    const zone = militaryZone[1].toUpperCase();
    const offsets: Record<string, string> = {
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
    if (offsets[zone]) value = value.replace(/\s([A-IK-Z])$/i, ` ${offsets[zone]}`);
  }

  value = value.replace(/\s([A-Z]{2,4})$/, (_match, abbr: string) => {
    const offsets: Record<string, string> = {
      CET: "+0100",
      CEST: "+0200",
      EET: "+0200",
      EEST: "+0300",
      GMT: "+0000",
      WET: "+0000",
      WEST: "+0100",
      IST: "+0530",
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
    };
    const key = abbr.toUpperCase();
    return offsets[key] ? ` ${offsets[key]}` : ` ${abbr}`;
  });

  let date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString();

  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    date = new Date(value.replace(" ", "T") + "Z");
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  const repairedYear = value.replace(
    /(^|,\s)(\d{1,2}\s+[A-Za-z]{3}\s+)(\d{2})(\s+\d{2}:\d{2}(?::\d{2})?(\s|$))/,
    (_match, prefix, beforeYear, year, suffix) => {
      const parsedYear = parseInt(year, 10);
      const fullYear = parsedYear >= 50 ? 1900 + parsedYear : 2000 + parsedYear;
      return `${prefix}${beforeYear}${fullYear}${suffix}`;
    }
  );

  if (repairedYear !== value) {
    date = new Date(repairedYear);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  return undefined;
}

function parseRSS(
  xml: string,
  feedUrl: string,
  options: { forceLocalTZ?: string; limit: number }
): FeedItem[] {
  const parsed = xmlParser.parse(xml);
  const channelItems = toArray(parsed?.rss?.channel?.item);
  const atomEntries = toArray(parsed?.feed?.entry);
  const entries = (channelItems.length ? channelItems : atomEntries).slice(0, options.limit);

  return entries.map((entryRaw, index) => {
    const entry =
      entryRaw && typeof entryRaw === "object"
        ? (entryRaw as Record<string, unknown>)
        : ({} as Record<string, unknown>);

    const title = textValue(entry?.title) || "(untitled)";
    const link = normalizeLink(resolveLink(entry) || "");

    const publishedRaw =
      textValue(entry?.published) ||
      textValue(entry?.updated) ||
      textValue(entry?.pubDate) ||
      textValue(entry?.["dc:date"]) ||
      textValue(entry?.["dcterms:created"]) ||
      textValue(entry?.["dcterms:modified"]);

    let published = parseRssDateToISO(publishedRaw);
    if (options.forceLocalTZ && published) {
      published = coerceIsoAssumingLocalZone(published, options.forceLocalTZ);
    }

    const description =
      textValue(entry?.["content:encoded"]) ||
      textValue(entry?.content) ||
      textValue(entry?.description) ||
      textValue(entry?.summary) ||
      "";

    const mediaContent = firstArrayValue(entry?.["media:content"]) || entry?.["media:content"];
    const mediaThumbnail = firstArrayValue(entry?.["media:thumbnail"]) || entry?.["media:thumbnail"];
    const enclosure = firstImageEnclosure(entry?.enclosure) || entry?.enclosure;
    const itunesImage = firstArrayValue(entry?.["itunes:image"]) || entry?.["itunes:image"];
    const image =
      objectProp(mediaContent, "url") ||
      objectProp(mediaThumbnail, "url") ||
      objectProp(enclosure, "url") ||
      objectProp(itunesImage, "href") ||
      extractFirstImgFromHtml(description);

    const categories = extractCategories(entry);
    const id =
      textValue(entry?.id) ||
      textValue(entry?.guid) ||
      link ||
      `${feedUrl}#${index}`;

    return {
      id,
      title,
      link,
      published,
      image: image || null,
      source: domainFromURL(feedUrl),
      description: description || undefined,
      categories: categories.length ? categories : undefined,
    };
  });
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ["#text", "__cdata", "__text", "text"]) {
    const nested = record[key];
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }

  return undefined;
}

function resolveLink(entry: Record<string, unknown>): string {
  const links = toArray(entry?.link as unknown);
  for (const link of links) {
    if (typeof link === "string" && link.trim()) return link.trim();
    if (link && typeof link === "object") {
      const rel = objectProp(link, "rel");
      const href = objectProp(link, "href");
      if (!rel || rel === "alternate") return href;
    }
  }
  return "";
}

function firstArrayValue(value: unknown) {
  const items = toArray(value as Record<string, unknown> | undefined);
  return items[0];
}

function objectProp(value: unknown, key: string): string {
  if (!value || typeof value !== "object") return "";
  const prop = (value as Record<string, unknown>)[key];
  return typeof prop === "string" ? prop : "";
}

function firstImageEnclosure(value: unknown) {
  const items = toArray(value as Record<string, unknown> | undefined);
  return items.find((item) => {
    const type = objectProp(item, "type");
    return type.startsWith("image/");
  });
}

function extractCategories(entry: Record<string, unknown>) {
  const categories = [
    ...toArray(entry?.category as unknown),
    ...toArray(entry?.["dc:subject"] as unknown),
  ];

  return categories
    .map((category) => {
      if (typeof category === "string") return category.trim();
      if (!category || typeof category !== "object") return "";
      const record = category as Record<string, unknown>;
      if (typeof record.term === "string") return record.term.trim();
      return textValue(record) || "";
    })
    .filter(Boolean);
}
