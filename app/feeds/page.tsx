"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatAbsoluteTimestamp } from "../../lib/date-format";
import type { FeedsConfig } from "../../lib/feed";
import {
  getEnabledFeeds,
  getFeedErrorLog,
  setEnabledFeeds,
} from "../../lib/feed-preferences";

function domainFromURL(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function FeedsPage() {
  const [config, setConfig] = useState<FeedsConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [enabledFeeds, setEnabledFeedsState] = useState<string[] | null>(null);
  const [errorLogVersion, setErrorLogVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setConfigError(null);
        const response = await fetch("/feeds.json", { cache: "no-store" });
        if (!response.ok) throw new Error(`Failed to load feeds.json (${response.status})`);
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
  }, []);

  useEffect(() => {
    const sync = () => {
      setEnabledFeedsState(getEnabledFeeds());
      setErrorLogVersion((value) => value + 1);
    };

    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  const allFeeds = useMemo(() => {
    if (!config) return [];
    return Array.from(
      new Set(
        config.categories
          .filter((category) => category.enabled !== false)
          .flatMap((category) => config.feeds[category.key] ?? [])
      )
    );
  }, [config]);

  const enabledSet = useMemo(() => {
    const defaults = allFeeds;
    const active = enabledFeeds ?? defaults;
    return new Set(active);
  }, [allFeeds, enabledFeeds]);

  const errorLog = useMemo(() => getFeedErrorLog(), [errorLogVersion]);

  function persist(next: string[]) {
    setEnabledFeeds(next);
    setEnabledFeedsState(next);
  }

  function toggleFeed(url: string) {
    const next = new Set(enabledSet);
    if (next.has(url)) {
      next.delete(url);
    } else {
      next.add(url);
    }
    persist(Array.from(next));
  }

  function setCategoryEnabled(urls: string[], enabled: boolean) {
    const next = new Set(enabledSet);
    urls.forEach((url) => {
      if (enabled) next.add(url);
      else next.delete(url);
    });
    persist(Array.from(next));
  }

  function totalErrorCount(url: string) {
    const entry = errorLog[url];
    if (!entry) return 0;
    return (entry.counts[404] || 0) + (entry.counts[502] || 0);
  }

  function formatLastSeen(timestamp: number) {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return "unknown";
    return formatAbsoluteTimestamp(new Date(timestamp).toISOString()) || "unknown";
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-5 pb-24">
      <section className="surface-panel-strong overflow-hidden rounded-[2rem] px-5 py-6 md:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="theme-status font-mono inline-flex rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.24em]">
              Source control
            </div>
            <h1 className="font-display mt-4 text-4xl leading-tight md:text-5xl">
              Shape the feed mix, keep the noise out.
            </h1>
            <p className="muted-text mt-3 max-w-2xl text-sm leading-6 md:text-base">
              Enable only the sources you want to see in the reader. Feeds with recent fetch
              failures are highlighted so cleanup is quick and obvious.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:w-[26rem]">
            <div className="surface-panel p-4">
              <div className="font-mono muted-text text-[11px] uppercase tracking-[0.22em]">Enabled</div>
              <div className="font-display mt-2 text-3xl">{enabledSet.size}</div>
            </div>
            <div className="surface-panel p-4">
              <div className="font-mono muted-text text-[11px] uppercase tracking-[0.22em]">Available</div>
              <div className="font-display mt-2 text-3xl">{allFeeds.length}</div>
            </div>
            <div className="surface-panel p-4">
              <div className="font-mono muted-text text-[11px] uppercase tracking-[0.22em]">Problem feeds</div>
              <div className="font-display mt-2 text-3xl">
                {Object.values(errorLog).filter((entry) => (entry.counts[404] || 0) + (entry.counts[502] || 0) > 0).length}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--border)] pt-5">
          <button
            type="button"
            onClick={() => persist(allFeeds)}
            className="theme-button px-4 py-2.5 text-sm transition"
          >
            Enable all
          </button>
          <button
            type="button"
            onClick={() => persist([])}
            className="theme-button px-4 py-2.5 text-sm transition"
          >
            Disable all
          </button>
          <Link
            href="/"
            className="theme-button px-4 py-2.5 text-sm transition"
          >
            Back to reader
          </Link>
        </div>
      </section>

      <div className="font-mono muted-text mt-5 text-xs uppercase tracking-[0.24em]">
        Enabled {enabledSet.size} of {allFeeds.length} feeds
      </div>

      {!config && !configError && <p className="mt-6 text-sm muted-text">Loading feeds…</p>}
      {configError && (
        <p className="surface-panel mt-6 rounded-[1.5rem] px-5 py-4 text-sm">{configError}</p>
      )}

      <div className="mt-6 space-y-6">
        {config?.categories
          .filter((category) => category.enabled !== false)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((category) => {
            const feeds = Array.from(new Set(config.feeds[category.key] ?? []));
            const enabledCount = feeds.filter((url) => enabledSet.has(url)).length;

            return (
              <section
                key={category.key}
                className="surface-panel rounded-[1.75rem] p-5 md:p-6"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-mono muted-text text-[11px] uppercase tracking-[0.22em]">
                      Category
                    </div>
                    <h2 className="font-display mt-1 text-2xl">{category.label || category.key}</h2>
                    <p className="muted-text mt-1 text-sm">
                      {enabledCount} of {feeds.length} enabled
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setCategoryEnabled(feeds, true)}
                      className="theme-button px-4 py-2.5 text-sm transition"
                    >
                      Enable category
                    </button>
                    <button
                      type="button"
                      onClick={() => setCategoryEnabled(feeds, false)}
                      className="theme-button px-4 py-2.5 text-sm transition"
                    >
                      Disable category
                    </button>
                  </div>
                </div>

                <ul className="mt-4 space-y-2">
                  {feeds.map((url) => {
                    const entry = errorLog[url];
                    const errors = totalErrorCount(url);
                    const hasErrors = errors > 0;

                    return (
                      <li
                        key={url}
                        className={`surface-panel rounded-[1.35rem] p-4 transition ${
                          hasErrors ? "ring-1 ring-[var(--foreground)]" : ""
                        }`}
                      >
                        <label className="flex gap-3">
                          <input
                            type="checkbox"
                            checked={enabledSet.has(url)}
                            onChange={() => toggleFeed(url)}
                            className="mt-1"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-display text-xl break-all">{domainFromURL(url)}</span>
                              {hasErrors && (
                                <span className="theme-button-active rounded-full px-2.5 py-1 text-[11px]">
                                  Error
                                </span>
                              )}
                              {enabledSet.has(url) && !hasErrors && (
                                <span className="theme-status rounded-full px-2.5 py-1 text-[11px]">
                                  Enabled
                                </span>
                              )}
                            </div>
                            <div className="font-mono muted-text mt-1 text-[12px] break-all">{url}</div>
                            {hasErrors && entry && (
                              <div className="mt-3 text-xs muted-text">
                                404: {entry.counts[404] || 0} · 502: {entry.counts[502] || 0} · last seen{" "}
                                {formatLastSeen(entry.last)}
                              </div>
                            )}
                          </div>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
      </div>
    </main>
  );
}
