# Plan: Favorite-Locations Tide Forecast Site

## Goal

Rebuild `tides.jsx` from a generic station dashboard into a personal tide-planning app
built around **saved favorite locations**. Each favorite links to the nearest NOAA tide
station, applies a **user-configurable time offset**, and defines a **"good window" rule**
so the app can answer the real question: *"When can I actually go?"*

### Motivating use cases (ship these as seed data)

1. **Nantasket Beach (Hull, MA)** — beach disappears at high tide. The user wants to
   *avoid* the hours around high tide.
   - Station: `8444601` — "Nantasket Beach, Weir River, MA" (verified NOAA subordinate
     prediction station).
   - Rule: bad within ~2 hours of high tide; otherwise good.
2. **North River kayak launch (Marshfield/Norwell, MA)** — launch is only deep enough
   about 2 hours before/after high tide, and the tide at the launch runs **2 hours behind
   Damons Point**.
   - Station: `8445425` — "Damons Point, North River, MA" (verified).
   - Time offset: **+120 minutes** (local high = station high + 2h).
   - Rule: good within ±2 hours of (adjusted) high tide.

## Data sources (all public, no API key)

### 1. NOAA CO-OPS Data API — predictions & observations

Base: `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter`

Common params: `station={id}&time_zone=lst_ldt&units=english&format=json&application=tide_planner`

| Purpose | Extra params |
|---|---|
| High/Low predictions (multi-day) | `begin_date=YYYYMMDD&end_date=YYYYMMDD&product=predictions&datum=MLLW&interval=hilo` |
| 6-min prediction curve | `begin_date=...&end_date=...&product=predictions&datum=MLLW` (optionally `interval=30` to reduce payload for multi-day curves) |
| Latest observed water level | `date=latest&product=water_level&datum=MLLW` |

Responses: `{ "predictions": [{ "t": "2026-07-03 04:12", "v": "9.842", "type": "H" }] }`
(hilo) and `{ "data": [{ "t": ..., "v": ... }] }` (water_level). Errors come back as
`{ "error": { "message": "..." } }` with HTTP 200 — check for `.error` in the body.

### 2. NOAA MDAPI — station directory (for the station picker)

`https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions`

Returns ~3,000 stations: `{ stations: [{ id, name, state, lat, lng, reference_id, type }] }`.
`type` is `"R"` (reference/harmonic) or `"S"` (subordinate). Fetch once, cache in memory
(and localStorage with a timestamp, refresh weekly), filter client-side.

### Gotchas (important)

- **CORS**: both APIs allow browser CORS — all fetching happens client-side. Note:
  server-side/CLI fetches to these hosts may be blocked (they 403 non-browser agents),
  so don't try to verify the API with curl during the build; trust the formats above,
  which come from the working code in the current `tides.jsx`.
- **Subordinate stations** (like both seed stations, `type: "S"`) have **predictions
  only — no live water-level sensor**. `product=water_level` will return an error for
  them. The UI must treat live observations as optional; never let a failed
  water_level fetch break the page. (Current `tides.jsx` throws on this — fix it.)
- `time_zone=lst_ldt` returns times in the station's local zone as naive strings
  `"YYYY-MM-DD HH:MM"`. Parse manually; do not run them through `Date` UTC parsing.
- Predictions `v` values are strings; `parseFloat` before math.

## Architecture

Keep the existing repo pattern: **one self-contained React component file, `tides.jsx`**,
default-exporting `App`, styled with Tailwind utility classes, no external imports beyond
`react`. (It's rendered as a claude.ai-style artifact — no npm deps, no router, no build
config in this repo.)

State persistence: `localStorage` key `tides.favorites.v1` holding the favorites array,
plus `tides.stationDirectory.v1` for the cached station list. On first run (no stored
favorites), seed with the two locations above.

## Data model

```js
// A favorite location
{
  id: "uuid-ish string",            // crypto.randomUUID()
  name: "North River kayak launch", // user's label
  notes: "Launch off Union St bridge; needs ~2ft over ramp",
  stationId: "8445425",
  stationName: "Damons Point, North River, MA", // denormalized for display
  offsetMinutes: 120,               // added to every station prediction time; may be negative
  heightAdjustFt: 0,                // optional additive height tweak, default 0
  rule: {
    kind: "near_high" | "near_low" | "avoid_high" | "avoid_low" | "none",
    hoursBefore: 2,                 // window half-widths around the (adjusted) event
    hoursAfter: 2
  }
}
```

Rule semantics: `near_high` ⇒ good only inside [high − before, high + after];
`avoid_high` ⇒ good everywhere *except* that interval; symmetric for low; `none` ⇒ no
good/bad shading, just show tides.

