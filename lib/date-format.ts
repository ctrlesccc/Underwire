const DEFAULT_LOCALE = "nl-NL" as const;
export const TARGET_TZ = "Europe/Amsterdam" as const;

export function formatInTZ(iso?: string, opts?: Intl.DateTimeFormatOptions) {
  if (!iso) return "";

  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";

  const finalOpts: Intl.DateTimeFormatOptions = {
    hour12: false,
    timeZone: opts?.timeZone || TARGET_TZ,
  };

  const hasSpecific =
    !!opts &&
    (opts.year !== undefined ||
      opts.month !== undefined ||
      opts.day !== undefined ||
      opts.hour !== undefined ||
      opts.minute !== undefined ||
      opts.second !== undefined ||
      opts.timeZoneName !== undefined ||
      opts.timeZone !== undefined);

  if (hasSpecific) {
    Object.assign(finalOpts, opts);
    if (finalOpts.timeZoneName && (finalOpts.dateStyle || finalOpts.timeStyle)) {
      delete finalOpts.dateStyle;
      delete finalOpts.timeStyle;
    }
  } else {
    finalOpts.dateStyle = "short";
    finalOpts.timeStyle = "medium";
  }

  return date.toLocaleString(DEFAULT_LOCALE, finalOpts);
}

export function formatAbsoluteTimestamp(iso?: string) {
  return formatInTZ(iso, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: TARGET_TZ,
    timeZoneName: "short",
  });
}

export function timeAgo(iso?: string) {
  if (!iso) return "";

  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return "";

  let diff = Date.now() - time;
  const future = diff < 0;
  diff = Math.abs(diff);

  const mins = Math.floor(diff / 60_000);
  const hrs = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (mins < 1) return future ? "in <1m" : "just now";
  if (mins < 60) return future ? `in ${mins}m` : `${mins}m ago`;
  if (hrs < 24) return future ? `in ${hrs}h` : `${hrs}h ago`;
  return future ? `in ${days}d` : `${days}d ago`;
}
