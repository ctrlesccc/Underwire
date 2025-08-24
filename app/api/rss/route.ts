// app/api/rss/route.ts
import { NextResponse } from "next/server";

export const runtime = "edge";
export const preferredRegion = "auto";

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 2_500_000; // ~2.5 MB cap to avoid giant feeds

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const urlParam = searchParams.get("u");
  if (!urlParam) {
    return NextResponse.json({ error: "Missing ?u=" }, { status: 400, headers: corsHeaders() });
  }

  // Basic URL validation + SSRF-ish guard
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(feedUrl.toString(), {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; MarcoNewsReader/1.1; +https://example.local)",
        "accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8",
        "accept-language": "en-US,en;q=0.8,nl;q=0.7",
        "referer": feedUrl.origin + "/",
      },
      cache: "no-store",       // keep your current behavior
      redirect: "follow",
      signal: controller.signal,
    });

    const ct = upstream.headers.get("content-type") || "";
    const cl = Number(upstream.headers.get("content-length") || "0");
    if (cl && cl > MAX_BYTES) {
      return NextResponse.json({ error: "Feed too large" }, { status: 413, headers: corsHeaders() });
    }

    // Read as a stream with a size cap
    let body = "";
    if (upstream.body) {
      const reader = upstream.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          received += value.byteLength;
          if (received > MAX_BYTES) {
            try { reader.cancel(); } catch {}
            return NextResponse.json({ error: "Feed too large" }, { status: 413, headers: corsHeaders() });
          }
          chunks.push(value);
        }
      }
      body = new TextDecoder("utf-8").decode(concatUint8(chunks));
    } else {
      // Fallback (should rarely happen on edge)
      body = await upstream.text();
    }

    const looksXml =
      /xml|rss|atom/i.test(ct) ||
      /^\s*<\?xml/i.test(body) ||
      /^\s*<rss\b/i.test(body) ||
      /^\s*<feed\b/i.test(body);

    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "content-type": looksXml ? (ct || "application/xml; charset=utf-8") : "application/xml; charset=utf-8",
        "cache-control": "no-store",
        "x-upstream-status": String(upstream.status),
        ...corsHeaders(),
      },
    });
  } catch (err: any) {
    const aborted = err?.name === "AbortError";
    return NextResponse.json(
      { error: aborted ? "Upstream timeout" : (err?.message || "Fetch failed") },
      { status: aborted ? 504 : 502, headers: corsHeaders() }
    );
  } finally {
    clearTimeout(timeout);
  }
}

// ---- helpers ----
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower === "127.0.0.1" || lower === "::1" || lower.endsWith(".local")) return true;
  // crude private IPv4 checks (doesn't resolve DNS → still better than nothing)
  const m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = m.slice(1).map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
  }
  return false;
}

function concatUint8(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
