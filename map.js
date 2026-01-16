mapboxgl.accessToken = "pk.eyJ1IjoiaGFtYWRhMSIsImEiOiJjbWtkdGN6dW8wZzB2M2VzNjZyaDA4ancyIn0.mGalWB-toGdYBINfMNbgWQ";

// Toronto bias for both search modes
const TORONTO_CENTER = [-79.38, 43.65];

// Your properties tileset (vector)
const PROPERTY_TILESET = "mapbox://hamada1.cmkdtnu1e0jl01olgnc0s9p0q-9ur4t";
const PROPERTY_SOURCE_LAYER = "test";

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/streets-v12",
  center: TORONTO_CENTER,
  zoom: 10
});

map.addControl(new mapboxgl.NavigationControl());

/* -----------------------------
   UI elements
----------------------------- */
const searchModeEl = document.getElementById("searchMode");
const sbInput = document.getElementById("sbInput");
const sbResults = document.getElementById("sbResults");

const listEl = document.getElementById("list");
const countEl = document.getElementById("count");
const listSearchEl = document.getElementById("listSearch");

/* -----------------------------
   Shared search state
----------------------------- */
let searchMarker = null;
let debounceTimer = null;

/* -----------------------------
   Address mode (Geocoder plugin) - used as a client library, no default UI
----------------------------- */
const geocoderClient = new MapboxGeocoder({
  accessToken: mapboxgl.accessToken,
  mapboxgl,
  marker: false,
  countries: "ca",
  proximity: TORONTO_CENTER,
  types: "address,street,postcode,place,neighborhood,locality",
  limit: 10
});

/* -----------------------------
   Places mode (Search Box API)
   Uses session_token for correct billing grouping.
----------------------------- */
let sbSessionToken = crypto.randomUUID();

const SB_COUNTRY = "CA";
const SB_PROXIMITY = `${TORONTO_CENTER[0]},${TORONTO_CENTER[1]}`;

searchModeEl.addEventListener("change", () => {
  hideSuggestions();
  sbInput.value = "";

  const mode = searchModeEl.value;
  sbInput.placeholder =
    mode === "places"
      ? "Search a place: restaurant, school, park..."
      : "Search an address: street name, house number...";

  sbSessionToken = crypto.randomUUID();
});

sbInput.addEventListener("input", () => {
  const q = sbInput.value.trim();
  clearTimeout(debounceTimer);

  if (!q) {
    hideSuggestions();
    return;
  }

  debounceTimer = setTimeout(() => {
    const mode = searchModeEl.value;
    if (mode === "places") {
      suggestPlaces(q);
    } else {
      suggestAddresses(q);
    }
  }, 220);
});

sbInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideSuggestions();
});

/* -----------------------------
   Places: Search Box API
----------------------------- */
async function suggestPlaces(q) {
  try {
    const types =
      "poi,address,street,neighborhood,locality,place,district,postcode,region,country";

    const url = new URL("https://api.mapbox.com/search/searchbox/v1/suggest");
    url.searchParams.set("q", q);
    url.searchParams.set("access_token", mapboxgl.accessToken);
    url.searchParams.set("session_token", sbSessionToken);
    url.searchParams.set("country", SB_COUNTRY);
    url.searchParams.set("proximity", SB_PROXIMITY);
    url.searchParams.set("types", types);
    url.searchParams.set("limit", "10");
    url.searchParams.set("language", "en");

    const res = await fetch(url.toString());
    const data = await res.json();

    renderSuggestions(data.suggestions || [], "places");
  } catch (err) {
    console.error("Search Box API suggest error:", err);
    hideSuggestions();
  }
}

async function retrievePlace(mapboxId) {
  try {
    const url = new URL(`https://api.mapbox.com/search/searchbox/v1/retrieve/${mapboxId}`);
    url.searchParams.set("access_token", mapboxgl.accessToken);
    url.searchParams.set("session_token", sbSessionToken);
    url.searchParams.set("language", "en");

    const res = await fetch(url.toString());
    const data = await res.json();

    const feature = data.features?.[0];
    const coords = feature?.geometry?.coordinates;
    if (!coords) return;

    hideSuggestions();
    setSearchMarker(coords);
    map.flyTo({ center: coords, zoom: 16 });

    const name = feature.properties?.name || "Place";
    const full =
      feature.properties?.full_address ||
      feature.properties?.place_formatted ||
      "";

    new mapboxgl.Popup()
      .setLngLat(coords)
      .setHTML(`<b>${escapeHtml(name)}</b><br/><small>${escapeHtml(full)}</small>`)
      .addTo(map);

    sbSessionToken = crypto.randomUUID();
  } catch (err) {
    console.error("Search Box API retrieve error:", err);
  }
}

