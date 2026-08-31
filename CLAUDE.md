# CLAUDE.md — orientation for an AI agent working on this repo

This file is for a coding agent picking this repo up with no prior
context. For user-facing setup/usage docs, read `README.md` instead —
this file covers architecture, non-obvious decisions, and gotchas that
aren't otherwise discoverable from the code alone.

## What this is

A MapLibre satellite map of community resilience hubs in Queenstown
Lakes, NZ, for Rewiring Aotearoa (rewiring.nz). Data comes from a
published (read-only, public) Google Sheet, fetched as CSV client-side
on every page load — no backend, no API key, no build step.

It's a sibling of **[rewiring-nz/communities-map](https://github.com/rewiring-nz/communities-map)**
— same visual style, same sidebar-list/search/mobile-overlay
interaction pattern, originally forked from that codebase and then
diverged. If you're touching the shared UI chrome (sidebar, search,
mobile layout, marker styling) and something seems off, that repo's own
README/commit history documents the original bugs and fixes for this
exact pattern (e.g. why markers must never have `position` CSS of their
own) — worth checking there before re-solving something already solved.

## File relationships — read this before editing anything

- **`map.js` / `map.css` are the source of truth.** Edit these.
- `index.html` and `embed.html` both load `map.js`/`map.css` as
  external files, so they pick up edits automatically — no extra step.
- **`webflow-embed.html` is a generated artifact** — `map.css` and
  `map.js`'s contents inlined into one paste-ready file for Webflow.
  **Never hand-edit it directly**; regenerate it after every `map.js`/
  `map.css` change with this pipeline (run from the repo root):

  ```bash
  sed 's/^/  /' map.css > /tmp/css_indented.txt
  sed 's/^/  /' map.js > /tmp/js_indented.txt
  total=$(wc -l < /tmp/js_indented.txt); keep=$((total - 2))
  head -n "$keep" /tmp/js_indented.txt > /tmp/js_body.txt
  # (this strips the trailing `window.initResilienceHubsMap = ...; })();`
  # lines — replaced by a direct call, see below)
  ```

  Then concatenate, in order: a header comment block (see the top of
  the current `webflow-embed.html` for its exact wording — don't need
  to reproduce verbatim, just keep the gist), the indented CSS wrapped
  in `<style>...</style>`, a `<script src=".../maplibre-gl.js">` tag,
  `<script>`, the indented JS body (`js_body.txt` — note this is
  missing its closing `window.initResilienceHubsMap = ...; })();`),
  then manually append:

  ```js
      initResilienceHubsMap({
        sheetCsvUrl: "<the published CSV URL — see README>",
        cooperativeGestures: false,
        showListByDefault: true,
        showListByDefaultOnMobile: false
      });
    })();
  </script>
  ```

  (Keep this block's option values in sync with whatever `map.js`'s own
  `opts` defaults currently are — this is just an explicit copy of them
  for `webflow-embed.html`'s init call, not an independent source of
  truth.)

  i.e. the IIFE closes around a **direct call** to
  `initResilienceHubsMap(...)` instead of exporting it to `window` (map.js's
  own last line, `window.initResilienceHubsMap = initResilienceHubsMap;`,
  gets replaced by this call — that's why the pipeline strips it).

  After regenerating, sanity-check: `grep -c "window.initResilienceHubsMap"
  webflow-embed.html` should be **0** (confirms the export line got
  replaced, not duplicated), and diff the CSS/JS section boundaries
  look right (`grep -n "^</style>$\|^<script>$\|^</script>$"`).

## Non-obvious design decisions

**Card fields are fully generic, not a fixed schema.** `map.js`'s
`rowsToFeatureCollection()` only special-cases `Name`/`Lat`/`Lng`/
`Image1`/`Image2` (see `SPECIAL_FIELDS`) — every other column in the
sheet becomes a field in `properties.fields`, and `cardHTML()` just
iterates `Object.keys(props.fields)` to render one row per column, in
the sheet's own left-to-right order (JS preserves string-key insertion
order, so this "just works" without sorting). **Do not** reintroduce a
hardcoded field list here — the whole point is that the sheet's owner
can add/rename/reorder columns without needing a code change. Each
value's rendering (colored pill for Yes/No/Unknown, clickable link for
a URL or email, plain text otherwise) is decided per-value by
`specRow()`/`linkifyValue()`, not per-column.

