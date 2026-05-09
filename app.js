const sampleIncidents = [
  {
    id: 1,
    type: "fire",
    title: "Fire / rescue response",
    location: "Downtown Toronto",
    status: "Sample official-feed style alert",
    time: "8 min ago",
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
  fire: "#ff5a5f",
  transit: "#7dd3fc",
  road: "#ffcc33",
  weather: "#a78bfa",
  community: "#34d399"
};

const map = L.map("map").setView([43.6532, -79.3832], 11);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

let markers = [];

function makeIcon(type) {
  const color = typeColors[type] || "#ffcc33";
  return L.divIcon({
    className: "custom-marker",
    html: `<span style="
      display:inline-grid;
      place-items:center;
      width:28px;
      height:28px;
      border-radius:50%;
      background:${color};
      color:#111827;
      border:2px solid white;
      box-shadow:0 6px 18px rgba(0,0,0,.35);
      font-weight:900;
    ">!</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
}

function render(filter = "all") {
  markers.forEach(marker => map.removeLayer(marker));
  markers = [];

  const filtered = filter === "all"
    ? sampleIncidents
    : sampleIncidents.filter(item => item.type === filter);

  filtered.forEach(item => {
    const marker = L.marker([item.lat, item.lng], { icon: makeIcon(item.type) })
      .addTo(map)
      .bindPopup(`
        <strong>${item.title}</strong><br>
        ${item.location}<br>
        <small>${item.status} · ${item.time}</small>
      `);

    markers.push(marker);
  });

  const list = document.getElementById("incident-list");
  list.innerHTML = filtered.map(item => `
    <article class="incident-item">
      <span class="badge">${typeLabels[item.type] || item.type}</span>
      <strong>${item.title}</strong>
      <div class="incident-meta">
        ${item.location}<br>
        ${item.status}<br>
        ${item.time}
      </div>
    </article>
  `).join("");

  if (markers.length) {
    const bounds = L.featureGroup(markers).getBounds();
    map.fitBounds(bounds.pad(0.2));
  }
}

document.querySelectorAll(".filter").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach(btn => btn.classList.remove("active"));
    button.classList.add("active");
    render(button.dataset.filter);
  });
});

render();