/* -----------------------------
   Address: Geocoder forwardGeocode
----------------------------- */
async function suggestAddresses(q) {
  try {
    const resp = await geocoderClient
      .forwardGeocode({
        query: q,
        limit: 10,
        countries: ["ca"],
        proximity: { longitude: TORONTO_CENTER[0], latitude: TORONTO_CENTER[1] }
      })
      .send();

    const feats = resp.body?.features || [];

    renderSuggestions(
      feats.map((f) => ({
        name: f.text,
        place_formatted: f.place_name,
        // Store center as JSON for selection
        mapbox_id: JSON.stringify(f.center)
      })),
      "address"
    );
  } catch (err) {
    console.error("Geocoder forward error:", err);
    hideSuggestions();
  }
}

/* -----------------------------
   Suggestion dropdown renderer (shared)
----------------------------- */
function renderSuggestions(items, mode) {
  sbResults.innerHTML = "";
  sbResults.style.display = "block";

  if (!items.length) {
    sbResults.innerHTML = `<div style="padding:10px;opacity:.7">No results</div>`;
    return;
  }

  for (const s of items) {
    const row = document.createElement("div");
    row.style.padding = "10px 12px";
    row.style.borderBottom = "1px solid #f1f1f1";
    row.style.cursor = "pointer";

    const subtitle = s.place_formatted || "";
    row.innerHTML = `
      <div style="font-weight:700">${escapeHtml(s.name)}</div>
      <div style="font-size:12px;opacity:.75">${escapeHtml(subtitle)}</div>
    `;

    row.onclick = () => {
      if (mode === "places") {
        retrievePlace(s.mapbox_id);
      } else {
        const center = JSON.parse(s.mapbox_id);
        hideSuggestions();
        setSearchMarker(center);
        map.flyTo({ center, zoom: 16 });
      }
    };

    sbResults.appendChild(row);
  }
}

function hideSuggestions() {
  sbResults.style.display = "none";
  sbResults.innerHTML = "";
}

function setSearchMarker(coords) {
  if (searchMarker) searchMarker.remove();
  searchMarker = new mapboxgl.Marker({ color: "#111" }).setLngLat(coords).addTo(map);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (s) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[s]));
}

/* -----------------------------
   Properties layer + sidebar (visible results only)
----------------------------- */
let visibleFeatures = [];

map.on("load", () => {
  map.addSource("properties", {
    type: "vector",
    url: PROPERTY_TILESET
  });

  map.addLayer({
    id: "properties-points",
    type: "circle",
    source: "properties",
    "source-layer": PROPERTY_SOURCE_LAYER,
    paint: {
      "circle-radius": 4,
      "circle-color": "#1da1f2",
      "circle-stroke-width": 1,
      "circle-stroke-color": "#fff"
    }
  });

  updateSidebar();
  map.on("moveend", updateSidebar);
  map.on("zoomend", updateSidebar);

  map.on("click", "properties-points", (e) => {
    const f = e.features?.[0];
    if (!f) return;

    const p = f.properties || {};
    new mapboxgl.Popup()
      .setLngLat(e.lngLat)
      .setHTML(`
        <b>${escapeHtml(p.Address || "Property")}</b><br/>
        Price: ${escapeHtml(p.ListPrice || "-")}<br/>
        Beds: ${escapeHtml(p.BedroomsTotal || "-")}<br/>
        Baths: ${escapeHtml(p.BathroomsFull || "-")}
      `)
      .addTo(map);
  });

  map.on("mouseenter", "properties-points", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "properties-points", () => (map.getCanvas().style.cursor = ""));
});

function updateSidebar() {
  const features = map.queryRenderedFeatures({ layers: ["properties-points"] });

  // Remove duplicates from tile rendering
  const uniq = new Map();
  for (const f of features) {
    const id = f.properties?.ListingKey || JSON.stringify(f.geometry?.coordinates);
    if (!uniq.has(id)) uniq.set(id, f);
  }

  visibleFeatures = Array.from(uniq.values());
  renderList(visibleFeatures);
}

listSearchEl.addEventListener("input", () => {
  const q = (listSearchEl.value || "").toLowerCase().trim();
  if (!q) return renderList(visibleFeatures);

  const filtered = visibleFeatures.filter((f) => {
    const p = f.properties || {};
    return Object.values(p).join(" ").toLowerCase().includes(q);
  });

  renderList(filtered);
});

function renderList(features) {
  countEl.textContent = `Visible properties: ${features.length}`;
  listEl.innerHTML = "";

  features.slice(0, 200).forEach((f) => {
    const p = f.properties || {};
    const coords = f.geometry?.coordinates;

    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="title">${escapeHtml(p.Address || "Property")}</div>
      <div class="meta">${escapeHtml((p.City || "") + " • " + (p.ListPrice || "-"))}</div>
    `;

    div.onclick = () => {
      if (coords) map.flyTo({ center: coords, zoom: 14 });
    };

    listEl.appendChild(div);
  });
}
