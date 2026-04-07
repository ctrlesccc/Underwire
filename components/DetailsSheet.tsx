"use client";

import { useEffect, useRef } from "react";
import { formatAbsoluteTimestamp, timeAgo } from "../lib/date-format";
import type { FeedItem } from "../lib/feed";

export default function DetailsSheet({
  open,
  onClose,
  item,
}: {
  open: boolean;
  onClose: () => void;
  item: FeedItem | null;
}) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Lock background scroll + ESC to close + focus the close button
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => closeBtnRef.current?.focus(), 0);

    return () => {
      clearTimeout(t);
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div
      aria-hidden={!open}
      className={`fixed inset-0 z-50 ${open ? "pointer-events-auto" : "pointer-events-none"}`}
    >
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/70 transition-opacity duration-300 motion-reduce:transition-none ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Article details"
        className={`surface-panel-strong absolute right-0 top-0 h-full w-[min(100vw,42rem)] md:w-[min(100vw,50rem)] lg:w-[min(100vw,58rem)] rounded-l-[2rem]
                    transition-transform duration-300 ease-out motion-reduce:transition-none
                    ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0">
            <div className="font-mono muted-text text-[11px] uppercase tracking-[0.22em]">
              Article preview
            </div>
            <div className="mt-1 truncate text-sm muted-text">{item?.source}</div>
          </div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            className="theme-button px-4 py-2 text-sm transition focus:outline-none"
          >
            Close
          </button>
        </div>

        <div className="h-[calc(100%-5rem)] overflow-y-auto px-5 py-6">
          {item ? (
            <article className="mx-auto w-full max-w-3xl space-y-5">
              <div className="space-y-3">
                <div className="theme-status font-mono inline-flex rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.2em]">
                  {item.source}
                </div>
                <h2 className="font-display text-2xl leading-tight md:text-[2.5rem]">{item.title}</h2>
              </div>

              {item.published && (
                <time
                  className="font-mono block text-xs muted-text"
                  dateTime={item.published}
                  title={formatAbsoluteTimestamp(item.published)}
                >
                  {formatAbsoluteTimestamp(item.published)} · {timeAgo(item.published)}
                </time>
              )}

              {item.image && (
                <div className="overflow-hidden rounded-[1.75rem] border border-[var(--border)] bg-[var(--background-alt)]">
                  <div className="aspect-[16/9]">
                    <img src={item.image} alt="" className="h-full w-full object-cover" />
                  </div>
                </div>
              )}

              {item.description && (
                <div
                  className="prose prose-sm max-w-none text-[15px] leading-7 dark:prose-invert md:text-base"
                  dangerouslySetInnerHTML={{ __html: item.description }}
                />
              )}

              {item.link && (
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="theme-button inline-flex items-center gap-2 px-4 py-2.5 text-sm transition"
                >
                  Open original ↗
                </a>
              )}
            </article>
          ) : (
            <div className="p-6 text-sm muted-text">No article selected.</div>
          )}
        </div>
      </aside>
    </div>
  );
}
