import React, { useState, useEffect, useMemo } from 'react';

// NOTE ON TIME: NOAA returns station times as naive local wall-clock strings
// (LST/LDT, no UTC offset). We parse them as if they were UTC ("synthetic
// epoch") purely so we can do arithmetic (add offsets, compare, sort) without
// real timezone conversion. "Now" is derived from the browser's wall clock
// using the same trick. This only lines up correctly when the device viewing
// the app is in the same time zone as the tide station — true for the
// personal-use case this app targets (your own nearby favorite spots).

// --- Constants ---
const NOAA_BASE = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const MDAPI_STATIONS_URL = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions';
const FAVORITES_KEY = 'tides.favorites.v1';
const STATION_DIR_KEY = 'tides.stationDirectory.v1';
const STATION_DIR_MAX_AGE = 7 * 24 * 3600 * 1000;

const RULE_KINDS = [
  { value: 'none', label: 'No rule — just show tides' },
  { value: 'near_high', label: 'Good near high tide' },
  { value: 'near_low', label: 'Good near low tide' },
  { value: 'avoid_high', label: 'Avoid near high tide' },
  { value: 'avoid_low', label: 'Avoid near low tide' },
];

const SEED_FAVORITES = [
  {
    id: 'seed-nantasket',
    name: 'Nantasket Beach',
    notes: "The beach disappears at high tide — go when it's not near high.",
    stationId: '8444601',
    stationName: 'Nantasket Beach, Weir River, MA',
    offsetMinutes: 0,
    heightAdjustFt: 0,
    rule: { kind: 'avoid_high', hoursBefore: 2, hoursAfter: 2 },
  },
  {
    id: 'seed-north-river',
    name: 'North River Kayak Launch',
    notes: 'Only deep enough near high tide. Runs 2 hours behind Damons Point.',
    stationId: '8445425',
    stationName: 'Damons Point, North River, MA',
    offsetMinutes: 120,
    heightAdjustFt: 0,
    rule: { kind: 'near_high', hoursBefore: 2, hoursAfter: 2 },
  },
];

// --- Time utilities ---
const parseNoaaTime = (str) => {
  const [datePart, timePart] = str.split(' ');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  return Date.UTC(y, mo - 1, d, h, mi);
};

const nowEpoch = () => {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
};

const todayStartEpoch = () => {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
};

const dayStartEpoch = (offsetDays) => todayStartEpoch() + offsetDays * 86400000;

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const formatApiDate = (date) => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
};

const formatClock = (epoch) => {
  const d = new Date(epoch);
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  h = h ? h : 12;
  const mm = m < 10 ? '0' + m : String(m);
  return `${h}:${mm} ${ampm}`;
};

