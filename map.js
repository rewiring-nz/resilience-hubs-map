/* Community Resilience Hubs Map — MapLibre GL init
   Reads hub data from a published Google Sheet (as CSV) at load time,
   then plots markers. Selecting a hub (marker, list entry, or search)
   opens its details in a slide-out dashboard panel — on the right of
   the map on desktop, docked to the bottom on mobile — rather than in a
   map popup. Safe to inline into a Webflow Embed alongside map.css.
   See README.md for how the sheet needs to be set up. */

(function () {
  // Centered on Queenstown Lakes district — where every hub in the
  // sheet currently is — so the map opens already zoomed in there
  // instead of flashing the whole country before fitToHubs() (which
  // runs once the sheet data has loaded) narrows it down. If hubs
  // outside this district get added later, fitToHubs() still adjusts
  // to fit all of them; this only sets the very first paint.
  var INITIAL_CENTER = [168.75, -44.85];
  var INITIAL_ZOOM = 9;

  // ---- Google Sheet CSV loading + parsing ------------------------------
  // The sheet is fetched fresh on every page load (not real-time push),
  // so edits made by anyone with edit access to the sheet show up the
  // next time someone loads or refreshes the page — no rebuild/republish
  // needed on this end. See README.md for the "Publish to web" setup
  // that makes the CSV URL below work without any API key or auth.

  function fetchSheetRows(csvUrl) {
    return fetch(csvUrl)
      .then(function (res) {
        if (!res.ok) throw new Error("Sheet fetch failed (" + res.status + ")");
        return res.text();
      })
      .then(parseCSV)
      .then(rowsToObjects);
  }

  // Hand-rolled rather than a naive split(",") because real sheet data
  // has commas inside quoted fields (e.g. a "Lights, outlets" value in
  // the Backup circuits column) — a naive split would shred that into
  // extra columns and misalign every field after it.
  function parseCSV(text) {
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;

    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') {
          field += '"';
          i++;
        } else if (c === '"') {
          inQuotes = false;
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (c !== "\r") {
        field += c;
      }
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  // First row is headers. Trimmed on the way in so a column named
  // "Image1 " (trailing space — easy to introduce by accident in a
  // shared sheet) still matches "Image1" everywhere else in this file.
  function rowsToObjects(rows) {
    if (!rows.length) return [];
    var headers = rows[0].map(function (h) {
      return h.trim();
    });
    return rows.slice(1).map(function (r) {
      var obj = {};
      headers.forEach(function (h, i) {
        obj[h] = (r[i] || "").trim();
      });
      return obj;
    });
  }

  // Columns handled specially elsewhere in the detail card (title,
  // marker position, header photo) rather than as a generic field row —
  // every other column in the sheet, whatever it's called, shows up in
  // the card automatically. This is what lets you add/rename/remove a
  // column in the sheet without ever touching this file: cardHTML()
  // below just iterates whatever's left in `fields`, in the sheet's own
  // column order.
  var SPECIAL_FIELDS = { Name: true, Lat: true, Lng: true, Image1: true, Image2: true };

  function rowsToFeatureCollection(rowObjects) {
    var features = [];
    rowObjects.forEach(function (o) {
      var lat = parseFloat(o.Lat);
      var lng = parseFloat(o.Lng);
      if (Number.isNaN(lat) || Number.isNaN(lng)) return;

      var fields = {};
      Object.keys(o).forEach(function (key) {
        if (!SPECIAL_FIELDS[key]) fields[key] = o[key];
      });

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: {
          name: o.Name || "Resilience Hub",
          image1: o.Image1 || "",
          image2: o.Image2 || "",
          fields: fields
        }
      });
    });
    return { type: "FeatureCollection", features: features };
  }

  function escapeHTML(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  // Strips macrons/diacritics so a plain-ASCII search ("wanaka") still
  // matches names that use them ("Wānaka") — common in NZ place names.
  var DIACRITIC_MARKS = new RegExp(
    "[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]",
    "g"
  );

  function normalizeText(str) {
    return (str || "")
      .normalize("NFD")
      .replace(DIACRITIC_MARKS, "")
      .toLowerCase();
  }

  // ---- Detail card content ----------------------------------------------

  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // A column's value becomes a clickable link automatically if it looks
  // like one — no per-column configuration needed, so a "Website" or
  // "Brochure" column (or any future column with a URL/email in it)
  // just works. Link text stays short ("Open ↗") since the column
  // LABEL already says what it links to; a raw URL would often be
  // longer than the whole panel is wide.
  function linkifyValue(v) {
    if (/^https?:\/\//i.test(v)) {
      return (
        '<a class="rhm-card__spec-link" href="' + escapeHTML(v) +
        '" target="_blank" rel="noopener noreferrer">Open ↗</a>'
      );
    }
    if (EMAIL_PATTERN.test(v)) {
      return '<a class="rhm-card__spec-link" href="mailto:' + escapeHTML(v) + '">' + escapeHTML(v) + "</a>";
    }
    return null;
  }

  // One row per non-empty column. Yes/No/Unknown values become a
  // colored pill (as before); a URL or email becomes a clickable link;
  // everything else is shown as plain text.
  function specRow(label, rawValue) {
    var v = (rawValue || "").trim();
    if (!v) return "";
    var lower = v.toLowerCase();
    var pillClass =
      lower === "yes" ? " rhm-pill--yes" :
      lower === "no" ? " rhm-pill--no" :
      lower === "unknown" ? " rhm-pill--unknown" : "";

    var valueHTML;
    if (pillClass) {
      valueHTML = '<span class="rhm-pill' + pillClass + '">' + escapeHTML(v) + "</span>";
    } else {
      valueHTML = linkifyValue(v) || ('<span class="rhm-card__spec-value">' + escapeHTML(v) + "</span>");
    }

    return (
      '<div class="rhm-card__spec-row">' +
      '<span class="rhm-card__spec-label">' + escapeHTML(label) + "</span>" +
      valueHTML +
      "</div>"
    );
  }

  // Rendered into the detail panel's scrolling body (.rhm-detail__body),
  // which is what scrolls when a hub has more fields than fit — the spec
  // list itself deliberately has no internal scroll area of its own, so
  // the whole card reads as one continuous document.
  function cardHTML(props) {
    var photo = props.image1
      ? '<img class="rhm-card__photo" src="' + escapeHTML(props.image1) + '" alt="">'
      : "";

    var specs = "";
    Object.keys(props.fields).forEach(function (key) {
      specs += specRow(key, props.fields[key]);
    });

    return (
      '<div class="rhm-card">' +
      photo +
      '<h3 class="rhm-card__title">' + escapeHTML(props.name) + "</h3>" +
      (specs ? '<div class="rhm-card__specs">' + specs + "</div>" : "") +
      "</div>"
    );
  }

  function createMarkerEl(name) {
    var el = document.createElement("div");
    el.className = "rhm-marker";
    // el (.rhm-marker) is the element MapLibre owns and positions — it
    // must carry NO styling of our own at all, not even `position`.
    // MapLibre's own stylesheet sets `.maplibregl-marker { position:
    // absolute }` on this same element; a `position` rule of ours on
    // the same selector would silently win or lose depending on
    // cascade order, and if it wins, the marker stops being absolutely
    // positioned and MapLibre's centering math throws it far off to one
    // side. All real styling/position lives on the inner wrapper.
    el.innerHTML =
      '<div class="rhm-marker__inner">' +
      '<svg class="rhm-marker__pin" width="28" height="38" viewBox="0 0 28 38" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 24 14 24s14-13.5 14-24C28 6.268 21.732 0 14 0z" fill="#ffc93c" stroke="#33484a" stroke-width="2"/>' +
      '<circle cx="14" cy="14" r="5" fill="#33484a"/>' +
      "</svg>" +
      '<span class="rhm-marker__label">' + escapeHTML(name) + "</span>" +
      "</div>";
    return el;
  }

  // Moves the camera to an entry's marker and opens its detail panel.
  // Shared by the marker clicks, the search box and the sidebar list so
  // all three behave identically.
  //
  // scrollToMap is true for the sidebar list, where on mobile the list
  // sits below/over the map and selecting an item should bring the map
  // back into view. zoomIn is for jumps from the list, search or "find
  // closest", where the hub may be off-screen entirely; a marker click
  // leaves the zoom alone, since the visitor is already looking right at
  // the marker and the camera only needs nudging clear of the panel
  // that's about to open over it.
  function focusEntry(map, entry, scrollToMap, zoomIn) {
    var camera = {
      center: entry.feature.geometry.coordinates,
      // On mobile the detail panel docks over the bottom of the map, so
      // aim above the container's center — otherwise the hub just
      // selected ends up behind the panel showing its details.
      offset: isMobileViewport()
        ? [0, -Math.round(map.getContainer().clientHeight * 0.2)]
        : [0, 0]
    };

    if (zoomIn) {
      camera.zoom = Math.max(map.getZoom(), 12);
      map.flyTo(camera);
    } else {
      map.easeTo(camera);
    }

    entry.select();
    if (scrollToMap) {
      map.getContainer().scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  // Single source of truth for "are we in the mobile layout" — must stay
  // in step with the `max-width: 767px` media query in map.css, which is
  // what actually docks both panels to the bottom edge.
  function isMobileViewport() {
    return window.matchMedia("(max-width: 767px)").matches;
  }

  // ---- Name-label collision handling -------------------------------
  // Plain HTML markers don't get MapLibre's built-in label-collision
  // avoidance for free, so this reimplements the same idea directly: on
  // every pan/zoom, greedily show each label (in feature order) unless
  // it would overlap an already-shown label or another pin.

  function rectsOverlap(a, b) {
    return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
  }

  function updateLabelVisibility(entries) {
    var pinRects = entries.map(function (e) {
      return e.pinEl.getBoundingClientRect();
    });
    var acceptedRects = [];

    entries.forEach(function (entry, i) {
      var rect = entry.labelEl.getBoundingClientRect();

      var overlapsPin = pinRects.some(function (pinRect, j) {
        return j !== i && rectsOverlap(rect, pinRect);
      });
      var overlapsLabel = !overlapsPin && acceptedRects.some(function (r) {
        return rectsOverlap(rect, r);
      });

      if (!overlapsPin && !overlapsLabel) {
        entry.labelEl.style.visibility = "visible";
        acceptedRects.push(rect);
      } else {
        entry.labelEl.style.visibility = "hidden";
      }
    });
  }

  function watchLabelCollisions(map, entries) {
    var pending = null;
    function schedule() {
      if (pending) return;
      pending = requestAnimationFrame(function () {
        pending = null;
        updateLabelVisibility(entries);
      });
    }
    map.on("move", schedule);
    map.on("zoom", schedule);
    schedule();
  }

  // ---- Search control -------------------------------------------------

  function createSearchControl(map, entries) {
    var container = document.createElement("div");
    container.className = "maplibregl-ctrl rhm-search";

    var input = document.createElement("input");
    input.type = "text";
    input.className = "rhm-search__input";
    input.placeholder = "Search hubs…";
    input.setAttribute("aria-label", "Search resilience hubs");

    var results = document.createElement("div");
    results.className = "rhm-search__results";

    container.appendChild(input);
    container.appendChild(results);

    function clearResults() {
      results.innerHTML = "";
      results.style.display = "none";
    }

    function selectEntry(entry) {
      focusEntry(map, entry, false, true);
      input.value = entry.feature.properties.name;
      clearResults();
      input.blur();
    }

    input.addEventListener("input", function () {
      var query = normalizeText(input.value.trim());
      if (!query) {
        clearResults();
        return;
      }

      var matches = entries
        .filter(function (entry) {
          return entry.searchText.indexOf(query) !== -1;
        })
        .slice(0, 8);

      if (!matches.length) {
        clearResults();
        return;
      }

      results.innerHTML = "";
      matches.forEach(function (entry) {
        var props = entry.feature.properties;
        var item = document.createElement("button");
        item.type = "button";
        item.className = "rhm-search__result";
        item.innerHTML =
          '<span class="rhm-search__result-name">' + escapeHTML(props.name) + "</span>";
        item.addEventListener("click", function () {
          selectEntry(entry);
        });
        results.appendChild(item);
      });
      results.style.display = "block";
    });

    input.addEventListener("keydown", function (evt) {
      if (evt.key === "Enter") {
        var first = results.querySelector(".rhm-search__result");
        if (first) first.click();
      } else if (evt.key === "Escape") {
        clearResults();
        input.blur();
      }
    });

    document.addEventListener("click", function (evt) {
      if (!container.contains(evt.target)) clearResults();
    });

    return {
      onAdd: function () {
        return container;
      },
      onRemove: function () {
        if (container.parentNode) container.parentNode.removeChild(container);
      }
    };
  }

  // ---- "Find closest hub" control ---------------------------------------

  function toRadians(deg) {
    return (deg * Math.PI) / 180;
  }

  // Great-circle distance in km. Plenty accurate for comparing hubs
  // within one region — no need for anything more precise than
  // treating the Earth as a sphere at this scale.
  function haversineKm(lat1, lng1, lat2, lng2) {
    var R = 6371;
    var dLat = toRadians(lat2 - lat1);
    var dLng = toRadians(lng2 - lng1);
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function closestEntry(entries, lat, lng) {
    var best = null;
    var bestDist = Infinity;
    entries.forEach(function (entry) {
      var coords = entry.feature.geometry.coordinates; // [lng, lat]
      var d = haversineKm(lat, lng, coords[1], coords[0]);
      if (d < bestDist) {
        bestDist = d;
        best = entry;
      }
    });
    return best;
  }

  // Stacks directly under the search box (added right after it, same
  // "top-left" corner). Only rendered at all if the browser actually
  // supports geolocation (see the call site) — no point offering a
  // button that can only ever fail.
  function createFindClosestControl(map, entries) {
    var container = document.createElement("div");
    container.className = "maplibregl-ctrl rhm-find-closest";

    var button = document.createElement("button");
    button.type = "button";
    button.className = "rhm-find-closest__button";
    var defaultLabel = "Find closest hub";
    button.textContent = defaultLabel;

    button.addEventListener("click", function () {
      if (!entries.length) return;
      button.disabled = true;
      button.textContent = "Locating…";

      navigator.geolocation.getCurrentPosition(
        function (pos) {
          button.disabled = false;
          button.textContent = defaultLabel;
          var closest = closestEntry(entries, pos.coords.latitude, pos.coords.longitude);
          if (closest) focusEntry(map, closest, false, true);
        },
        function (err) {
          button.disabled = false;
          button.textContent = err.code === err.PERMISSION_DENIED ? "Location permission denied" : "Location unavailable";
          setTimeout(function () {
            button.textContent = defaultLabel;
          }, 3000);
        },
        // High accuracy (GPS lock) isn't needed just to tell which hub
        // is nearest — hubs are km apart — and skipping it means a
        // faster (network/wifi-based) response instead of waiting on
        // GPS. maximumAge lets a second click reuse a recent fix
        // instead of re-prompting the device hardware every time.
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
      );
    });

    container.appendChild(button);

    return {
      onAdd: function () {
        return container;
      },
      onRemove: function () {
        if (container.parentNode) container.parentNode.removeChild(container);
      }
    };
  }

  // ---- Layout: hub list + detail panel ----------------------------------
  // Wraps the map container in a layout with two panels: the collapsible
  // hub list before it (left of the map on desktop) and the slide-out
  // detail dashboard after it (right of the map on desktop). On mobile
  // both are overlaid on the map's bottom edge instead, via CSS — see
  // map.css. Restructures the DOM itself so the Webflow embed only ever
  // needs the one plain map <div>.

  function buildSidebarLayout(mapContainer) {
    var layout = document.createElement("div");
    layout.className = "rhm-layout";

    var sidebar = document.createElement("div");
    sidebar.className = "rhm-sidebar";

    var header = document.createElement("div");
    header.className = "rhm-sidebar__header";

    var title = document.createElement("span");
    title.className = "rhm-sidebar__title";
    title.textContent = "Resilience Hubs";

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "rhm-sidebar__close";
    closeBtn.setAttribute("aria-label", "Hide hub list");
    closeBtn.innerHTML = "✕";

    header.appendChild(title);
    header.appendChild(closeBtn);

    var list = document.createElement("ul");
    list.className = "rhm-sidebar__list";

    sidebar.appendChild(header);
    sidebar.appendChild(list);

    // Detail panel. Its inner .rhm-detail__panel carries the fixed width
    // so that collapsing the outer element to `width: 0` slides the
    // whole panel out of view without reflowing its text on every frame
    // of the transition.
    var detail = document.createElement("aside");
    detail.className = "rhm-detail is-hidden";
    detail.setAttribute("aria-label", "Selected hub details");

    var detailPanel = document.createElement("div");
    detailPanel.className = "rhm-detail__panel";

    var detailHeader = document.createElement("div");
    detailHeader.className = "rhm-detail__header";

    // Shown on mobile only (where the list and this panel share the same
    // bottom-docked space, so one has to give way to the other) — it
    // swaps back to the full hub list. On desktop both panels are
    // visible at once, so there's nothing to swap back to and CSS hides
    // this in favor of the static eyebrow label.
    var detailBack = document.createElement("button");
    detailBack.type = "button";
    detailBack.className = "rhm-detail__back";
    detailBack.innerHTML = "‹ All hubs";

    var detailEyebrow = document.createElement("span");
    detailEyebrow.className = "rhm-detail__eyebrow";
    detailEyebrow.textContent = "Hub details";

    var detailClose = document.createElement("button");
    detailClose.type = "button";
    detailClose.className = "rhm-detail__close";
    detailClose.setAttribute("aria-label", "Close hub details");
    detailClose.innerHTML = "✕";

    var detailBody = document.createElement("div");
    detailBody.className = "rhm-detail__body";

    detailHeader.appendChild(detailBack);
    detailHeader.appendChild(detailEyebrow);
    detailHeader.appendChild(detailClose);
    detailPanel.appendChild(detailHeader);
    detailPanel.appendChild(detailBody);
    detail.appendChild(detailPanel);

    mapContainer.parentNode.insertBefore(layout, mapContainer);
    layout.appendChild(sidebar);
    layout.appendChild(mapContainer);
    layout.appendChild(detail);

    return {
      root: layout,
      sidebar: sidebar,
      title: title,
      closeBtn: closeBtn,
      list: list,
      detail: detail,
      detailBody: detailBody,
      detailBack: detailBack,
      detailClose: detailClose
    };
  }

  // A plain button, added as a map control (stacks under the search box
  // in the "top-left" corner automatically since both are added there).
  // Only visible while the sidebar is hidden.
  function createShowListControl(onClick) {
    var container = document.createElement("div");
    container.className = "maplibregl-ctrl rhm-show-list";

    var button = document.createElement("button");
    button.type = "button";
    button.className = "rhm-show-list__button";
    button.textContent = "Show hub list";
    button.addEventListener("click", onClick);

    container.appendChild(button);

    return {
      onAdd: function () {
        return container;
      },
      onRemove: function () {
        if (container.parentNode) container.parentNode.removeChild(container);
      },
      element: container
    };
  }

  // Keeps the map canvas in sync while a panel's width/max-height
  // CSS-transitions open or closed — map.resize() only reads the
  // container's CURRENT size, so it has to be called repeatedly across
  // the transition, not just once at the end.
  function animateMapResize(map, durationMs) {
    var start = performance.now();
    function tick(now) {
      map.resize();
      if (now - start < durationMs) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // Looks a few levels up from .rhm-layout for the nearest ancestor with
  // an explicit `max-height` (e.g. a div you've wrapped this embed in,
  // with `max-height: 70vh; overflow: hidden`) — that's what .rhm-layout
  // should fill on mobile, where the map needs to fill that whole
  // element rather than sharing it with the list.
  //
  // Only `max-height` is usable here, not `height`: getComputedStyle()
  // always returns a resolved pixel number for `height`, even when the
  // developer never set one — for an unstyled element that's just
  // auto-sized to fit its content (e.g. Webflow's own Embed wrapper div),
  // that number is simply whatever it rendered at, indistinguishable
  // from a real constraint. `max-height` doesn't have that ambiguity —
  // it computes to the literal keyword `"none"` when unset.
  function findWrapperMaxHeightPx(startEl, maxLevels) {
    var node = startEl.parentElement;
    var found = null;
    for (var i = 0; i < maxLevels && node && node !== document.documentElement; i++) {
      var px = parseFloat(window.getComputedStyle(node).maxHeight);
      if (!isNaN(px) && px > 40 && (found === null || px < found)) found = px;
      node = node.parentElement;
    }
    return found;
  }

  function syncLayoutHeight(layout) {
    var px = findWrapperMaxHeightPx(layout, 6);
    layout.style.height = px ? px + "px" : "";
  }

  // ---- Status overlay ---------------------------------------------------
  // Shown in place of the map briefly if the sheet fails to load or has
  // no usable rows yet — e.g. right after the sheet's been created but
  // before anyone's filled in a Lat/Lng.

  function showStatus(container, message) {
    var el = document.createElement("div");
    el.className = "rhm-status";
    el.textContent = message;
    container.appendChild(el);
    return el;
  }

  function initResilienceHubsMap(options) {
    var opts = Object.assign(
      {
        containerId: "resilience-hubs-map",
        // The published-to-web CSV export URL for your Google Sheet.
        // See README.md for how to get this from File > Share >
        // Publish to web in Google Sheets.
        sheetCsvUrl: "",
        // Set true to require holding Ctrl/⌘ to scroll-zoom, so
        // scrolling the page past the map doesn't hijack the scroll.
        // Off by default — plain scroll-to-zoom.
        cooperativeGestures: false,
        // Whether the hub list sidebar starts open, on desktop
        // (`>=768px`). Set false to start with it hidden and only the
        // "Show hub list" button visible.
        showListByDefault: true,
        // Same, but for mobile (`<768px`) specifically — kept separate
        // from showListByDefault because an open-by-default list makes
        // sense on desktop (plenty of room beside the map) but eats the
        // whole map on a phone screen the moment the page loads.
        showListByDefaultOnMobile: false
      },
      options || {}
    );

    var container = document.getElementById(opts.containerId);
    if (!container || typeof maplibregl === "undefined") return null;
    if (!opts.sheetCsvUrl) {
      showStatus(container, "No sheetCsvUrl configured — see README.md.");
      return null;
    }

    var layout = buildSidebarLayout(container);
    syncLayoutHeight(layout.root);

    var map = new maplibregl.Map({
      container: opts.containerId,
      style: {
        version: 8,
        sources: {
          satellite: {
            type: "raster",
            tiles: [
              "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            ],
            tileSize: 256,
            attribution: "Imagery © Esri, Maxar, Earthstar Geographics"
          },
          labels: {
            type: "raster",
            tiles: [
              "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
            ],
            tileSize: 256
          }
        },
        layers: [
          { id: "satellite", type: "raster", source: "satellite" },
          { id: "labels", type: "raster", source: "labels", paint: { "raster-opacity": 0.9 } }
        ]
      },
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      minZoom: 3,
      maxZoom: 18,
      // Scrolling the page past the map won't zoom it — scroll-zoom only
      // activates while holding Ctrl/⌘. Override via cooperativeGestures.
      cooperativeGestures: opts.cooperativeGestures
    });

    // Re-detect the wrapper height on resize (a vh-based wrapper moves
    // with the viewport) and keep the map's own canvas in sync with it.
    window.addEventListener("resize", function () {
      syncLayoutHeight(layout.root);
      map.resize();
    });

    map.on("load", function () {
      fetchSheetRows(opts.sheetCsvUrl)
        .then(function (rowObjects) {
          var geojson = rowsToFeatureCollection(rowObjects);
          if (!geojson.features.length) {
            showStatus(container, "No resilience hubs with a Lat/Lng yet.");
            return;
          }
          renderHubs(map, container, layout, geojson, opts);
        })
        .catch(function (err) {
          console.error("Resilience hubs map: failed to load sheet data —", err);
          showStatus(container, "Couldn't load hub data. Check the sheet is published to web.");
        });
    });

    return map;
  }

  // Everything that depends on the loaded data — markers, the detail
  // panel, the sidebar list, search, and the map fitting itself to the
  // hubs it got.
  function renderHubs(map, container, layout, geojson, opts) {
    // ---- Panel state ---------------------------------------------------
    // Two panels share the layout: the hub list and the detail dashboard
    // for whichever hub is selected. On desktop they sit on opposite
    // sides of the map and are independent. On mobile they dock to the
    // same bottom edge and only one can show at a time, so selecting a
    // hub swaps the list out for that hub's details and deselecting
    // swaps the list back — hence deriving both panels' visibility from
    // this one pair of state values in syncPanels() rather than toggling
    // each panel's class at its own call sites.
    //
    // listWanted is read from the options once, at init, rather than
    // being kept in sync with the viewport: it's about what a visitor
    // sees on first paint for the device they're on, not a layout rule
    // that should flip the list open or closed mid-session just because
    // they resized the window.
    var listWanted = isMobileViewport()
      ? opts.showListByDefaultOnMobile
      : opts.showListByDefault;
    var activeEntry = null;
    var showListControl = null; // created further down; see syncPanels

    var activeListItem = null;
    function setActiveListItem(el) {
      if (activeListItem) activeListItem.classList.remove("rhm-sidebar__item--active");
      if (el) el.classList.add("rhm-sidebar__item--active");
      activeListItem = el;
    }

    var activeMarkerInner = null;
    function setActiveMarker(entry) {
      if (activeMarkerInner) activeMarkerInner.classList.remove("rhm-marker__inner--active");
      activeMarkerInner = entry ? entry.innerEl : null;
      if (activeMarkerInner) activeMarkerInner.classList.add("rhm-marker__inner--active");
    }

    function syncPanels(animate) {
      var mobile = isMobileViewport();
      var listVisible = listWanted && !(mobile && activeEntry);

      layout.sidebar.classList.toggle("is-hidden", !listVisible);
      layout.detail.classList.toggle("is-hidden", !activeEntry);
      // Squares off the map's right-hand corners while the detail panel
      // is butted up against them.
      layout.root.classList.toggle("rhm-layout--detail", !!activeEntry);

      // While the detail panel occupies the mobile sheet, "Show hub
      // list" would have nowhere to show the list — the panel's own
      // "‹ All hubs" back button is the way back in that state.
      if (showListControl) {
        showListControl.element.style.display =
          listVisible || (mobile && activeEntry) ? "none" : "";
      }

      if (animate) animateMapResize(map, 300);
    }

    // Only one hub is ever selected — selecting a new one replaces the
    // detail panel's contents and moves the list highlight, regardless
    // of how it was selected (marker click, search, or the list).
    function selectEntry(entry) {
      activeEntry = entry;
      layout.detailBody.innerHTML = cardHTML(entry.feature.properties);
      layout.detailBody.scrollTop = 0;
      setActiveListItem(entry.listItemEl);
      setActiveMarker(entry);
      syncPanels(true);
    }

    // showList is true for the mobile "‹ All hubs" back button, which
    // should always land on the list; false for the ✕ and for clicking
    // the map itself, which dismiss the panel back to whatever the list
    // was doing before.
    function clearSelection(showList) {
      activeEntry = null;
      setActiveListItem(null);
      setActiveMarker(null);
      if (showList) listWanted = true;
      syncPanels(true);
    }

    var entries = geojson.features.map(function (feature) {
      var entry = { feature: feature };
      entry.select = function () {
        selectEntry(entry);
      };

      var el = createMarkerEl(feature.properties.name);
      var marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat(feature.geometry.coordinates)
        .addTo(map);

      // Attached to the marker element itself rather than going through
      // MapLibre's own marker/popup binding — there's no popup involved
      // anymore, and that binding never fired reliably across MapLibre
      // versions anyway. stopPropagation keeps this click from also
      // reaching the map's own click handler, which deselects.
      el.addEventListener("click", function (evt) {
        evt.stopPropagation();
        if (activeEntry === entry) clearSelection(false);
        else focusEntry(map, entry, false, false);
      });

      var listItemButton = document.createElement("button");
      listItemButton.type = "button";
      listItemButton.className = "rhm-sidebar__item";
      listItemButton.innerHTML =
        '<span class="rhm-sidebar__item-name">' + escapeHTML(feature.properties.name) + "</span>";
      listItemButton.addEventListener("click", function () {
        focusEntry(map, entry, true, true);
      });
      var listItem = document.createElement("li");
      listItem.appendChild(listItemButton);
      layout.list.appendChild(listItem);

      entry.marker = marker;
      entry.innerEl = el.querySelector(".rhm-marker__inner");
      entry.pinEl = el.querySelector(".rhm-marker__pin");
      entry.labelEl = el.querySelector(".rhm-marker__label");
      entry.listItemEl = listItemButton;
      entry.searchText = normalizeText(feature.properties.name);

      return entry;
    });

    // Zooms/pans back out to fit every hub — animated since this one's a
    // deliberate user action (title click), unlike the instant initial fit.
    layout.title.addEventListener("click", function () {
      fitToHubs({ duration: 1000 });
    });

    watchLabelCollisions(map, entries);
    map.addControl(createSearchControl(map, entries), "top-left");

    // Added right after the search control so it stacks directly below
    // it. Skipped entirely if the browser has no Geolocation API at
    // all (very old browsers, or a non-secure/non-localhost origin) —
    // no point offering a button that can only ever fail.
    if (navigator.geolocation) {
      map.addControl(createFindClosestControl(map, entries), "top-left");
    }

    // Added after those so it stacks below them in the top-left corner.
    // Only shown while the hub list is hidden (see syncPanels).
    showListControl = createShowListControl(function () {
      listWanted = true;
      syncPanels(true);
    });
    map.addControl(showListControl, "top-left");

    layout.closeBtn.addEventListener("click", function () {
      listWanted = false;
      syncPanels(true);
    });

    // ✕ dismisses the detail panel entirely; "‹ All hubs" (mobile) hands
    // the bottom sheet back to the list instead.
    layout.detailClose.addEventListener("click", function () {
      clearSelection(false);
    });
    layout.detailBack.addEventListener("click", function () {
      clearSelection(true);
    });

    // Clicking bare map deselects, the way clicking off a popup used to
    // close it. Marker clicks stopPropagation (see above), so this only
    // fires for clicks that missed every hub — and MapLibre doesn't emit
    // `click` at the end of a drag, so panning the map won't deselect.
    map.on("click", function () {
      if (activeEntry) clearSelection(false);
    });

    document.addEventListener("keydown", function (evt) {
      if (evt.key === "Escape" && activeEntry) clearSelection(false);
    });

    // Crossing the desktop/mobile breakpoint changes whether the list
    // and the detail panel can be shown at the same time, so re-derive
    // both from the current state (without animating — nothing was
    // deliberately opened or closed here).
    window.addEventListener("resize", function () {
      syncPanels(false);
      // The class changes above can hand width back to the map (a panel
      // that was beside it on desktop becomes an overlay on mobile), so
      // the canvas needs re-measuring after them, not just from the
      // resize handler in initResilienceHubsMap that ran before this.
      map.resize();
    });

    // Starting state, applied without animation.
    syncPanels(false);

    function fitToHubs(fitOptions) {
      if (geojson.features.length <= 1) return;
      var first = geojson.features[0].geometry.coordinates;
      var bounds = geojson.features.reduce(function (b, f) {
        return b.extend(f.geometry.coordinates);
      }, new maplibregl.LngLatBounds(first, first));
      map.fitBounds(
        bounds,
        Object.assign({ padding: 60, maxZoom: 13, duration: 0 }, fitOptions || {})
      );
    }

    fitToHubs();

    // On a CMS/embed page, the container isn't always at its final size
    // the instant this fires — page-load animations, web fonts, and
    // images above the map can still shift layout. Re-sync once if the
    // container's real size changes shortly after load.
    if (typeof ResizeObserver !== "undefined") {
      var ro = new ResizeObserver(function () {
        map.resize();
        fitToHubs();
      });
      ro.observe(container);
      setTimeout(function () {
        ro.disconnect();
      }, 3000);
    }
  }

  window.initResilienceHubsMap = initResilienceHubsMap;
})();