**Hub details are a slide-out panel, not a MapLibre popup.** There is no
`maplibregl.Popup` in this codebase anymore: selecting a hub renders
`cardHTML()` into `.rhm-detail__body` and lets `syncPanels()` decide
which panels are showing. Two panels flank the map in DOM order — the
hub list (`.rhm-sidebar`, left on desktop) and the detail dashboard
(`.rhm-detail`, right on desktop) — and on mobile both become bottom
sheets where only one can show at a time, so selecting a hub swaps the
list out for its details and deselecting swaps it back.

That mobile swap is why every panel visibility change goes through
`syncPanels()` rather than each call site toggling `is-hidden` itself:
whether the list shows is not just "did the user open it" (`listWanted`)
but that *and* whether a hub is selected *and* whether we're at mobile
width. Deriving it in one place is what keeps "✕ on the details panel"
and "‹ All hubs" and "clicked the map" from each needing their own copy
of that logic. Add new entry points by setting `listWanted`/
`activeEntry` and calling `syncPanels()`, not by toggling classes.

**The detail panel's width lives on the inner `.rhm-detail__panel`, not
on `.rhm-detail`.** The outer element is what animates to `width: 0`
when nothing is selected; if the width lived there too, collapsing it
would re-wrap every line of the card's text on every frame of the
transition. The inner panel's `flex: 0 0 360px` keeps the content at
full width while it slides out of the (`overflow: hidden`) outer box.
On mobile, `.rhm-detail` is instead a `max-height`-capped flex container
— capping it also caps the stretched panel inside, which is what makes
`.rhm-detail__body` scroll rather than the sheet growing past the map.

**CSV parsing is hand-rolled** (`parseCSV()`) rather than a naive
`.split(",")`, because real sheet data has commas inside quoted cells
(e.g. a Backup Circuits value like "Lights, outlets"). Don't simplify
this to a split — it will silently misalign columns on exactly the kind
of row that looks fine in a quick test.