const formatDayLabel = (epoch) => {
  const diffDays = Math.round((epoch - todayStartEpoch()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tmrw';
  const d = new Date(epoch);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

const formatOffset = (minutes) => {
  if (!minutes) return null;
  const sign = minutes > 0 ? '+' : '−';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}:${String(m).padStart(2, '0')} vs station`;
};

// --- Data layer ---
async function noaaFetch(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'NOAA API error');
  return json;
}

async function fetchHiLo(stationId, beginDate, endDate) {
  const url = `${NOAA_BASE}?station=${stationId}&time_zone=lst_ldt&units=english&format=json&application=tide_planner&begin_date=${formatApiDate(beginDate)}&end_date=${formatApiDate(endDate)}&product=predictions&datum=MLLW&interval=hilo`;
  const json = await noaaFetch(url);
  return json.predictions || [];
}

async function fetchCurve(stationId, beginDate, endDate) {
  const url = `${NOAA_BASE}?station=${stationId}&time_zone=lst_ldt&units=english&format=json&application=tide_planner&begin_date=${formatApiDate(beginDate)}&end_date=${formatApiDate(endDate)}&product=predictions&datum=MLLW`;
  const json = await noaaFetch(url);
  return json.predictions || [];
}

async function fetchLatestLevel(stationId) {
  try {
    const url = `${NOAA_BASE}?station=${stationId}&time_zone=lst_ldt&units=english&format=json&application=tide_planner&date=latest&product=water_level&datum=MLLW`;
    const json = await noaaFetch(url);
    if (!json.data || !json.data.length) return null;
    return { v: parseFloat(json.data[0].v), t: json.data[0].t };
  } catch {
    return null;
  }
}

async function fetchStationDirectory() {
  try {
    const cached = JSON.parse(localStorage.getItem(STATION_DIR_KEY));
    if (cached && cached.fetchedAt && Array.isArray(cached.stations) && Date.now() - cached.fetchedAt < STATION_DIR_MAX_AGE) {
      return cached.stations;
    }
  } catch {
    // fall through to refetch
  }
  const json = await noaaFetch(MDAPI_STATIONS_URL);
  const stations = (json.stations || []).map((s) => ({
    id: s.id, name: s.name, state: s.state, lat: s.lat, lng: s.lng,
  }));
  try {
    localStorage.setItem(STATION_DIR_KEY, JSON.stringify({ fetchedAt: Date.now(), stations }));
  } catch {
    // localStorage full/unavailable — non-fatal
  }
  return stations;
}

// --- Favorites store ---
function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return SEED_FAVORITES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return SEED_FAVORITES;
    if (!parsed.every((f) => f && f.id && f.stationId && f.rule)) return SEED_FAVORITES;
    return parsed;
  } catch {
    return SEED_FAVORITES;
  }
}

function saveFavorites(favorites) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  } catch {
    // localStorage full/unavailable — non-fatal
  }
}

// --- Tide adjustment + windows engine ---
function adjustHiLoEvents(favorite, hilos) {
  return hilos
    .map((p) => ({
      type: p.type,
      epoch: parseNoaaTime(p.t) + favorite.offsetMinutes * 60000,
      v: parseFloat(p.v) + (favorite.heightAdjustFt || 0),
    }))
    .sort((a, b) => a.epoch - b.epoch);
}

function adjustCurvePoints(favorite, predictions) {
  return predictions
    .map((p) => ({
      epoch: parseNoaaTime(p.t) + favorite.offsetMinutes * 60000,
      v: parseFloat(p.v) + (favorite.heightAdjustFt || 0),
    }))
    .sort((a, b) => a.epoch - b.epoch);
}

function computeWindows(favorite, events, rangeStart, rangeEnd) {
  const { kind, hoursBefore, hoursAfter } = favorite.rule;
  if (kind === 'none') return [{ start: rangeStart, end: rangeEnd, good: null }];

  const wantHigh = kind === 'near_high' || kind === 'avoid_high';
  const isNear = kind.startsWith('near_');
  const beforeMs = hoursBefore * 3600000;
  const afterMs = hoursAfter * 3600000;

  const eventWindows = events
    .filter((e) => (wantHigh ? e.type === 'H' : e.type === 'L'))
    .map((e) => [e.epoch - beforeMs, e.epoch + afterMs])
    .filter(([s, e]) => e > rangeStart && s < rangeEnd)
    .map(([s, e]) => [Math.max(s, rangeStart), Math.min(e, rangeEnd)])
    .sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const w of eventWindows) {
    if (merged.length && w[0] <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], w[1]);
    } else {
      merged.push([...w]);
    }
  }

  const segments = [];
  let cursor = rangeStart;
  for (const [s, e] of merged) {
    if (s > cursor) segments.push({ start: cursor, end: s, near: false });
    segments.push({ start: s, end: e, near: true });
    cursor = e;
  }
  if (cursor < rangeEnd) segments.push({ start: cursor, end: rangeEnd, near: false });
  if (segments.length === 0) segments.push({ start: rangeStart, end: rangeEnd, near: false });

  return segments.map((seg) => ({ ...seg, good: isNear ? seg.near : !seg.near }));
}

function computeStatus(favorite, events, now) {
  if (!events || events.length === 0) return null;
  if (favorite.rule.kind === 'none') {
    return {
      neutral: true,
      next: events.find((e) => e.epoch > now) || null,
    };
  }
  const rangeStart = now - 24 * 3600000;
  const rangeEnd = now + 96 * 3600000;
  const segments = computeWindows(favorite, events, rangeStart, rangeEnd);
  const idx = segments.findIndex((s) => now >= s.start && now < s.end);
  if (idx === -1) return null;
  const current = segments[idx];
  const next = segments[idx + 1] || null;
  return {
    neutral: false,
    good: current.good,
    currentEnd: current.end < rangeEnd ? current.end : null,
    nextStart: next ? next.start : null,
    nextEnd: next ? next.end : null,
  };
}

// --- Icons ---
const iconProps = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };

const WavesIcon = (props) => (
  <svg {...iconProps} {...props}>
    <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.6 2 5 2 2.3 0 2.3-2 5-2 1.3 0 1.9.5 2.5 1" /><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.6 2 5 2 2.3 0 2.3-2 5-2 1.3 0 1.9.5 2.5 1" /><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.6 2 5 2 2.3 0 2.3-2 5-2 1.3 0 1.9.5 2.5 1" />
  </svg>
);
const PlusIcon = (props) => (<svg {...iconProps} {...props}><path d="M5 12h14" /><path d="M12 5v14" /></svg>);
const ChevronLeftIcon = (props) => (<svg {...iconProps} {...props}><path d="m15 18-6-6 6-6" /></svg>);
const ChevronUpIcon = (props) => (<svg {...iconProps} {...props}><path d="m18 15-6-6-6 6" /></svg>);
const ChevronDownIcon = (props) => (<svg {...iconProps} {...props}><path d="m6 9 6 6 6-6" /></svg>);
const PencilIcon = (props) => (<svg {...iconProps} {...props}><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>);
const TrashIcon = (props) => (<svg {...iconProps} {...props}><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>);
const CheckCircleIcon = (props) => (<svg {...iconProps} {...props}><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></svg>);
const XCircleIcon = (props) => (<svg {...iconProps} {...props}><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" /></svg>);
const ClockIcon = (props) => (<svg {...iconProps} {...props}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>);

// --- Status headline (shared) ---
const StatusHeadline = ({ status }) => {
  if (!status) return <span className="text-slate-500 text-sm">Status unavailable</span>;
  if (status.neutral) {
    return (
      <span className="text-slate-300 text-sm font-medium">
        {status.next ? `Next ${status.next.type === 'H' ? 'high' : 'low'} at ${formatClock(status.next.epoch)}` : 'No upcoming tide data'}
      </span>
    );
  }
  if (status.good) {
    return (
      <span className="flex items-center gap-1.5 text-emerald-400 font-semibold text-sm">
        <CheckCircleIcon className="w-4 h-4" />
        Good now{status.currentEnd ? ` — until ${formatClock(status.currentEnd)}` : ''}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-rose-400 font-semibold text-sm">
      <XCircleIcon className="w-4 h-4" />
      Not now{status.nextStart ? ` — next window ${formatClock(status.nextStart)}–${formatClock(status.nextEnd)}` : ''}
    </span>
  );
};

// --- Tide chart ---
const TideChart = ({ points, windows, rangeStart, rangeEnd, hiLoMarkers, nowMarkerEpoch }) => {
  if (!points || points.length === 0) {
    return <div className="text-slate-500 flex h-full items-center justify-center font-medium">No curve data available for this day</div>;
  }

  const vals = points.map((p) => p.v);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = (maxV - minV) || 1;
  const width = 1000;
  const height = 240;

  const getX = (epoch) => ((epoch - rangeStart) / (rangeEnd - rangeStart)) * width;
  const getY = (v) => height - ((v - minV) / range) * height * 0.8 - height * 0.1;

  const pointsStr = points.map((p) => `${getX(p.epoch)},${getY(p.v)}`).join(' ');
  const firstX = getX(points[0].epoch);
  const lastX = getX(points[points.length - 1].epoch);
  const areaPath = `M ${firstX},${height} L ${pointsStr} L ${lastX},${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible drop-shadow-md">
      <defs>
        <linearGradient id="curveGradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
        </linearGradient>
      </defs>

      {windows && windows.filter((w) => w.good !== null).map((w, i) => {
        const x1 = Math.max(0, getX(w.start));
        const x2 = Math.min(width, getX(w.end));
        if (x2 <= x1) return null;
        return <rect key={i} x={x1} y="0" width={x2 - x1} height={height} fill={w.good ? '#10b981' : '#f43f5e'} fillOpacity="0.12" />;
      })}

      {[6, 12, 18].map((h) => {
        const x = (h / 24) * width;
        return (
          <g key={h}>
            <line x1={x} y1="0" x2={x} y2={height} stroke="currentColor" strokeOpacity="0.1" className="text-slate-300" strokeDasharray="4 4" />
            <text x={x} y={height - 8} fill="currentColor" fillOpacity="0.5" fontSize="13" textAnchor="middle" className="text-slate-300 font-medium tracking-wide">
              {h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`}
            </text>
          </g>
        );
      })}

      <line x1="0" y1={height} x2={width} y2={height} stroke="currentColor" strokeOpacity="0.2" className="text-slate-300" />
      <path d={areaPath} fill="url(#curveGradient)" />
      <polyline points={pointsStr} fill="none" stroke="#60a5fa" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />

      {hiLoMarkers && hiLoMarkers.map((e, i) => (
        <circle key={i} cx={getX(e.epoch)} cy={getY(e.v)} r="5" fill={e.type === 'H' ? '#34d399' : '#60a5fa'} stroke="#0f172a" strokeWidth="2" />
      ))}

      {nowMarkerEpoch != null && nowMarkerEpoch >= rangeStart && nowMarkerEpoch <= rangeEnd && (
        <line x1={getX(nowMarkerEpoch)} y1="0" x2={getX(nowMarkerEpoch)} y2={height} stroke="#e2e8f0" strokeOpacity="0.5" strokeDasharray="6 4" strokeWidth="2" />
      )}
    </svg>
  );
};

// --- Favorite card (list view) ---
const FavoriteCard = ({ favorite, index, total, onOpen, onMoveUp, onMoveDown }) => {
  const [events, setEvents] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchHiLo(favorite.stationId, addDays(new Date(), -2), addDays(new Date(), 4))
      .then((hilos) => {
        if (!alive) return;
        setEvents(adjustHiLoEvents(favorite, hilos));
        setLoading(false);
      })
      .catch((err) => {
        if (alive) { setError(err.message); setLoading(false); }
      });
    return () => { alive = false; };
  }, [favorite.stationId, favorite.offsetMinutes, favorite.heightAdjustFt]);

  const now = nowEpoch();
  const status = events ? computeStatus(favorite, events, now) : null;
  const nextHigh = events ? events.find((e) => e.epoch > now && e.type === 'H') : null;
  const nextLow = events ? events.find((e) => e.epoch > now && e.type === 'L') : null;
  const offsetLabel = formatOffset(favorite.offsetMinutes);

  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-3xl p-5 sm:p-6 hover:bg-slate-800/60 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <button onClick={() => onOpen(favorite.id)} className="text-left flex-1 min-w-0">
          <h3 className="text-lg font-bold text-white truncate">{favorite.name}</h3>
          <p className="text-slate-400 text-sm truncate mt-0.5">
            {favorite.stationName}{offsetLabel ? ` · ${offsetLabel}` : ''}
          </p>
        </button>
        <div className="flex flex-col gap-1 shrink-0">
          <button onClick={() => onMoveUp(favorite.id)} disabled={index === 0} className="disabled:opacity-20 text-slate-400 hover:text-white transition-colors">
            <ChevronUpIcon className="w-4 h-4" />
          </button>
          <button onClick={() => onMoveDown(favorite.id)} disabled={index === total - 1} className="disabled:opacity-20 text-slate-400 hover:text-white transition-colors">
            <ChevronDownIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      <button onClick={() => onOpen(favorite.id)} className="w-full text-left mt-4">
        {loading && <div className="h-5 w-40 bg-slate-700/50 rounded animate-pulse" />}
        {error && <span className="text-rose-400 text-sm">Couldn't load tide data: {error}</span>}
        {!loading && !error && <StatusHeadline status={status} />}
        {!loading && !error && (
          <div className="mt-3 flex gap-5 text-sm text-slate-400">
            <span>High {nextHigh ? formatClock(nextHigh.epoch) : '—'}</span>
            <span>Low {nextLow ? formatClock(nextLow.epoch) : '—'}</span>
          </div>
        )}
      </button>
    </div>
  );
};

// --- Favorites list (home) ---
const FavoritesList = ({ favorites, onOpen, onAdd, onMove }) => (
  <div className="space-y-6">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <div className="p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20 shadow-inner">
          <WavesIcon className="w-8 h-8 text-blue-400" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">My Tide Spots</h1>
          <p className="text-slate-400 text-sm font-medium mt-1">NOAA predictions, adjusted for your favorite spots</p>
        </div>
      </div>
      <button onClick={onAdd} className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-3 rounded-xl transition-colors shadow-sm">
        <PlusIcon className="w-5 h-5" /> Add spot
      </button>
    </div>

    {favorites.length === 0 && (
      <div className="text-center text-slate-500 py-16 border border-dashed border-slate-700 rounded-3xl">
        No favorite spots yet. Add one to get started.
      </div>
    )}

    <div className="space-y-4">
      {favorites.map((f, i) => (
        <FavoriteCard
          key={f.id}
          favorite={f}
          index={i}
          total={favorites.length}
          onOpen={onOpen}
          onMoveUp={(id) => onMove(id, -1)}
          onMoveDown={(id) => onMove(id, 1)}
        />
      ))}
    </div>
  </div>
);

// --- Detail view ---
const DetailView = ({ favorite, onBack, onEdit }) => {
  const [dayOffset, setDayOffset] = useState(0);
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState(null);
  const [curvePoints, setCurvePoints] = useState([]);
  const [curveLoading, setCurveLoading] = useState(true);
  const [curveError, setCurveError] = useState(null);
  const [liveLevel, setLiveLevel] = useState(null);

  useEffect(() => {
    let alive = true;
    setEventsLoading(true);
    setEventsError(null);
    fetchHiLo(favorite.stationId, addDays(new Date(), -2), addDays(new Date(), 8))
      .then((hilos) => {
        if (!alive) return;
        setEvents(adjustHiLoEvents(favorite, hilos));
        setEventsLoading(false);
      })
      .catch((err) => {
        if (alive) { setEventsError(err.message); setEventsLoading(false); }
      });
    return () => { alive = false; };
  }, [favorite.stationId, favorite.offsetMinutes, favorite.heightAdjustFt]);

  useEffect(() => {
    let alive = true;
    setCurveLoading(true);
    setCurveError(null);
    fetchCurve(favorite.stationId, addDays(new Date(), dayOffset - 1), addDays(new Date(), dayOffset + 1))
      .then((preds) => {
        if (!alive) return;
        setCurvePoints(adjustCurvePoints(favorite, preds));
        setCurveLoading(false);
      })
      .catch((err) => {
        if (alive) { setCurveError(err.message); setCurveLoading(false); }
      });
    return () => { alive = false; };
  }, [favorite.stationId, favorite.offsetMinutes, favorite.heightAdjustFt, dayOffset]);

  useEffect(() => {
    let alive = true;
    setLiveLevel(null);
    fetchLatestLevel(favorite.stationId).then((res) => { if (alive) setLiveLevel(res); });
    return () => { alive = false; };
  }, [favorite.stationId]);

  const dStart = dayStartEpoch(dayOffset);
  const dEnd = dStart + 86400000;
  const now = nowEpoch();
  const isToday = dayOffset === 0;

  const dayCurve = useMemo(() => curvePoints.filter((p) => p.epoch >= dStart && p.epoch <= dEnd), [curvePoints, dStart, dEnd]);
  const dayEvents = useMemo(() => events.filter((e) => e.epoch >= dStart && e.epoch < dEnd), [events, dStart, dEnd]);
  const windows = useMemo(() => computeWindows(favorite, events, dStart, dEnd), [favorite, events, dStart, dEnd]);
  const goodWindows = windows.filter((w) => w.good === true);
  const status = computeStatus(favorite, events, now);
  const offsetLabel = formatOffset(favorite.offsetMinutes);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <button onClick={onBack} className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors font-medium">
          <ChevronLeftIcon className="w-5 h-5" /> Back
        </button>
        <button onClick={onEdit} className="flex items-center gap-2 text-slate-300 hover:text-white bg-slate-800/60 hover:bg-slate-800 px-4 py-2 rounded-xl transition-colors text-sm font-semibold">
          <PencilIcon className="w-4 h-4" /> Edit
        </button>
      </div>

      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white">{favorite.name}</h1>
        {favorite.notes && <p className="text-slate-400 text-sm mt-1">{favorite.notes}</p>}
        {!eventsLoading && !eventsError && favorite.rule.kind !== 'none' && (
          <div className="mt-3"><StatusHeadline status={status} /></div>
        )}
      </div>

      {eventsError && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-3xl p-6 text-rose-400">
          Couldn't load tide predictions: {eventsError}
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {Array.from({ length: 7 }).map((_, i) => (
          <button
            key={i}
            onClick={() => setDayOffset(i)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-colors ${dayOffset === i ? 'bg-blue-600 text-white' : 'bg-slate-800/60 text-slate-300 hover:bg-slate-800'}`}
          >
            {formatDayLabel(dayStartEpoch(i))}
          </button>
        ))}
      </div>

      <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-lg">
        <h3 className="text-lg font-bold text-slate-200 mb-6">Tide Curve</h3>
        <div className="h-48 sm:h-72 w-full relative pt-6 pb-2">
          {curveLoading ? (
            <div className="h-full w-full bg-slate-800/40 rounded-2xl animate-pulse" />
          ) : curveError ? (
            <div className="text-rose-400 flex h-full items-center justify-center font-medium text-sm">{curveError}</div>
          ) : (
            <TideChart
              points={dayCurve}
              windows={windows}
              rangeStart={dStart}
              rangeEnd={dEnd}
              hiLoMarkers={dayEvents}
              nowMarkerEpoch={isToday ? now : null}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-3xl p-6">
          <h4 className="text-slate-400 text-sm font-medium uppercase tracking-wider mb-4">High &amp; Low Tides</h4>
          {eventsLoading ? (
            <div className="space-y-2">
              <div className="h-5 bg-slate-700/50 rounded animate-pulse" />
              <div className="h-5 bg-slate-700/50 rounded animate-pulse" />
            </div>
          ) : dayEvents.length === 0 ? (
            <p className="text-slate-500 text-sm">No tide events for this day</p>
          ) : (
            <ul className="space-y-2">
              {dayEvents.map((e, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span className={`font-semibold ${e.type === 'H' ? 'text-emerald-400' : 'text-blue-400'}`}>{e.type === 'H' ? 'High' : 'Low'}</span>
                  <span className="text-slate-300">{formatClock(e.epoch)}</span>
                  <span className="text-slate-400">{e.v.toFixed(2)} ft</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-slate-800/40 border border-slate-700/50 rounded-3xl p-6">
          <h4 className="text-slate-400 text-sm font-medium uppercase tracking-wider mb-4">
            {favorite.rule.kind === 'none' ? 'Rule' : 'Good Windows'}
          </h4>
          {favorite.rule.kind === 'none' ? (
            <p className="text-slate-500 text-sm">No good/bad rule set for this spot.</p>
          ) : eventsLoading ? (
            <div className="h-5 bg-slate-700/50 rounded animate-pulse" />
          ) : goodWindows.length === 0 ? (
            <p className="text-slate-500 text-sm">No good windows today</p>
          ) : (
            <ul className="space-y-2">
              {goodWindows.map((w, i) => (
                <li key={i} className="text-sm text-emerald-400 font-medium">
                  {formatClock(w.start)} – {formatClock(w.end)}
                </li>
              ))}
            </ul>
          )}
          {liveLevel && (
            <div className="mt-5 pt-5 border-t border-slate-700/50 flex items-center gap-2 text-sm text-slate-300">
              <ClockIcon className="w-4 h-4 text-slate-400" />
              Live: {liveLevel.v.toFixed(2)} ft at {formatClock(parseNoaaTime(liveLevel.t) + favorite.offsetMinutes * 60000)}
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-slate-500 text-xs">
        Predictions from NOAA station {favorite.stationId} ({favorite.stationName}){offsetLabel ? `, times shifted ${offsetLabel.replace(' vs station', '')} for this spot` : ''}.
      </p>
    </div>
  );
};

// --- Add/Edit form ---
const emptyFavorite = () => ({
  id: '',
  name: '',
  notes: '',
  stationId: '',
  stationName: '',
  offsetMinutes: 0,
  heightAdjustFt: 0,
  rule: { kind: 'none', hoursBefore: 2, hoursAfter: 2 },
});

const FavoriteForm = ({ favorite, onSave, onCancel, onDelete }) => {
  const isEdit = !!favorite;
  const [form, setForm] = useState(() => (favorite ? { ...favorite, rule: { ...favorite.rule } } : emptyFavorite()));
  const [stationQuery, setStationQuery] = useState(favorite ? favorite.stationName : '');
  const [stationDir, setStationDir] = useState(null);
  const [stationDirLoading, setStationDirLoading] = useState(true);
  const [stationDirError, setStationDirError] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchStationDirectory()
      .then((stations) => { if (alive) { setStationDir(stations); setStationDirLoading(false); } })
      .catch((err) => { if (alive) { setStationDirError(err.message); setStationDirLoading(false); } });
    return () => { alive = false; };
  }, []);

  const stationResults = useMemo(() => {
    if (!stationDir || stationQuery.trim().length < 2) return [];
    const q = stationQuery.trim().toLowerCase();
    return stationDir
      .filter((s) => s.name.toLowerCase().includes(q) || s.id.includes(q) || (s.state || '').toLowerCase().includes(q))
      .slice(0, 20);
  }, [stationDir, stationQuery]);

  const selectStation = (s) => {
    setForm((f) => ({ ...f, stationId: s.id, stationName: s.name }));
    setStationQuery(s.name);
    setShowDropdown(false);
  };

  const offsetAbs = Math.abs(form.offsetMinutes);
  const offsetDirection = form.offsetMinutes > 0 ? 'behind' : form.offsetMinutes < 0 ? 'ahead' : 'same';
  const offsetHours = Math.floor(offsetAbs / 60);
  const offsetMins = offsetAbs % 60;

  const updateOffset = (direction, hours, mins) => {
    const total = (Number(hours) || 0) * 60 + (Number(mins) || 0);
    const signed = direction === 'ahead' ? -total : direction === 'behind' ? total : 0;
    setForm((f) => ({ ...f, offsetMinutes: signed }));
  };

  const canSave = form.name.trim().length > 0 && form.stationId.length > 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSave) return;
    onSave({
      ...form,
      id: form.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `fav-${Date.now()}`),
      name: form.name.trim(),
    });
  };

  const inputCls = 'w-full bg-slate-800/80 border border-slate-700 hover:border-slate-600 rounded-xl px-4 py-3 text-sm font-medium shadow-sm focus:ring-2 focus:ring-blue-500 outline-none transition-colors text-slate-200 placeholder:text-slate-500';
  const labelCls = 'block text-slate-300 text-sm font-semibold mb-2';

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onCancel} className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors font-medium">
          <ChevronLeftIcon className="w-5 h-5" /> Cancel
        </button>
        <h1 className="text-xl font-bold text-white">{isEdit ? 'Edit Spot' : 'Add Spot'}</h1>
        <div className="w-16" />
      </div>

      <div>
        <label className={labelCls}>Name</label>
        <input className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Nantasket Beach" required />
      </div>

      <div>
        <label className={labelCls}>Notes (optional)</label>
        <textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Any reminders about this spot" />
      </div>

      <div className="relative">
        <label className={labelCls}>Nearest NOAA tide station</label>
        <input
          className={inputCls}
          value={stationQuery}
          onChange={(e) => { setStationQuery(e.target.value); setShowDropdown(true); setForm((f) => ({ ...f, stationId: '', stationName: '' })); }}
          onFocus={() => setShowDropdown(true)}
          placeholder="Search by name, state, or station ID"
        />
        {stationDirLoading && <p className="text-slate-500 text-xs mt-2">Loading station directory…</p>}
        {stationDirError && <p className="text-rose-400 text-xs mt-2">Couldn't load station directory: {stationDirError}</p>}
        {form.stationId && !showDropdown && (
          <p className="text-emerald-400 text-xs mt-2">Selected station {form.stationId}</p>
        )}
        {showDropdown && stationResults.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-slate-800 border border-slate-700 rounded-xl shadow-xl max-h-64 overflow-y-auto">
            {stationResults.map((s) => (
              <button
                type="button"
                key={s.id}
                onClick={() => selectStation(s)}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-700/60 text-sm text-slate-200 border-b border-slate-700/50 last:border-b-0"
              >
                {s.name}{s.state ? `, ${s.state}` : ''} <span className="text-slate-500">({s.id})</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className={labelCls}>Time offset from station</label>
        <p className="text-slate-500 text-xs mb-3">
          Use this if your spot's tide happens at a different time than the station's — e.g. "2 hours behind" for a spot whose high tide arrives 2 hours after the station's.
        </p>
        <div className="flex flex-wrap gap-3">
          <select className={inputCls + ' w-auto'} value={offsetDirection} onChange={(e) => updateOffset(e.target.value, offsetHours, offsetMins)}>
            <option value="same">Same time as station</option>
            <option value="behind">Behind station (later)</option>
            <option value="ahead">Ahead of station (earlier)</option>
          </select>
          {offsetDirection !== 'same' && (
            <>
              <input type="number" min="0" className={inputCls + ' w-24'} value={offsetHours} onChange={(e) => updateOffset(offsetDirection, e.target.value, offsetMins)} />
              <span className="self-center text-slate-400 text-sm">hr</span>
              <input type="number" min="0" max="59" step="5" className={inputCls + ' w-24'} value={offsetMins} onChange={(e) => updateOffset(offsetDirection, offsetHours, e.target.value)} />
              <span className="self-center text-slate-400 text-sm">min</span>
            </>
          )}
        </div>
      </div>

      <div>
        <label className={labelCls}>Good/bad rule</label>
        <select className={inputCls} value={form.rule.kind} onChange={(e) => setForm((f) => ({ ...f, rule: { ...f.rule, kind: e.target.value } }))}>
          {RULE_KINDS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        {form.rule.kind !== 'none' && (
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <span className="text-slate-400 text-sm">Window:</span>
            <input type="number" min="0" step="0.5" className={inputCls + ' w-24'} value={form.rule.hoursBefore} onChange={(e) => setForm((f) => ({ ...f, rule: { ...f.rule, hoursBefore: Number(e.target.value) } }))} />
            <span className="text-slate-400 text-sm">hrs before, </span>
            <input type="number" min="0" step="0.5" className={inputCls + ' w-24'} value={form.rule.hoursAfter} onChange={(e) => setForm((f) => ({ ...f, rule: { ...f.rule, hoursAfter: Number(e.target.value) } }))} />
            <span className="text-slate-400 text-sm">hrs after</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 pt-4">
        {isEdit ? (
          confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-rose-400 text-sm font-medium">Delete this spot?</span>
              <button type="button" onClick={onDelete} className="text-rose-400 hover:text-rose-300 font-semibold text-sm px-3 py-2 bg-rose-500/10 rounded-lg">Yes, delete</button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="text-slate-400 hover:text-white text-sm px-3 py-2">Cancel</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="flex items-center gap-2 text-rose-400 hover:text-rose-300 font-semibold text-sm px-4 py-3 rounded-xl hover:bg-rose-500/10 transition-colors">
              <TrashIcon className="w-4 h-4" /> Delete
            </button>
          )
        ) : <div />}

        <button type="submit" disabled={!canSave} className="ml-auto bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-xl transition-colors">
          Save
        </button>
      </div>
    </form>
  );
};

// --- App root ---
export default function App() {
  const [favorites, setFavorites] = useState(loadFavorites);
  const [view, setView] = useState('list');
  const [activeId, setActiveId] = useState(null);
  const [editingId, setEditingId] = useState(undefined);

  useEffect(() => { saveFavorites(favorites); }, [favorites]);

  const openDetail = (id) => { setActiveId(id); setView('detail'); };
  const openAdd = () => { setEditingId(undefined); setView('form'); };
  const openEdit = (id) => { setEditingId(id); setView('form'); };
  const backToList = () => { setView('list'); setActiveId(null); setEditingId(undefined); };

  const upsertFavorite = (favorite) => {
    setFavorites((prev) => {
      const exists = prev.some((f) => f.id === favorite.id);
      return exists ? prev.map((f) => (f.id === favorite.id ? favorite : f)) : [...prev, favorite];
    });
    setView('list');
  };

  const deleteFavorite = (id) => {
    setFavorites((prev) => prev.filter((f) => f.id !== id));
    backToList();
  };

  const moveFavorite = (id, dir) => {
    setFavorites((prev) => {
      const idx = prev.findIndex((f) => f.id === id);
      const swapIdx = idx + dir;
      if (idx === -1 || swapIdx < 0 || swapIdx >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[swapIdx]] = [copy[swapIdx], copy[idx]];
      return copy;
    });
  };

  const activeFavorite = favorites.find((f) => f.id === activeId) || null;
  const editingFavorite = editingId === undefined ? null : favorites.find((f) => f.id === editingId) || null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-blue-500/30 flex flex-col">
      <div className="max-w-5xl mx-auto w-full p-4 sm:p-6 lg:p-8 space-y-6 flex-grow">
        {view === 'list' && (
          <FavoritesList favorites={favorites} onOpen={openDetail} onAdd={openAdd} onMove={moveFavorite} />
        )}
        {view === 'detail' && activeFavorite && (
          <DetailView favorite={activeFavorite} onBack={backToList} onEdit={() => openEdit(activeFavorite.id)} />
        )}
        {view === 'detail' && !activeFavorite && (
          <div className="text-slate-500 text-center py-16">Spot not found. <button onClick={backToList} className="text-blue-400 underline">Go back</button></div>
        )}
        {view === 'form' && (
          <FavoriteForm
            favorite={editingFavorite}
            onSave={upsertFavorite}
            onCancel={backToList}
            onDelete={editingFavorite ? () => deleteFavorite(editingFavorite.id) : null}
          />
        )}
      </div>

      <footer className="mt-auto text-center text-slate-500 font-medium text-xs py-8 opacity-80">
        Data from NOAA CO-OPS. Times shown are each spot's adjusted local time (station LST/LDT + your offset).
      </footer>
    </div>
  );
}
