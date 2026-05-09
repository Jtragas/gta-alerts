const sampleIncidents = [
  {
    id: 1,
    type: "fire",
    title: "Fire / rescue response",
    location: "Downtown Toronto",
    status: "Sample official-feed style alert",
    time: "8 min ago",
    confidence: "Official-style demo",
    lat: 43.6532,
    lng: -79.3832
  },
  {
    id: 2,
    type: "transit",
    title: "TTC service disruption",
    location: "Line 1 corridor",
    status: "Sample transit alert",
    time: "14 min ago",
    confidence: "Public transit demo",
    lat: 43.6590,
    lng: -79.3970
  },
  {
    id: 3,
    type: "road",
    title: "Road closure / traffic issue",
    location: "Gardiner Expressway area",
    status: "Sample road alert",
    time: "20 min ago",
    confidence: "Road-info demo",
    lat: 43.6380,
    lng: -79.4100
  },
  {
    id: 4,
    type: "weather",
    title: "Weather advisory",
    location: "GTA-wide",
    status: "Sample weather alert",
    time: "36 min ago",
    confidence: "Weather demo",
    lat: 43.7001,
    lng: -79.4163
  },
  {
    id: 5,
    type: "community",
    title: "Community report",
    location: "Scarborough area",
    status: "Unverified sample community report",
    time: "42 min ago",
    confidence: "Unverified community demo",
    lat: 43.7731,
    lng: -79.2578
  }
];

const typeLabels = {
  fire: "Fire / Rescue",
  transit: "TTC",
  road: "Road",
  weather: "Weather",
  community: "Community"
};

const typeColors = {
  fire: "#e5484d",
  transit: "#0f4c81",
  road: "#f6b21a",
  weather: "#6b5dd3",
  community: "#178c60"
};

const gtaCenter = [43.6532, -79.3832];

const map = L.map("map", {
  zoomControl: true,
  scrollWheelZoom: false,
  preferCanvas: true
}).setView(gtaCenter, 10);

// Light professional map tiles.
// The error tile prevents ugly white gaps if a tile fails to load.
const errorTileSvg = encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
    <rect width="256" height="256" fill="#e8eef6"/>
    <path d="M0 128h256M128 0v256" stroke="#d0dae8" stroke-width="1"/>
  </svg>
`);

const baseLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", {
  subdomains: "abcd",
  maxZoom: 20,
  errorTileUrl: `data:image/svg+xml;charset=UTF-8,${errorTileSvg}`,
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
});

baseLayer.addTo(map);

let markersById = new Map();
let currentFilter = "all";
let activeId = null;

function makeIcon(type) {
  const color = typeColors[type] || "#0f4c81";
  const letter = (typeLabels[type] || "!").slice(0, 1);
  return L.divIcon({
    className: "gta-marker",
    html: `<span style="
      display:inline-grid;
      place-items:center;
      width:32px;
      height:32px;
      border-radius:50%;
      background:${color};
      color:white;
      border:3px solid white;
      box-shadow:0 8px 18px rgba(15,23,42,.25);
      font-weight:900;
      font-size:14px;
    ">${letter}</span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
}

function popupHtml(item) {
  return `
    <strong>${item.title}</strong><br>
    ${item.location}<br>
    <small>${item.status} · ${item.time}</small>
  `;
}

function getFilteredIncidents() {
  return currentFilter === "all"
    ? sampleIncidents
    : sampleIncidents.filter(item => item.type === currentFilter);
}

function forceMapResize() {
  // Leaflet sometimes needs a resize after a GitHub Pages/browser layout paint.
  setTimeout(() => map.invalidateSize(true), 50);
  setTimeout(() => map.invalidateSize(true), 350);
  setTimeout(() => map.invalidateSize(true), 900);
}

function renderMap() {
  markersById.forEach(marker => map.removeLayer(marker));
  markersById = new Map();

  const filtered = getFilteredIncidents();

  filtered.forEach(item => {
    const marker = L.marker([item.lat, item.lng], { icon: makeIcon(item.type) })
      .addTo(map)
      .bindPopup(popupHtml(item));

    marker.on("click", () => selectIncident(item.id, true));
    markersById.set(item.id, marker);
  });

  if (filtered.length > 1) {
    const group = L.featureGroup(Array.from(markersById.values()));
    map.fitBounds(group.getBounds().pad(0.18), { maxZoom: 12 });
  } else if (filtered.length === 1) {
    map.setView([filtered[0].lat, filtered[0].lng], 13);
  } else {
    map.setView(gtaCenter, 10);
  }

  forceMapResize();
}

function renderList() {
  const filtered = getFilteredIncidents();
  const list = document.getElementById("incident-list");
  const count = document.getElementById("alert-count");

  count.textContent = filtered.length;

  list.innerHTML = filtered.map(item => `
    <button class="incident-item ${item.id === activeId ? "active" : ""}" data-id="${item.id}">
      <span class="badge" style="background:${typeColors[item.type] || "#0f4c81"}">${typeLabels[item.type] || item.type}</span>
      <strong>${item.title}</strong>
      <div class="incident-meta">
        ${item.location}<br>
        ${item.status}<br>
        ${item.time}
      </div>
    </button>
  `).join("");

  document.querySelectorAll(".incident-item").forEach(button => {
    button.addEventListener("click", () => {
      selectIncident(Number(button.dataset.id), true);
    });
  });
}

function renderSelected(item) {
  const panel = document.getElementById("selected-alert");

  if (!item) {
    panel.innerHTML = `<p class="empty-state">Click an alert card or map pin to see details here.</p>`;
    return;
  }

  panel.innerHTML = `
    <div class="detail-card">
      <span class="badge" style="background:${typeColors[item.type] || "#0f4c81"}">${typeLabels[item.type] || item.type}</span>
      <h4>${item.title}</h4>
      <p>${item.status}</p>
      <div class="detail-grid">
        <div>
          <span>Location</span>
          <strong>${item.location}</strong>
        </div>
        <div>
          <span>Time</span>
          <strong>${item.time}</strong>
        </div>
        <div>
          <span>Confidence</span>
          <strong>${item.confidence}</strong>
        </div>
        <div>
          <span>Action</span>
          <strong>Avoid if needed</strong>
        </div>
      </div>
    </div>
  `;
}

function selectIncident(id, openPopup = false) {
  activeId = id;
  const item = sampleIncidents.find(incident => incident.id === id);
  renderList();
  renderSelected(item);

  const marker = markersById.get(id);
  if (marker) {
    map.setView([item.lat, item.lng], 13);
    forceMapResize();
    if (openPopup) {
      marker.openPopup();
    }
  }
}

function renderAll() {
  activeId = null;
  renderMap();
  renderList();
  renderSelected(null);
}

document.querySelectorAll(".filter").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach(btn => btn.classList.remove("active"));
    button.classList.add("active");
    currentFilter = button.dataset.filter;
    renderAll();
  });
});

window.addEventListener("load", () => {
  renderAll();
  forceMapResize();
});

window.addEventListener("resize", forceMapResize);

// One more resize after browser restores scroll/hash position.
setTimeout(forceMapResize, 1500);
