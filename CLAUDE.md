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
        cooperativeGestures: true,
        showListByDefault: true
      });
    })();
  </script>
  ```

  i.e. the IIFE closes around a **direct call** to
  `initResilienceHubsMap(...)` instead of exporting it to `window` (map.js's
  own last line, `window.initResilienceHubsMap = initResilienceHubsMap;`,
  gets replaced by this call — that's why the pipeline strips it).

  After regenerating, sanity-check: `grep -c "window.initResilienceHubsMap"
  webflow-embed.html` should be **0** (confirms the export line got
  replaced, not duplicated), and diff the CSS/JS section boundaries
  look right (`grep -n "^</style>$\|^<script>$\|^</script>$"`).

## Non-obvious design decisions

**Popup fields are fully generic, not a fixed schema.** `map.js`'s
`rowsToFeatureCollection()` only special-cases `Name`/`Lat`/`Lng`/
`Image1`/`Image2` (see `SPECIAL_FIELDS`) — every other column in the
sheet becomes a field in `properties.fields`, and `popupHTML()` just
iterates `Object.keys(props.fields)` to render one row per column, in
the sheet's own left-to-right order (JS preserves string-key insertion
order, so this "just works" without sorting). **Do not** reintroduce a
hardcoded field list here — the whole point is that the sheet's owner
can add/rename/reorder columns without needing a code change. Each
value's rendering (colored pill for Yes/No/Unknown, clickable link for
a URL or email, plain text otherwise) is decided per-value by
`specRow()`/`linkifyValue()`, not per-column.

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
internal z-indexed layers (canvas, controls, popups) end up painting
*over* the sidebar despite the sidebar being `position: absolute`,
because neither element had an explicit stacking context to contain
that internal z-index competition. Found by literally checking
`document.elementFromPoint()` at the sidebar's own coordinates and
seeing `<canvas>` come back instead of the sidebar.

**`.rhm-sidebar` needs `width: auto` in the mobile media query.** The
desktop rule sets an explicit `width: 240px`; the mobile rule tries to
stretch it full-width via `left: 0; right: 0`, but with an explicit
width already set, `left`+`right`+`width` together over-constrain the
box, and the browser keeps the explicit width rather than stretching —
silently, no console warning. `width: auto` releases that constraint.

**Popups use `focusAfterOpen: false`.** MapLibre's default auto-focuses
a popup's first link on open, which triggers the browser's native
focus-scroll — combined with `flyTo()` running at the same time (popup
opens before the camera finishes moving), this can jank-scroll the
whole host page. Same root cause and fix as the sibling communities-map
repo.

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
