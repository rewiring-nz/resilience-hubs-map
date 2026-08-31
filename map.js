/* Community Resilience Hubs Map — MapLibre GL init
   Reads hub data from a published Google Sheet (as CSV) at load time,
   then plots markers with click-to-open popups showing each hub's
   resilience specs. Safe to inline into a Webflow Embed alongside
   map.css. See README.md for how the sheet needs to be set up. */

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

  // Columns handled specially elsewhere in the popup (title, marker
  // position, header photo) rather than as a generic field row — every
  // other column in the sheet, whatever it's called, shows up in the
  // popup automatically. This is what lets you add/rename/remove a
  // column in the sheet without ever touching this file: popupHTML()
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

  // ---- Popup content ----------------------------------------------------

  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // A column's value becomes a clickable link automatically if it looks
  // like one — no per-column configuration needed, so a "Website" or
  // "Brochure" column (or any future column with a URL/email in it)
  // just works. Link text stays short ("Open ↗") since the column
  // LABEL already says what it links to; a raw URL would often be
  // longer than the whole popup is wide.
  function linkifyValue(v) {
    if (/^https?:\/\//i.test(v)) {
      return (
        '<a class="rhm-popup__spec-link" href="' + escapeHTML(v) +
        '" target="_blank" rel="noopener noreferrer">Open ↗</a>'
      );
    }
    if (EMAIL_PATTERN.test(v)) {
      return '<a class="rhm-popup__spec-link" href="mailto:' + escapeHTML(v) + '">' + escapeHTML(v) + "</a>";
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
      valueHTML = linkifyValue(v) || ('<span class="rhm-popup__spec-value">' + escapeHTML(v) + "</span>");
    }

    return (
      '<div class="rhm-popup__spec-row">' +
      '<span class="rhm-popup__spec-label">' + escapeHTML(label) + "</span>" +
      valueHTML +
      "</div>"
    );
  }

  function popupHTML(props) {
    var photo = props.image1
      ? '<img class="rhm-popup__photo" src="' + escapeHTML(props.image1) + '" alt="">'
      : "";

    var specs = "";
    Object.keys(props.fields).forEach(function (key) {
      specs += specRow(key, props.fields[key]);
    });

    return (
      '<div class="rhm-popup">' +
      photo +
      '<h3 class="rhm-popup__title">' + escapeHTML(props.name) + "</h3>" +
      (specs ? '<div class="rhm-popup__specs">' + specs + "</div>" : "") +
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

  // Flies to an entry's marker and opens its popup. Shared by the search
  // box and the sidebar list so both behave identically. scrollToMap is
  // true for the sidebar list, where on mobile the list sits below/over
  // the map and selecting an item should bring the map back into view.
  function focusEntry(map, entry, scrollToMap) {
    map.flyTo({
      center: entry.feature.geometry.coordinates,
      zoom: Math.max(map.getZoom(), 12)
    });
    entry.marker.togglePopup();
    if (scrollToMap) {
      map.getContainer().scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
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
      focusEntry(map, entry);
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

  // ---- Sidebar list -----------------------------------------------------
  // Wraps the map container in a layout with a collapsible list beside it
  // (overlaid on top of it on mobile, via CSS — see map.css). Restructures
  // the DOM itself so the Webflow embed only ever needs the one plain map
  // <div>.

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

    mapContainer.parentNode.insertBefore(layout, mapContainer);
    layout.appendChild(sidebar);
    layout.appendChild(mapContainer);

    return { root: layout, sidebar: sidebar, title: title, closeBtn: closeBtn, list: list };
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

  // Keeps the map canvas in sync while .rhm-sidebar's width/max-height
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
        // Requires holding Ctrl/⌘ to scroll-zoom, so scrolling the page
        // past the map doesn't hijack the scroll. Set false to restore
        // plain scroll-to-zoom.
        cooperativeGestures: true,
        // Whether the hub list sidebar starts open. Set false to start
        // with it hidden and only the "Show hub list" button visible.
        showListByDefault: true
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

  // Everything that depends on the loaded data — markers, popups, the
  // sidebar list, search, and the map fitting itself to the hubs it got.
  function renderHubs(map, container, layout, geojson, opts) {
    // Only one popup open (and one sidebar item highlighted) at a time —
    // opening a new one closes/unhighlights whatever was previously
    // open, regardless of how it was opened (marker click, search, or
    // the sidebar list).
    var openPopup = null;
    var activeListItem = null;
    function setActiveListItem(el) {
      if (activeListItem) activeListItem.classList.remove("rhm-sidebar__item--active");
      if (el) el.classList.add("rhm-sidebar__item--active");
      activeListItem = el;
    }

    var entries = geojson.features.map(function (feature) {
      var entry = { feature: feature };

      // focusAfterOpen: false — MapLibre's default (true) auto-focuses
      // the popup's first focusable element as soon as it opens, and the
      // browser's default focus behavior scrolls that element into view.
      // Since we call togglePopup() right after starting flyTo() —
      // before the camera has actually moved — the popup is still
      // positioned at the OLD, pre-animation screen coordinates, so that
      // focus-scroll can jump the whole page to a wild position before
      // our own animation settles it back. Disabling it trades away that
      // keyboard/screen-reader convenience for not yanking the page
      // around; the popup content is still reachable by tabbing to it.
      var popup = new maplibregl.Popup({
        offset: 18,
        maxWidth: "360px",
        focusAfterOpen: false
      }).setHTML(popupHTML(feature.properties));
      popup.on("open", function () {
        if (openPopup && openPopup !== popup) openPopup.remove();
        openPopup = popup;
        setActiveListItem(entry.listItemEl);
      });

      var el = createMarkerEl(feature.properties.name);
      var marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat(feature.geometry.coordinates)
        .setPopup(popup)
        .addTo(map);

      // Attached explicitly rather than relying on the library's own
      // marker-click-to-popup binding, which doesn't fire reliably
      // across MapLibre versions.
      el.addEventListener("click", function (evt) {
        evt.stopPropagation();
        marker.togglePopup();
      });

      var listItemButton = document.createElement("button");
      listItemButton.type = "button";
      listItemButton.className = "rhm-sidebar__item";
      listItemButton.innerHTML =
        '<span class="rhm-sidebar__item-name">' + escapeHTML(feature.properties.name) + "</span>";
      listItemButton.addEventListener("click", function () {
        focusEntry(map, entry, true);
      });
      var listItem = document.createElement("li");
      listItem.appendChild(listItemButton);
      layout.list.appendChild(listItem);

      entry.marker = marker;
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

    // Added after the search control so it stacks directly below it in
    // the top-left corner. Only shown while the sidebar is hidden.
    var showListControl = createShowListControl(function () {
      setSidebarVisible(true);
    });
    map.addControl(showListControl, "top-left");

    function setSidebarVisible(visible) {
      layout.sidebar.classList.toggle("is-hidden", !visible);
      showListControl.element.style.display = visible ? "none" : "";
      animateMapResize(map, 260);
    }

    // Set directly (no animation) for the starting state.
    layout.sidebar.classList.toggle("is-hidden", !opts.showListByDefault);
    showListControl.element.style.display = opts.showListByDefault ? "none" : "";

    layout.closeBtn.addEventListener("click", function () {
      setSidebarVisible(false);
    });

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
