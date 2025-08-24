"use client";

import { useEffect, useRef } from "react";

type FeedItem = {
  id: string;
  title: string;
  link: string;
  image?: string | null;
  source?: string | null;
  published?: string | undefined; // ISO string
  description?: string | undefined; // HTML
  categories?: string[];
};

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
      {/* Dim background */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/50 transition-opacity duration-300 motion-reduce:transition-none ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Slide-in panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Article details"
        className={`absolute right-0 top-0 h-full w-[min(100vw,40rem)] md:w-[min(100vw,48rem)] lg:w-[min(100vw,56rem)]
                    bg-white dark:bg-[#0b0b0e] shadow-2xl
                    transition-transform duration-300 ease-out motion-reduce:transition-none
                    ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 p-3 border-b border-black/5 dark:border-white/10">
          <div className="min-w-0 text-sm opacity-70 truncate">{item?.source}</div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            className="rounded-lg px-2.5 py-1 text-sm hover:bg-black/5 dark:hover:bg-white/10 focus:outline-none focus:ring ring-black/10 dark:ring-white/20"
          >
            Close
          </button>
        </div>

        {/* Body */}
        <div className="h-[calc(100%-3rem)] overflow-y-auto">
          {item ? (
            <article className="p-2 sm:w-4/5 md:w-4/5 w-full mx-auto space-y-3">
              <h2 className="text-lg font-semibold leading-tight">{item.title}</h2>

              {item.published && (
                <time className="block text-xs opacity-70" dateTime={item.published}>
                  {new Date(item.published).toLocaleString()}
                </time>
              )}

 {item.image && (
   <div className="mt-2 mx-auto w-full sm:w-3/4 md:w-3/4">
     <div className="aspect-[16/9] overflow-hidden rounded-xl bg-gray-100 dark:bg-white/10 shadow-sm">
       <img src={item.image} alt="" className="h-full w-full object-cover" />
     </div>
   </div>
 )}

              {item.description && (
                <div
                  className="prose prose-sm dark:prose-invert max-w-none"
                  // ensure you've sanitized/cleaned HTML upstream if needed
                  dangerouslySetInnerHTML={{ __html: item.description }}
                />
              )}

              {item.link && (
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm underline"
                >
                  Open original ↗
                </a>
              )}
            </article>
          ) : (
            <div className="p-6 text-sm opacity-70">No article selected.</div>
          )}
        </div>
      </aside>
    </div>
  );
}
