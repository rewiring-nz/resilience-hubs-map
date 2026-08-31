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

The map sits next to a panel (right side on desktop, bottom overlay on
mobile) that shows either the full hub list or one selected hub's
detail view — never both. There is **no MapLibre Popup anywhere in this
codebase** — an earlier version used one, but it was fully replaced by
this panel; see "The sidebar panel" below before reaching for
`maplibregl.Popup` for anything.

It originally forked from **[rewiring-nz/communities-map](https://github.com/rewiring-nz/communities-map)**
— same marker styling, search, and mobile-overlay-sizing groundwork —
but the panel itself (right-side placement, the list/detail swap, the
`.rhm-detail*` content styling) has since diverged into something
specific to this map's richer per-hub data. If you're touching marker
styling or the mobile height-detection mechanism specifically, that
sibling repo's own README/commit history documents the original bugs
and fixes for those shared parts (e.g. why markers must never have
`position` CSS of their own) — worth checking there before re-solving
something already solved. The panel/detail-view architecture below is
NOT shared with that repo, though — don't go looking there for it.

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

**The sidebar panel has exactly two views, never both showing at
once.** `.rhm-sidebar` always contains both `.rhm-sidebar__list` (the
full hub list, a `<ul>`) and `.rhm-sidebar__detail` (one hub's detail
view) in the DOM simultaneously — which one is visible is purely a CSS
toggle, the `.showing-detail` class on `.rhm-sidebar` (see the rules in
map.css right after `.rhm-sidebar__list`). In `renderHubs()`,
`showHubDetail(entry)` fills `layout.detailBody.innerHTML` with that
hub's content and adds the class; `showHubList()` removes it. Every
selection path — marker click, list click, search result, "Find
closest hub" — ultimately calls `showHubDetail`, either directly (marker
click) or via `focusEntry(map, entry, scrollToMap, onSelect)`'s
`onSelect` parameter (the other three, which also fly the camera first).
**If you add a new way to select a hub, wire it through `onSelect`/
`showHubDetail`, not a new ad-hoc code path** — this is what keeps "one
thing selected at a time" actually true. Returning to the list view
happens three ways: the "← All hubs" back button inside the detail
view (`layout.backBtn`, sticky-positioned so it stays visible while the
detail content scrolls), clicking the "Resilience Hubs" title (which
*also* re-fits the map — it doubles as a "home" control), or the "Show
hub list" control (which forces list view even if a detail view was
showing when the panel was last closed).

**The panel sits on the RIGHT on desktop — this is a DOM-order
decision, not a CSS one.** `buildSidebarLayout()` appends the map
container *before* the sidebar (`layout.appendChild(mapContainer);
layout.appendChild(sidebar);`) — since `.rhm-layout` is a plain flex row
with no explicit `order` on either child, flex lays them out in DOM
order, so swapping that append order is the entire mechanism. Don't
"fix" this with `order: -1`/`order: 1` instead if you ever need to
change it back — the DOM-order approach is simpler and was chosen
deliberately. This also means `.rhm-map`'s and `.rhm-sidebar`'s
`border-radius` values are deliberately swapped from what you'd
naively expect (map has the LEFT corners rounded, sidebar has the
RIGHT) — if you ever flip the panel back to the left, flip these back
too, or you'll get square-outer/rounded-inner corners on both.

**Detail view fields are fully generic, not a fixed schema.** `map.js`'s
`rowsToFeatureCollection()` only special-cases `Name`/`Lat`/`Lng`/
`Image1`/`Image2` (see `SPECIAL_FIELDS`) — every other column in the
sheet becomes a field in `properties.fields`, and `hubDetailHTML()` just
iterates `Object.keys(props.fields)` to render one row per column, in
the sheet's own left-to-right order (JS preserves string-key insertion
order, so this "just works" without sorting). **Do not** reintroduce a
hardcoded field list here — the whole point is that the sheet's owner
can add/rename/reorder columns without needing a code change. Each
value's rendering (colored pill for Yes/No/Unknown, clickable link for
a URL or email, plain text otherwise) is decided per-value by
`specRow()`/`linkifyValue()`, not per-column.

**Pill colors are solid fills, not the pale-tint style you'd expect on
a white background.** `.rhm-pill--yes`/`--no`/`--unknown` used to sit
inside a white MapLibre popup bubble and used dark text on a pale
tinted background; now that this content lives directly on the
sidebar's own green (`#527570`) background, that same treatment would
have terrible contrast, so these are solid color fills with white text
instead. If you ever restyle the sidebar to a light background, these
pill colors need revisiting too — they're tuned specifically for
sitting on that green.

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

**Mobile sidebar needs its own stacking context, or the map paints over
it.** On mobile, `.rhm-map` gets `position: relative; z-index: 0` and
`.rhm-sidebar` gets `z-index: 1` — without this, MapLibre's own
internal z-indexed layers (canvas, controls) end up painting *over* the
sidebar despite the sidebar being `position: absolute`, because neither
element had an explicit stacking context to contain that internal
z-index competition. Found by literally checking
`document.elementFromPoint()` at the sidebar's own coordinates and
seeing `<canvas>` come back instead of the sidebar. (This predates the
current panel — originally the concern was a MapLibre Popup instead of
`controls`, back when this codebase still used one. No Popup exists
here anymore, but the same fix is still needed for the canvas itself.)

**`.rhm-sidebar` needs `width: auto` in the mobile media query.** The
desktop rule sets an explicit `width: 340px`; the mobile rule tries to
stretch it full-width via `left: 0; right: 0`, but with an explicit
width already set, `left`+`right`+`width` together over-constrain the
box, and the browser keeps the explicit width rather than stretching —
silently, no console warning. `width: auto` releases that constraint.

**No MapLibre Popup is used anywhere in this codebase — don't
reintroduce one without good reason.** An earlier version opened a
`maplibregl.Popup` on marker click, with `focusAfterOpen: false` to
avoid a page-jank-scroll bug (MapLibre's default auto-focuses a
popup's first link on open, which — combined with `flyTo()` running at
the same time — could scroll the whole host page to a stale position;
same root cause as the sibling communities-map repo hit). That entire
approach was replaced by the sidebar panel described above, which
doesn't have this failure mode at all (the panel's own position never
depends on marker screen coordinates, so there's nothing for a stale
position to desync from). If a future change reintroduces any kind of
floating popup/tooltip tied to marker position, re-read the
communities-map repo's notes on this bug first — it's easy to
reintroduce by accident.

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
  - This is exactly what happened when the sidebar panel (list/detail
    toggle, right-side placement) was built: desktop was thoroughly
    click-tested (every selection path, back button, title-click, close/
    reopen) and confirmed correct, but mobile hit this flakiness across
    several full resets and was never visually re-confirmed after that
    change. The mobile CSS positioning itself (bottom overlay,
    `is-hidden` collapse, stacking context) was NOT changed by that
    work — only new children (`.rhm-sidebar__detail`, `.rhm-sidebar__back`)
    were added inside the already-proven `.rhm-sidebar` — so this is a
    reasonable but not iron-clad inference, not an actual observed pass.
    If you're touching mobile panel behavior, treat that combination as
    genuinely unverified and check it properly rather than assuming it
    from this note.

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
