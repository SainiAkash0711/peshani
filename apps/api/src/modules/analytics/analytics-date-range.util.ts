import { BadRequestException } from '@nestjs/common';

export type DateRangePreset = 'today' | 'yesterday' | 'last7days' | 'last30days' | 'last90days' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'custom';

const VALID_PRESETS: DateRangePreset[] = ['today', 'yesterday', 'last7days', 'last30days', 'last90days', 'thisMonth', 'lastMonth', 'thisYear', 'custom'];

export interface ResolvedDateRange {
  from: Date;
  to: Date;
  timezone: string;
  preset: DateRangePreset;
}

/**
 * §4 - server-side date filtering, one consistent, documented strategy:
 * every boundary is computed as the requested IANA `timezone`'s own WALL
 * CLOCK midnight, converted to the real UTC instant it corresponds to -
 * never the server process's local time, never a client-precomputed
 * boundary (the API only ever accepts a preset name or an explicit
 * from/to pair, both resolved here). `timezone` resolution order: the
 * request's own `timezone` query param if supplied, else the store's own
 * configured `timezone` StoreSetting, else `UTC` - documented explicitly
 * so a report is never silently ambiguous about which clock it used.
 *
 * "Today"/"yesterday"/month/year boundaries are computed relative to the
 * current instant AS OBSERVED IN THAT TIMEZONE, not the server's own
 * timezone - e.g. "Today" for an Asia/Kolkata store starts at 00:00 IST,
 * which is 18:30 UTC the previous day, not midnight UTC.
 */
export function resolveDateRange(query: { preset?: string; from?: string; to?: string; timezone?: string }, storeTimezone: string): ResolvedDateRange {
  const timezone = query.timezone?.trim() || storeTimezone || 'UTC';
  assertValidTimezone(timezone);

  const preset = (query.preset as DateRangePreset) ?? (query.from || query.to ? 'custom' : 'last30days');
  if (!VALID_PRESETS.includes(preset)) {
    throw new BadRequestException(`Invalid date range preset "${query.preset}"`);
  }

  if (preset === 'custom') {
    if (!query.from || !query.to) {
      throw new BadRequestException('A custom date range requires both "from" and "to"');
    }
    const from = parseCalendarDateInTimezone(query.from, timezone, 'start');
    const to = parseCalendarDateInTimezone(query.to, timezone, 'end');
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('"from" must not be after "to"');
    }
    return { from, to, timezone, preset };
  }

  const now = new Date();
  const { year, month, day } = getZonedYmd(now, timezone);

  switch (preset) {
    case 'today':
      return { from: zonedYmdToUtc(year, month, day, 0, 0, 0, timezone), to: zonedYmdToUtc(year, month, day, 23, 59, 59.999, timezone), timezone, preset };
    case 'yesterday': {
      const y = addDays(year, month, day, -1);
      return { from: zonedYmdToUtc(y.year, y.month, y.day, 0, 0, 0, timezone), to: zonedYmdToUtc(y.year, y.month, y.day, 23, 59, 59.999, timezone), timezone, preset };
    }
    case 'last7days': {
      const start = addDays(year, month, day, -6);
      return { from: zonedYmdToUtc(start.year, start.month, start.day, 0, 0, 0, timezone), to: zonedYmdToUtc(year, month, day, 23, 59, 59.999, timezone), timezone, preset };
    }
    case 'last30days': {
      const start = addDays(year, month, day, -29);
      return { from: zonedYmdToUtc(start.year, start.month, start.day, 0, 0, 0, timezone), to: zonedYmdToUtc(year, month, day, 23, 59, 59.999, timezone), timezone, preset };
    }
    case 'last90days': {
      const start = addDays(year, month, day, -89);
      return { from: zonedYmdToUtc(start.year, start.month, start.day, 0, 0, 0, timezone), to: zonedYmdToUtc(year, month, day, 23, 59, 59.999, timezone), timezone, preset };
    }
    case 'thisMonth':
      return { from: zonedYmdToUtc(year, month, 1, 0, 0, 0, timezone), to: zonedYmdToUtc(year, month, day, 23, 59, 59.999, timezone), timezone, preset };
    case 'lastMonth': {
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
      return { from: zonedYmdToUtc(prevYear, prevMonth, 1, 0, 0, 0, timezone), to: zonedYmdToUtc(prevYear, prevMonth, lastDay, 23, 59, 59.999, timezone), timezone, preset };
    }
    case 'thisYear':
      return { from: zonedYmdToUtc(year, 1, 1, 0, 0, 0, timezone), to: zonedYmdToUtc(year, month, day, 23, 59, 59.999, timezone), timezone, preset };
    default:
      throw new BadRequestException(`Invalid date range preset "${query.preset}"`);
  }
}

function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new BadRequestException(`Invalid timezone "${timezone}"`);
  }
}

function parseCalendarDateInTimezone(value: string, timezone: string, edge: 'start' | 'end'): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    throw new BadRequestException(`Invalid date "${value}" - expected YYYY-MM-DD`);
  }
  const [, y, m, d] = match;
  return edge === 'start' ? zonedYmdToUtc(+y, +m, +d, 0, 0, 0, timezone) : zonedYmdToUtc(+y, +m, +d, 23, 59, 59.999, timezone);
}

/** The current wall-clock Y/M/D as observed in `timezone`, for a given real UTC instant. */
function getZonedYmd(instant: Date, timezone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

function addDays(year: number, month: number, day: number, delta: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + delta);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * Converts a wall-clock date/time AS OBSERVED IN `timezone` to the real UTC
 * instant it represents - the standard two-pass technique (accurate for
 * every real-world IANA timezone, fixed-offset or DST-observing): first
 * treat the wall-clock value as if it were already UTC to get a rough
 * instant, measure that instant's actual offset in the target timezone,
 * then correct by that offset. One correction pass is sufficient because
 * no timezone's DST transition is large enough to require a second.
 */
function zonedYmdToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number, timezone: string): Date {
  const wholeSecond = Math.floor(second);
  const ms = Math.round((second - wholeSecond) * 1000);
  const guess = Date.UTC(year, month - 1, day, hour, minute, wholeSecond, ms);
  const offsetMs = getOffsetMs(new Date(guess), timezone);
  return new Date(guess - offsetMs);
}

/** How far `timezone`'s wall clock is ahead of UTC, in milliseconds, at the given real instant. */
function getOffsetMs(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  const asUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second));
  return asUtc - instant.getTime();
}
