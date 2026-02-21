import React, { useState, useEffect } from 'react';

// Common coastal stations with reliable sensor and prediction data
const STATIONS = [
  { id: "8443970", name: "Boston, MA" },
  { id: "8518750", name: "The Battery, NY" },
  { id: "8534720", name: "Atlantic City, NJ" },
  { id: "8665530", name: "Charleston, SC" },
  { id: "8724580", name: "Key West, FL" },
  { id: "8771450", name: "Galveston, TX" },
  { id: "9410170", name: "San Diego, CA" },
  { id: "9414290", name: "San Francisco, CA" },
  { id: "9447130", name: "Seattle, WA" },
  { id: "9441102", name: "Damon Point (Westport), WA" },
  { id: "1612340", name: "Honolulu, HI" },
  { id: "9455920", name: "Anchorage, AK" },
  { id: "8445425", name: "Damons Point, North River, MA" }
];

// --- Utility Functions ---
const formatTime = (timeStr) => {
  if (!timeStr) return '--:--';
  const parts = timeStr.split(' ');
  if (parts.length < 2) return timeStr;
  let [h, m] = parts[1].split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  h = h ? h : 12;
  const mmStr = m < 10 ? '0' + m : m;
  return `${h}:${mmStr} ${ampm}`;
};

const formatTideTime = (timeStr, currentTStr) => {
  if (!timeStr || !currentTStr) return '--:--';
  const tDate = timeStr.split(' ')[0];
  const cDate = currentTStr.split(' ')[0];

  let dayPrefix = "";
  if (tDate !== cDate) {
    if (tDate > cDate) dayPrefix = "Tmrw, ";
    else dayPrefix = "Yest, ";
  }

  return dayPrefix + formatTime(timeStr);
};

// --- SVG Icons ---
const WavesIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.6 2 5 2 2.3 0 2.3-2 5-2 1.3 0 1.9.5 2.5 1" /><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.6 2 5 2 2.3 0 2.3-2 5-2 1.3 0 1.9.5 2.5 1" /><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.6 2 5 2 2.3 0 2.3-2 5-2 1.3 0 1.9.5 2.5 1" />
  </svg>
);

const ArrowUpIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="m5 12 7-7 7 7" /><path d="M12 19V5" />
  </svg>
);

const ArrowDownIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="m19 12-7 7-7-7" /><path d="M12 5v14" />
  </svg>
);

const MinusIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M5 12h14" />
  </svg>
);

const ClockIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
  </svg>
);

// --- Components ---
const HiLoCard = ({ type, data, currentTStr, isNext }) => {
  const isHigh = type.includes('High');

  return (
    <div className={`bg-slate-800/40 border ${isNext ? 'border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.1)]' : 'border-slate-700/50'} rounded-3xl p-5 flex flex-col justify-between backdrop-blur-sm relative overflow-hidden group hover:bg-slate-800/60 transition-colors`}>
      <div className="absolute -right-4 -top-4 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity pointer-events-none">
        {isHigh ? <ArrowUpIcon className="w-24 h-24" /> : <ArrowDownIcon className="w-24 h-24" />}
      </div>
      <div>
        <h4 className="text-slate-400 text-sm font-medium uppercase tracking-wider mb-4 flex items-center gap-2">
          {type}
        </h4>
        {data ? (
          <>
            <div className="text-2xl font-bold text-slate-100">
              {formatTideTime(data.t, currentTStr)}
            </div>
            <div className="text-slate-300 mt-1 flex items-baseline gap-1">
              <span className={`font-semibold ${isHigh ? 'text-emerald-400' : 'text-blue-400'}`}>
                {parseFloat(data.v).toFixed(2)}
              </span>
              <span className="text-sm">ft</span>
            </div>
          </>
        ) : (
          <div className="text-slate-500 text-sm mt-2">Data unavailable</div>
        )}
      </div>
    </div>
  );
};