**Offsets apply to display only**: fetch station data raw, then shift every timestamp by
`offsetMinutes` (and add `heightAdjustFt` to values) in one place — a
`adjustPrediction(favorite, prediction)` helper — before anything renders. Windows are
computed from *adjusted* event times.

## UI (screens/components)

1. **Home: favorites list.** One card per favorite showing, at a glance:
   - Name, station name, offset badge (e.g. "+2:00 vs station") when nonzero.
   - **Status line — the headline feature**: "✅ Good now — until 3:40 PM" or
     "❌ Not now — next window 5:10–9:10 PM" computed from the rule and adjusted
     predictions. Neutral phrasing ("High 4:12 PM · Low 10:33 PM") when rule is `none`.
   - Next high/low (adjusted times + heights).
   - Cards are clickable → detail view. "Add location" button. Reorder via up/down
     buttons is enough; drag-and-drop not required.
2. **Detail view (per favorite).**
   - Day selector: Today + next 6 days (fetch hilo for the full 7-day span in one
     request; fetch the curve per selected day).
   - Tide curve (reuse/adapt existing `TideChart` SVG): shift times by offset, shade
     **good windows in green / bad in red-tinted bands** under the curve, "now" marker
     only when viewing today.
   - Table of adjusted highs/lows for the selected day, plus the computed good windows
     listed as text ("Good: 11:05 AM – 3:05 PM").
   - Live observed level (only if the station supports it — hide section otherwise).
   - Footer note: "Predictions from NOAA station 8445425 (Damons Point), times shifted
     +2:00 for this location."
3. **Add/Edit favorite form.**
   - Name, notes.
   - **Station picker**: text input filtering the cached MDAPI directory by
     name/state/id, showing matches in a dropdown (limit ~20, show `name, state (id)`).
     Optional nicety: "sort by distance" using browser geolocation if granted — skip if
     it adds complexity.
   - Offset: signed hours+minutes input (two selects or a single `±H:MM` field).
     Plain-language helper text: "Positive if your spot's tide happens AFTER the
     station's (e.g. +2:00 for a spot two hours behind the station's high tide)."
   - Rule: kind select + before/after hour inputs (0.5-hour steps).
   - Delete button (with confirm) on edit.

## Implementation steps

1. **Refactor scaffolding**: keep utility/icon code from current `tides.jsx`; extract a
   robust local-time parser/formatter pair (`parseNoaaTime(str) -> {y,mo,d,h,mi}` plus
   minutes-since-epoch-style comparable number; `formatClock`, `formatDayLabel`).
2. **Data layer**: `fetchHiLo(stationId, beginDate, endDate)`, `fetchCurve(stationId, date)`,
   `fetchLatestLevel(stationId)` (returns null on error), `fetchStationDirectory()` with
   localStorage cache. All return parsed/typed objects; centralize the `.error` check.
3. **Favorites store**: load/save/seed localStorage; CRUD functions; migration guard on
   malformed JSON (fall back to seeds).
4. **Adjustment + windows engine** (pure functions, the core logic):
   - `adjustHiLo(favorite, hilos)` — shift times/heights.
   - `computeWindows(favorite, adjustedHilos, dayStart, dayEnd)` — returns
     `[{startMin, endMin, good: bool}]` covering the day; clip windows to day bounds;
     handle events just outside the day (fetch hilo from day−1 to day+1 so edge windows
     are correct).
   - `statusNow(favorite, adjustedHilos, now)` — good/bad + boundary time of current
     state + next transition, for the card headline.
5. **UI**: favorites list → detail → form, per the section above. Adapt `TideChart` to
   take precomputed points + window bands + optional now-marker.
6. **Polish**: loading skeletons per card (parallel fetches), error card per favorite
   (one bad station must not blank the app), responsive layout (this will be used on a
   phone at the beach), footer NOAA attribution.

## Testing checklist (manual, in browser)

- Fresh load (empty localStorage) shows the two seeded locations with live NOAA data.
- North River card: adjusted high = Damons Point high + 2:00 exactly; good window is
  ±2h around adjusted high; status line flips correctly around window edges.
- Nantasket card: window logic inverted (good = NOT near high).
- Station picker finds "Boston" (`8443970`, type R) and "Nantasket" (`8444601`, type S).
- A subordinate station shows no live-level section and no error.
- Negative offset works (e.g. −0:30). Rule `none` shows neutral card.
- Day tabs: tomorrow/+6 days render; windows spanning midnight clip correctly.
- Reload persists edits; corrupt `tides.favorites.v1` JSON falls back to seeds.

## Out of scope (don't build)

Accounts/sync, server/backend, non-NOAA data sources, weather, currents, moon phases,
notifications, PWA/offline. localStorage-only is fine.
