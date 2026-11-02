import type { AppLocale } from "../../i18n";

interface MessageTimestampFormatters {
  readonly date: Intl.DateTimeFormat;
  readonly time: Intl.DateTimeFormat;
}

const formatterCache = new Map<string, MessageTimestampFormatters>();

/** Formats a user message's sent time using the app locale while retaining the date. */
export function conversationMessageTimestamp_format(
  createdAt: string,
  locale: AppLocale,
  timeZone?: string,
): string | undefined {
  const instant = new Date(createdAt);
  if (!Number.isFinite(instant.getTime())) return undefined;
  const formatters = conversationMessageTimestamp_formatters(locale, timeZone);
  return `${formatters.date.format(instant)} · ${formatters.time.format(instant)}`;
}

function conversationMessageTimestamp_formatters(
  locale: AppLocale,
  timeZone: string | undefined,
): MessageTimestampFormatters {
  const key = `${locale}\u0000${timeZone ?? ""}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const formatters = {
    date: new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      ...(timeZone ? { timeZone } : {}),
    }),
    time: new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    }),
  };
  formatterCache.set(key, formatters);
  return formatters;
}
