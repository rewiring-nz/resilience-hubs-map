# Community Resilience Hubs Map

A satellite-style MapLibre map of community resilience hubs across New
Zealand, paired with a collapsible list of every hub (left of the map on
desktop, overlaid on top of it on mobile). Clicking a marker or a list
entry opens a popup with the hub's name, description, photo, and its
resilience specs (solar, battery, generator, V2G, backup circuits,
heating types, floor area). No API keys, no CMS — the data comes
straight from a published Google Sheet, and the basemap uses free Esri
World Imagery tiles.

This is the same visual style and interaction pattern as the
[Communities Map](https://github.com/rewiring-nz/communities-map) —
sidebar list, search, mobile overlay behavior, cooperative scroll-zoom —
just with a different data source and popup content.

## Why a Google Sheet instead of a CMS collection

You wanted this editable by "permitted people" without needing Webflow
CMS access — a Google Sheet does that directly: anyone you share edit
access to the sheet with can add, fix, or remove a hub, and it shows up
on the map the next time someone loads the page. No republish step, no
Designer access needed.

The map fetches the sheet fresh on every page load (not a live push) —
edits show up on the *next* load/refresh, not instantly for someone
already on the page. Google's own publish-to-web layer also caches its
output for a few minutes, so a just-saved edit can take a short while to
appear even on a fresh load.

## Files

- `map.js` / `map.css` — the map logic and styling, split out for local dev.
- `index.html` — standalone preview, pointed at the real published sheet.
  Open this to test locally, or view it live at the GitHub Pages URL below.
- `webflow-embed.html` — the same logic/styles inlined into one block,
  ready to paste into a Webflow Embed element.

## Setting up the Google Sheet

### 1. Columns

Only three column headers are fixed (exact spelling, case-sensitive);
everything else is entirely up to you:

| Column | Required | Notes |
|---|---|---|
| `Name` | Yes | Hub name — popup title, marker label, list entry |
| `Lat` | Yes | Decimal latitude. Rows without a valid Lat/Lng are skipped entirely |
| `Lng` | Yes | Decimal longitude |
| `Image1` | No | A direct image URL — shown as a photo at the top of the popup. **Must be a direct image link** (ends in `.jpg`/`.png`/etc. and loads on its own in a browser tab) — a Google Drive "share" link won't work as-is, since that opens Drive's viewer page, not the image file. Host photos somewhere that gives a direct URL (e.g. your Webflow Assets, Imgur, or a Drive link converted to its direct-download form) |
| `Image2` | No | A second photo URL. Not currently shown in the popup — reserved for a gallery if you want one added later |

**Every other column in the sheet shows up in the popup automatically**
— one line per column, in the same left-to-right order as the sheet,
skipping any that are blank for that row. There's nothing to configure:
add a column, rename one, reorder them, delete one you don't need
anymore — the popup just follows. This is how the current sheet's
`Description`, `Address primary`, `Email`, `Facebook`, `WhatsApp`,
`Website`, `Radio`, `Brochure`, `Resilience Guide`, `Generator`,
`Solar`, `Battery`, `V2G`, `Backup circuits`, `Generator tank size`,
`Space heating type`, and `Water heating type` columns all ended up in
the popup without any code changes.

Each value gets one of three treatments, decided automatically from
what's actually in the cell:

- **`Yes` / `No` / `Unknown`** (case-insensitive) → a colored pill
  (green/red/gray). Anything else just displays as plain text instead —
  still works fine, just without the color coding.
- **A `http://` or `https://` URL** → a clickable "Open ↗" link. Good
  for `Website`, `Facebook`, `Brochure`, or any link column — the
  column's own label already says what it links to, so the link text
  stays short rather than showing the whole URL.
- **An email address** → a clickable `mailto:` link, shown as the
  address itself.
- **Anything else** (an address, a name, "Lights, outlets", "20L") →
  plain text.

Commas inside a cell (e.g. "Lights, outlets") are fine — the map parses
quoted CSV fields correctly rather than splitting on every comma.

### 2. Publish the sheet to the web

This is what makes the sheet readable by the map without any
authentication, and it's separate from Google's regular sharing/access
settings — those still control who can *edit* it.

1. In Google Sheets: **File → Share → Publish to web**.
2. Under "Link", choose the specific sheet/tab with your hub data (or
   "Entire document" if there's only one tab).
3. Set the format to **Comma-separated values (.csv)**.
4. Click **Publish**, confirm.
5. Copy the URL it gives you — it looks like:
   `https://docs.google.com/spreadsheets/d/e/<long-id>/pub?output=csv`
6. That's the `sheetCsvUrl` value used in `index.html` and
   `webflow-embed.html`.

**This is separate from who can edit the sheet.** Publishing to web only
controls whether this *read-only, published* CSV snapshot is fetchable
by anyone with the link (which the map embed needs, since it's a static
page with no login) — normal Google Sheets sharing (Editor / Viewer /
Commenter, restricted to specific people) still controls who can
actually change the data. Keep edit access limited to whoever you trust
to maintain hub listings; the published CSV link itself is effectively
public once created (same as this map data will be, wherever it's
embedded).

If you ever need to stop the map from working (e.g. taking it offline),
un-publishing the sheet (same File → Share → Publish to web dialog,
"Stop publishing") is enough — the CSV URL will start returning errors
and the map will show its "Couldn't load hub data" message.

### 3. Multiple tabs

If your spreadsheet has more than one tab and you published a specific
one (not "Entire document"), the CSV URL from step 2 already points at
that exact tab. If you need the map to read a *different* tab than the
one that URL defaults to, republish selecting that tab specifically —
each tab gets its own CSV URL under this publishing flow.

## Popup design notes

- The photo (`Image1`) is only shown if present — hubs without a photo
  just show the title straight into the field list, no empty space left
  for it.
- A hub with most columns filled in can easily have 15+ rows, so the
  field list scrolls internally (capped around 260px tall) instead of
  growing the popup taller than the map itself.
- See the column table above for how each value's treatment (pill,
  link, or plain text) is decided.

## Sidebar list, search, mobile behavior

Same interaction pattern as the Communities Map:

- Desktop (`≥768px`): list on the left, map on the right.
- Mobile (`<768px`): the map fills the whole embed height, and the list
  is an overlay that grows up from the bottom edge when shown, rather
  than pushing the map into a smaller area. The map's own height on
  mobile is auto-detected from the nearest ancestor element with an
  explicit `max-height` (e.g. if you wrap the embed in a div with
  `max-height: 70vh; overflow: hidden`) — nothing to configure, it just
  works if you've set that up, and falls back to a `70vh` default
  otherwise.
- The **✕** in the list header hides it; a **"Show hub list"** button
  then appears as a map control to bring it back.
- Clicking the **"Resilience Hubs"** title re-fits the map to show every
  hub.
- Search matches on hub name (diacritic-insensitive).
- Only one popup is ever open at a time; the list highlights whichever
  hub's popup is currently open, however it was opened.

## Webflow setup

1. Add an **Embed** element anywhere on the page.
2. Paste the full contents of `webflow-embed.html` into it.
3. If you want a fixed map height on mobile (see above), wrap the Embed
   in a Div block and set that div's Max Height (e.g. `70vh`) — this is
   optional, it just falls back to a sensible default without it.
4. Publish the page.

### Customize

- **`sheetCsvUrl`** — near the bottom of `webflow-embed.html`, in the
  `initResilienceHubsMap({...})` call. Point this at your own sheet's
  published CSV URL (see setup above) if you're duplicating this for a
  different dataset.
- **Marker color / popup styling** — edit the `<style>` block
  (`.rhm-marker`, `.rhm-popup*`, `.rhm-pill*` classes).
- **Scroll-zoom gesture lock** — `cooperativeGestures: false` in the same
  init call restores plain scroll-to-zoom instead of requiring Ctrl/⌘.
- **List shown by default** — `showListByDefault: false` starts with the
  list hidden and the "Show hub list" button visible instead.
- **Initial center/zoom** — `NZ_CENTER` and `zoom` in the script. The map
  auto-fits to whatever hubs are present once loaded, so this only
  matters before data loads or with a single hub.
- **Basemap** — currently Esri World Imagery (satellite) with an Esri
  reference-labels overlay, same as the Communities Map.

## Local preview

```bash
cd resilience-hubs-map
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. Uses the real published sheet, so
edits you make there show up on a refresh.

## Hosting

This repo is published via GitHub Pages, auto-deploying on every push to
`main` — no build step. Live at:
https://rewiring-nz.github.io/resilience-hubs-map/
