let map = null;
let markerGroup = null;

window.initMap = function(lat, lon) {
    const container = document.getElementById('stella-map');
    if (!container) {
        console.error("❌ Map container #stella-map not found in HTML.");
        return;
    }
    
    if (map) {
        map.flyTo([lat, lon], 10, {
            animate: true,
            duration: 1.5
        });
        return;
    }

    console.log("🗺️ Initializing Leaflet map at:", lat, lon);

    map = L.map('stella-map', {
        center: [lat, lon],
        zoom: 7,
        zoomControl: false,
        attributionControl: false
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    L.tileLayer('https://andrewmulert.github.io/light_tiles/{z}/{x}/{y}.png', {
        maxZoom: 8,
        opacity: 0.2,
        className: 'light-pollution-layer',
    }).addTo(map);

    markerGroup = L.layerGroup().addTo(map);
};

window.updateMapMarkers = function(sites) {
    if (!markerGroup) return;
    markerGroup.clearLayers();

    sites.forEach(site => {
        const marker = L.circleMarker([site.lat, site.lon], {
            radius: 8,
            fillColor: "#FFDB59",
            color: "#00464D",
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9
        });

        markerGroup.addLayer(marker);
    });
};