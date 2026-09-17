export const TRACKED_NEWS = ['NFP', 'CPI', 'PPI', 'FOMC'];
export const NEWS_CURRENCY = 'USD';
export const NEWS_IMPACT = 'HIGH';
export const UPCOMING_LOOKBACK_MS = 2 * 60 * 60 * 1000;
export const UPCOMING_HORIZON_MS = 90 * 24 * 60 * 60 * 1000;
export const LIVE_CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
export const NEWS_SYNC_TTL_MS = 60 * 1000;

/** Official 2026 US release dates (Eastern Time). NFP/CPI/PPI 8:30 ET, FOMC 2:00 ET. */
export const BAKED_US_NEWS_2026 = [
  { name: 'NFP', date: '2026-09-04', time: '08:30' },
  { name: 'PPI', date: '2026-09-10', time: '08:30' },
  { name: 'CPI', date: '2026-09-11', time: '08:30' },
  { name: 'FOMC', date: '2026-09-16', time: '14:00' },
  { name: 'NFP', date: '2026-10-02', time: '08:30' },
  { name: 'CPI', date: '2026-10-14', time: '08:30' },
  { name: 'PPI', date: '2026-10-15', time: '08:30' },
  { name: 'FOMC', date: '2026-10-28', time: '14:00' },
  { name: 'NFP', date: '2026-11-06', time: '08:30' },
  { name: 'CPI', date: '2026-11-10', time: '08:30' },
  { name: 'PPI', date: '2026-11-13', time: '08:30' },
  { name: 'NFP', date: '2026-12-04', time: '08:30' },
  { name: 'FOMC', date: '2026-12-09', time: '14:00' },
  { name: 'CPI', date: '2026-12-10', time: '08:30' },
  { name: 'PPI', date: '2026-12-15', time: '08:30' },
];

export function normalizeNewsName(value) {
  const raw = String(value || '')
    .trim()
    .toUpperCase();
  if (TRACKED_NEWS.includes(raw)) return raw;
  return classifyUsdNewsTitle(raw, 'USD');
}

export function isTrackedNewsName(value) {
  return TRACKED_NEWS.includes(normalizeNewsName(value));
}

export function isOfficialNewsEvent(event) {
  const id = String(event?.id || '');
  const source = String(event?.source || '').toLowerCase();
  return id.startsWith('news-') || source === 'schedule' || source === 'live';
}

export function newsEventId(name, date) {
  const type = normalizeNewsName(name);
  const day = String(date || '').trim().slice(0, 10);
  if (!type || !day) return '';
  return `news-${type.toLowerCase()}-${day}`;
}

function nthWeekday(year, month, weekday, n) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstDay = first.getUTCDay();
  const offset = (weekday - firstDay + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return { year, month, day };
}

export function isEasternDaylightTime(year, month, day) {
  const start = nthWeekday(year, 3, 0, 2);
  const end = nthWeekday(year, 11, 0, 1);
  const value = year * 10000 + month * 100 + day;
  const startN = start.year * 10000 + start.month * 100 + start.day;
  const endN = end.year * 10000 + end.month * 100 + end.day;
  return value >= startN && value < endN;
}