**Mobile-height auto-detection only checks `max-height`, never
`height`.** `findWrapperMaxHeightPx()` walks up the DOM from `.rhm-layout`
looking for an ancestor (e.g. a div the embedder wrapped this in) with
an explicit `max-height`, to size the map on mobile. It deliberately
does NOT also check computed `height`: `getComputedStyle(el).height`
always returns a resolved pixel number, even for an element with no
`height` rule at all (e.g. Webflow's own unstyled Embed wrapper div) —
there's no way to distinguish "developer set this" from "browser
computed this from auto-sizing to content" via computed `height`. Only
`max-height` has that distinction (`"none"` vs. a length), so it's the
only reliable signal.

**Mobile bottom sheets need their own stacking context, or the map
paints over them.** On mobile, `.rhm-map` gets `position: relative;
z-index: 0`, `.rhm-sidebar` gets `z-index: 1` and `.rhm-detail` gets
`z-index: 2` — without this, MapLibre's own internal z-indexed layers
(canvas, controls) end up painting *over* the sheets despite them being
`position: absolute`, because neither element had an explicit stacking
context to contain that internal z-index competition. Found by literally
checking `document.elementFromPoint()` at the sidebar's own coordinates
and seeing `<canvas>` come back instead of the sidebar.

**Both panels need `width: auto` in the mobile media query.** The
desktop rules set an explicit width (`240px` on `.rhm-sidebar`, `360px`
on `.rhm-detail`); the mobile rules try to stretch each full-width via
`left: 0; right: 0`, but with an explicit width already set, `left`+`right`+`width` together over-constrain the
box, and the browser keeps the explicit width rather than stretching —
silently, no console warning. `width: auto` releases that constraint.

**Marker clicks deliberately don't zoom; every other way of selecting a
hub does.** `focusEntry()`'s `zoomIn` argument is true for the list,
search and "find closest" (the hub may be off-screen entirely, so it
flies in to at least zoom 12) and false for a marker click, where the
visitor is already looking straight at the marker and only needs the
camera eased clear of the panel about to open over it. On mobile that
easing also applies a `[0, -20% of map height]` camera offset, since the
detail sheet covers the bottom of the map — without it you select a hub
and it disappears behind its own details.

**An earlier version of this map used MapLibre popups with
`focusAfterOpen: false`,** because MapLibre's default auto-focuses a
popup's first link on open and the resulting native focus-scroll, racing
`flyTo()`, could jank-scroll the whole host page (same root cause and
fix as the sibling communities-map repo). The panel doesn't have that
problem — it isn't map-anchored and nothing auto-focuses it — but if you
ever reintroduce a popup here for anything, that's the trap.

**"Find closest hub" (`createFindClosestControl`) is only added to the
map at all if `navigator.geolocation` exists** (checked at the call
site in `renderHubs()`, not inside the function) — no point rendering a
button that can only ever fail. It uses `enableHighAccuracy: false`
deliberately: hubs in this dataset are km apart, so network/wifi-based
location is both good enough and meaningfully faster than waiting on a
GPS lock. `maximumAge: 300000` lets a second click within 5 minutes
reuse the cached fix instead of re-prompting the device hardware.
Distance is straight-line (haversine), not driving distance — fine at
this scale, not fine if this dataset ever grows to cover terrain where
straight-line and driving distance diverge a lot (e.g. across a harbor
or mountain range with one road around it).

**If a user reports "Find closest hub" always fails with "Location
permission denied," check the embed method before assuming it's a code
bug.** Browsers block `navigator.geolocation` inside a cross-origin
iframe by default — `embed.html` (Option A in README) only gets
permission if the *host page's* `<iframe>` tag has
`allow="geolocation"`. Without it, `getCurrentPosition`'s error
callback fires immediately with `PERMISSION_DENIED`, and — this is the
easy-to-miss part — **the browser's actual permission prompt never
appears at all**, so it looks exactly like the visitor clicked "deny"
even though they were never asked. There is no way to distinguish this
case from a real user denial in JS (`err.code` is `PERMISSION_DENIED`
either way) — the fix is entirely on the embedding side (add the `allow`
attribute to the iframe, not a page-content-level check-and-adjust done
inside this codebase), so don't go looking for a code-side detection of
"blocked by iframe policy" — it doesn't exist and isn't buildable.
Option B (inline paste) doesn't have this problem at all, since there's
no iframe boundary for the permission to cross.

## Data source

Published Google Sheet, fetched as CSV — see README.md's "Setting up
the Google Sheet" section for the full how-to. The live URL currently
in use (also hardcoded as the default in `index.html`, `embed.html`,
and `webflow-embed.html`):

```
https://docs.google.com/spreadsheets/d/e/2PACX-1vTEKMCsPBcXZir2R0-nuccbjzJmBlyt_87B37C8MpJBupzIFoQic7SBpr42w0msU9Z9dGnkFqyuSlRD/pub?output=csv
```

You can `curl` this directly to see the current columns/data without
needing the user to paste anything — it's public by design (that's what
"publish to web" means). Columns and their order change over time as
the sheet's owner edits it; don't assume the column list documented in
README.md is exhaustive or current — `curl` the sheet to check.

## Testing notes

- Local dev: `python3 -m http.server <port>` from the repo root, then
  open `index.html`. It points at the real live sheet, so this is a
  true end-to-end test, not a mock.
- **Known dev-environment flakiness (Claude Code's browser-pane tool,
  not a bug in this project):** during heavy iteration, the browser
  pane can get into a state where MapLibre's own `load` event never
  fires — reproducible even for a brand-new, empty-style `maplibregl.Map`
  with zero sources, which rules out anything network- or data-related.
  Suspected WebGL-context exhaustion after creating many map instances
  in one long session. Symptoms: markers/list never populate, no console
  errors, `map.on('load', ...)` callback just never runs. Fix: close all
  browser-pane tabs, `preview_stop` + `preview_start` for a fully fresh
  tab (a same-tab reload/navigate is not enough). If that doesn't clear
  it, fall back to `curl`-based verification of the deployed files
  (confirm the right code shipped) rather than burning turns on visual
  verification — this has happened multiple times across this project's
  development and is reliably a tooling artifact, not a real bug, once
  you've confirmed the same symptom on a throwaway empty map.

## Deployment

GitHub Pages, `rewiring-nz` org, auto-deploys on push to `main` (no
build step — static files served as-is). Poll build status after
pushing:

```bash
gh api repos/rewiring-nz/resilience-hubs-map/pages/builds/latest --jq '.status'
```

Live at https://rewiring-nz.github.io/resilience-hubs-map/ (demo page)
and https://rewiring-nz.github.io/resilience-hubs-map/embed.html (bare,
iframe-ready page — see README's "Embedding on Webflow" for why this
exists alongside `webflow-embed.html`).