const TideChart = ({ data, currentTime, currentVal }) => {
  if (!data || data.length === 0) return <div className="text-slate-500 flex h-full items-center justify-center font-medium">No curve data available for this station</div>;

  const minV = Math.min(...data.map(p => parseFloat(p.v)));
  const maxV = Math.max(...data.map(p => parseFloat(p.v)));
  const range = (maxV - minV) || 1;

  const width = 1000;
  const height = 240;

  // Convert time to X coordinate based on minutes of the day
  const getX = (timeStr) => {
    const parts = timeStr.split(' ');
    if (parts.length < 2) return 0;
    const [h, m] = parts[1].split(':').map(Number);
    return ((h * 60 + m) / 1440) * width;
  };

  // Convert height value to Y coordinate (inverted for SVG) with 10% padding
  const getY = (val) => {
    const normalized = (parseFloat(val) - minV) / range;
    return height - (normalized * height * 0.8) - (height * 0.1);
  };

  const pointsStr = data.map(p => `${getX(p.t)},${getY(p.v)}`).join(' ');

  const firstX = getX(data[0].t);
  const lastX = getX(data[data.length - 1].t);
  const areaPath = `M ${firstX},${height} L ${pointsStr} L ${lastX},${height} Z`;

  const currX = getX(currentTime);
  const currY = getY(currentVal);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible drop-shadow-md">
      <defs>
        <linearGradient id="curveGradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
        </linearGradient>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Grid Lines & X-Axis Labels */}
      {[6, 12, 18].map(h => {
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

      {/* Curve and Fill */}
      <path d={areaPath} fill="url(#curveGradient)" />
      <polyline points={pointsStr} fill="none" stroke="#60a5fa" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />

      {/* Current Time Marker */}
      <g transform={`translate(${currX}, 0)`}>
        <line x1="0" y1="0" x2="0" y2={height} stroke="#e2e8f0" strokeOpacity="0.4" strokeDasharray="6 4" strokeWidth="2" />
        <circle cx="0" cy={currY} r="7" fill="#60a5fa" filter="url(#glow)" />
        <circle cx="0" cy={currY} r="3" fill="#ffffff" />

        {/* Floating Label */}
        <rect x="-28" y={currY - 36} width="56" height="24" rx="6" fill="#0f172a" opacity="0.9" className="shadow-lg" />
        <text x="0" y={currY - 19} fill="#f8fafc" fontSize="12" fontWeight="bold" textAnchor="middle">
          {parseFloat(currentVal).toFixed(1)} ft
        </text>
      </g>
    </svg>
  );
};

export default function App() {
  const [stationId, setStationId] = useState(STATIONS[0].id);
  const [tideData, setTideData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const todayDate = new Date();
        const yesterdayDate = new Date(todayDate);
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const tomorrowDate = new Date(todayDate);
        tomorrowDate.setDate(tomorrowDate.getDate() + 2);

        const formatDate = (date) => {
          const yyyy = date.getFullYear();
          const mm = String(date.getMonth() + 1).padStart(2, '0');
          const dd = String(date.getDate()).padStart(2, '0');
          return `${yyyy}${mm}${dd}`;
        };

        const base = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=${stationId}&time_zone=lst_ldt&units=english&format=json&application=tide_dashboard`;

        // Fetch multiple products from NOAA in parallel
        const [latestMLLWRes, latestMSLRes, hiloRes, curveRes] = await Promise.all([
          fetch(`${base}&date=latest&product=water_level&datum=MLLW`).then(r => r.json()),
          fetch(`${base}&date=latest&product=water_level&datum=MSL`).then(r => r.json()),
          fetch(`${base}&begin_date=${formatDate(yesterdayDate)}&end_date=${formatDate(tomorrowDate)}&product=predictions&datum=MLLW&interval=hilo`).then(r => r.json()),
          fetch(`${base}&date=today&product=predictions&datum=MLLW`).then(r => r.json())
        ]);

        if (!isMounted) return;

        if (latestMLLWRes.error || !latestMLLWRes.data) {
          throw new Error(latestMLLWRes.error?.message || "Current real-time observation unavailable for this station.");
        }

        const currentVal = parseFloat(latestMLLWRes.data[0].v);
        const currentTime = latestMLLWRes.data[0].t;

        // The MSL calculation: If the MSL datum query succeeds, we get the offset relative to average!
        let mslRelative = null;
        if (!latestMSLRes.error && latestMSLRes.data && latestMSLRes.data.length > 0) {
          mslRelative = parseFloat(latestMSLRes.data[0].v);
        }

        const hiloList = hiloRes.predictions || [];
        // Since timestamps match LST/LDT timezone exactly as returned by 'latest', we can do safe string comparison
        const past = hiloList.filter(p => p.t <= currentTime);
        const future = hiloList.filter(p => p.t > currentTime);

        setTideData({
          current: { v: currentVal, t: currentTime },
          relativeToMSL: mslRelative,
          lastHigh: past.slice().reverse().find(p => p.type === 'H'),
          lastLow: past.slice().reverse().find(p => p.type === 'L'),
          nextHigh: future.find(p => p.type === 'H'),
          nextLow: future.find(p => p.type === 'L'),
          curve: curveRes.predictions || []
        });
      } catch (err) {
        if (isMounted) setError(err.message);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchData();

    return () => { isMounted = false; };
  }, [stationId]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-blue-500/30 flex flex-col">
      <div className="max-w-5xl mx-auto w-full p-4 sm:p-6 lg:p-8 space-y-6 flex-grow">

        {/* Top Navigation */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 mt-2">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20 shadow-inner">
              <WavesIcon className="w-8 h-8 text-blue-400" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">Coastal Tides</h1>
              <p className="text-slate-400 text-sm font-medium mt-1">Live Telemetry & Predictions</p>
            </div>
          </div>
          <select
            className="bg-slate-800/80 border border-slate-700 hover:border-slate-600 rounded-xl px-4 py-3 text-sm font-semibold shadow-sm focus:ring-2 focus:ring-blue-500 outline-none w-full sm:w-auto transition-colors cursor-pointer text-slate-200"
            value={stationId}
            onChange={e => setStationId(e.target.value)}
          >
            {STATIONS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </header>

        {/* Error Boundary */}
        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-3xl p-6 sm:p-8 text-rose-400 shadow-xl shadow-rose-500/5">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <MinusIcon className="w-5 h-5" /> Data Fetch Failed
            </h3>
            <p className="opacity-90 mt-2 font-medium">{error}</p>
          </div>
        )}

        {/* Loading Skeleton */}
        {loading && !error && (
          <div className="animate-pulse space-y-6">
            <div className="h-48 sm:h-56 bg-slate-800/40 rounded-3xl border border-slate-700/50"></div>
            <div className="h-64 sm:h-80 bg-slate-800/40 rounded-3xl border border-slate-700/50"></div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-slate-800/40 rounded-3xl border border-slate-700/50"></div>)}
            </div>
          </div>
        )}

        {/* Primary Data Display */}
        {!loading && !error && tideData && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
            
            {/* Top Section: Hero & Hi-Lo Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Real-time Hero Card */}
              <div className="lg:col-span-5 relative overflow-hidden bg-gradient-to-br from-blue-600/20 via-indigo-900/40 to-slate-900/80 border border-blue-500/20 rounded-3xl p-8 sm:p-10 backdrop-blur-2xl shadow-2xl flex flex-col justify-center">
                <div className="absolute -top-12 -right-12 p-8 opacity-5 pointer-events-none rotate-12">
                  <WavesIcon className="w-72 h-72 text-blue-100" />
                </div>

                <div className="relative z-10">
                  <h2 className="text-blue-300 font-bold tracking-widest uppercase text-xs mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
                    Live Station Feed
                  </h2>
                  <div className="flex items-baseline gap-3">
                    <span className="text-7xl sm:text-8xl font-black text-white tracking-tighter drop-shadow-lg">
                      {tideData.current.v.toFixed(2)}
                    </span>
                    <span className="text-2xl sm:text-3xl text-blue-200 font-semibold tracking-tight">ft</span>
                  </div>
                  <p className="text-slate-300 mt-4 text-sm sm:text-base flex items-center gap-2 font-medium">
                    <ClockIcon className="w-5 h-5 opacity-70" />
                    Recorded at {formatTime(tideData.current.t)} (Local)
                  </p>

                  {tideData.relativeToMSL !== null && (
                    <div className="mt-8 inline-flex items-center gap-2.5 bg-slate-950/40 rounded-xl px-5 py-3 border border-white/5 shadow-inner backdrop-blur-md">
                      {tideData.relativeToMSL > 0 ? (
                        <div className="bg-emerald-500/20 p-1 rounded-full"><ArrowUpIcon className="w-4 h-4 text-emerald-400" /></div>
                      ) : tideData.relativeToMSL < 0 ? (
                        <div className="bg-rose-500/20 p-1 rounded-full"><ArrowDownIcon className="w-4 h-4 text-rose-400" /></div>
                      ) : (
                        <MinusIcon className="w-4 h-4 text-slate-400" />
                      )}
                      <span className="text-sm font-semibold text-slate-200 tracking-wide">
                        {Math.abs(tideData.relativeToMSL).toFixed(2)} ft {tideData.relativeToMSL >= 0 ? 'above' : 'below'} average
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Hi-Lo Prediction Grid */}
              <div className="lg:col-span-7 grid grid-cols-2 gap-4 sm:gap-6">
                <HiLoCard type="Last High" data={tideData.lastHigh} currentTStr={tideData.current.t} />
                <HiLoCard type="Last Low" data={tideData.lastLow} currentTStr={tideData.current.t} />
                <HiLoCard type="Next High" data={tideData.nextHigh} currentTStr={tideData.current.t} isNext />
                <HiLoCard type="Next Low" data={tideData.nextLow} currentTStr={tideData.current.t} isNext />
              </div>

            </div>

            {/* Tide Curve SVG Visualization */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-lg relative">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold text-slate-200">Today's Prediction Curve</h3>
              </div>
              <div className="h-48 sm:h-72 w-full relative pt-6 pb-2">
                <TideChart data={tideData.curve} currentTime={tideData.current.t} currentVal={tideData.current.v} />
              </div>
            </div>

          </div>
        )}
      </div>

      <footer className="mt-auto text-center text-slate-500 font-medium text-xs py-8 opacity-80">
        Data verified and provided by NOAA CO-OPS API. Times displayed correspond to the selected station's Local Standard Time (LST/LDT).
      </footer>
    </div>
  );
}