export function easternWallToIso(date, time) {
  const day = String(date || '').trim().slice(0, 10);
  const clock = String(time || '00:00').trim() || '00:00';
  const [year, month, dayNum] = day.split('-').map((part) => Number(part));
  if (!year || !month || !dayNum) return '';
  const [hours, minutes] = clock.split(':').map((part) => Number(part));
  const hh = Number.isFinite(hours) ? hours : 0;
  const mm = Number.isFinite(minutes) ? minutes : 0;
  const offset = isEasternDaylightTime(year, month, dayNum) ? '-04:00' : '-05:00';
  const stamp = `${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00${offset}`;
  const ms = Date.parse(stamp);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

export function classifyUsdNewsTitle(title, country = 'USD') {
  const nation = String(country || 'USD')
    .trim()
    .toUpperCase();
  if (nation && !['USD', 'US', 'USA', 'UNITED STATES', 'ALL'].includes(nation)) return '';
  if (nation === 'ALL') return '';
  const t = String(title || '').toLowerCase();
  if (!t) return '';
  if (/\bspeaks\b/.test(t)) return '';
  if (/\bmember\b/.test(t)) return '';
  if (/\bminutes\b/.test(t)) return '';
  if (/non[\s-]?farm|nonfarm payroll|\bnfp\b|employment situation/.test(t)) return 'NFP';
  if (/consumer price|\bcpi\b/.test(t)) return 'CPI';
  if (/producer price|\bppi\b/.test(t)) return 'PPI';
  if (/\bfomc\b|federal funds rate/.test(t)) return 'FOMC';
  return '';
}

export function buildNewsEvent(input, nowIso = new Date().toISOString()) {
  const name = normalizeNewsName(input?.name || input?.title);
  const date = String(input?.date || '').trim().slice(0, 10);
  const time = String(input?.time || '').trim() || (name === 'FOMC' ? '14:00' : '08:30');
  const at = String(input?.at || '').trim() || easternWallToIso(date, time);
  const id = String(input?.id || '').trim() || newsEventId(name, date);
  if (!name || !date || !id || !at) return null;
  return {
    id,
    name,
    date,
    time,
    currency: NEWS_CURRENCY,
    impact: NEWS_IMPACT,
    at,
    source: input?.source || 'schedule',
    timezone: 'ET',
    updatedAt: nowIso,
    createdAt: input?.createdAt || nowIso,
  };
}

function eventKey(event) {
  return `${normalizeNewsName(event?.name)}|${String(event?.date || '').slice(0, 10)}`;
}

export function mergeNewsEvents(rows) {
  const byKey = new Map();
  for (const row of rows || []) {
    if (!row?.name || !row?.date) continue;
    const key = eventKey(row);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      continue;
    }
    const prevRank = prev.source === 'live' ? 2 : 1;
    const nextRank = row.source === 'live' ? 2 : 1;
    if (nextRank > prevRank) byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export function bakedNewsEvents(nowMs = Date.now()) {
  const start = nowMs - UPCOMING_LOOKBACK_MS;
  const end = nowMs + UPCOMING_HORIZON_MS;
  return BAKED_US_NEWS_2026.map((row) => buildNewsEvent({ ...row, source: 'schedule' }))
    .filter(Boolean)
    .filter((row) => {
      const at = Date.parse(row.at);
      return Number.isFinite(at) && at >= start && at <= end;
    });
}

export function newsFromLiveRows(rows, nowMs = Date.now()) {
  const start = nowMs - UPCOMING_LOOKBACK_MS;
  const end = nowMs + UPCOMING_HORIZON_MS;
  const mapped = [];
  for (const row of rows || []) {
    const name = classifyUsdNewsTitle(row?.title || row?.name, row?.country);
    if (!name) continue;
    const atMs = Date.parse(String(row?.date || row?.at || ''));
    if (!Number.isFinite(atMs)) continue;
    if (atMs < start || atMs > end) continue;
    const stamp = new Date(atMs);
    const eastern = new Date(atMs + (isEasternDaylightTime(stamp.getUTCFullYear(), stamp.getUTCMonth() + 1, stamp.getUTCDate()) ? -4 : -5) * 3600000);
    // Use the original offset date string when present so ET date/time stay on the release day.
    const sourceDate = String(row?.date || '');
    const etMatch = sourceDate.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    const date = etMatch ? etMatch[1] : eastern.toISOString().slice(0, 10);
    const time = etMatch ? etMatch[2] : eastern.toISOString().slice(11, 16);
    const event = buildNewsEvent({
      name,
      date,
      time,
      at: new Date(atMs).toISOString(),
      source: 'live',
    });
    if (event) mapped.push(event);
  }
  return mergeNewsEvents(mapped);
}

export async function fetchLiveNewsRows(fetchFn) {
  const run = typeof fetchFn === 'function' ? fetchFn : globalThis.fetch;
  if (typeof run !== 'function') return [];
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
  try {
    const url = `${LIVE_CALENDAR_URL}?t=${Date.now()}`;
    const res = await run(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'LumoEdgeCalendar/1.0' },
      cache: 'no-store',
      signal: ctrl?.signal,
    });
    if (!res?.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function detectUpcomingNews({ nowMs = Date.now(), fetchFn } = {}) {
  const baked = bakedNewsEvents(nowMs);
  const liveRows = await fetchLiveNewsRows(fetchFn);
  const live = newsFromLiveRows(liveRows, nowMs);
  return mergeNewsEvents([...baked, ...live]);
}
