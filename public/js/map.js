import { calculateDistance, formatCoords } from './utils.js';

let map = null;
let markerGroup = null;

window.initMap = function(lat, lon) {
    const container = document.getElementById('stella-map');
    if (!container) {
        console.error("❌ Map container #stella-map not found in HTML.");
        return;
    }
    
    if (map) {
        map.flyTo([lat, lon], map.getZoom() < 8 ? 8 : map.getZoom(), {
            animate: true,
            duration: 1.5
        });
        return;
    }

    console.log("🗺️ Initializing Leaflet map at:", lat, lon);

    map = L.map('stella-map', {
        center: [lat, lon],
        zoom: 7,
        minZoom: 3,
        maxZoom: 18,
        zoomControl: false,
        attributionControl: false,
        worldCopyJump: true,
        bounceAtZoomLimits: true
    });

    const southWest = L.latLng(-89.981557, -180);
    const northEast = L.latLng(89.993461, 180);
    const bounds = L.latLngBounds(southWest, northEast);

    map.setMaxBounds(bounds);
    map.on('drag', function() {
        map.panInsideBounds(bounds, { animate: false });
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    markerGroup = L.layerGroup().addTo(map);
    window.radiusGroup = L.layerGroup().addTo(map);
    window.stellaMap = map;
};

window.updateMapMarkers = function(sites) {
    if (!markerGroup) return;
    markerGroup.clearLayers();

    sites.forEach(site => {
        let dynamicColor = "#ff5757"; // Default Red
        if (site.score >= 80) dynamicColor = "#57ff8f";
        else if (site.score >= 60) dynamicColor = "#81ff57";
        else if (site.score >= 40) dynamicColor = "#e3ff57";
        else if (site.score >= 20) dynamicColor = "#ffb957";

        const marker = L.circleMarker([site.lat, site.lon], {
            radius: 8,
            fillColor: dynamicColor,
            color: "#00464D",
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9,
            className: `marker-${site.name.replace(/\s+/g, '-').toLowerCase()}`
        });

        marker.bindTooltip(site.name, {
            direction: 'top',
            offset: [0, -10],
            className: 'stella-tooltip'
        });

        marker.on('mouseover', function() {
            this.setRadius(14);
            this.openTooltip();
        });

        marker.on('mouseout', function() {
            this.setRadius(8);
        });

        markerGroup.addLayer(marker);
    });
};

window.loadLightPollution = async function(userLat, userLon) {
    const MAX_RENDER_DISTANCE = 150;
    const STEP = 5;

    const latTile = Math.floor(userLat / STEP) * STEP;
    const lonTile = Math.floor(userLon / STEP) * STEP;
    const tileId = `${latTile}_${lonTile}`;

    try{
        const url = 'https://AndrewMulert.github.io/light_tiles/t_${tileId}.json';
        const response = await fetch(url);

        if (!response.ok) {
            console.warn(`No light pollution tile found for ${tileId}`);
            return;
        }

        const data = await response.json();
        const userLoc = { lat: userLat, lon: userLon };

        const heatPoints = [];

        if (Array.isArray(data) && data[0].lat !== undefined) {
            data.forEach(point => {
                const dist = calculateDistance(userLoc, { lat: point.lat, lon: point.lon});
                if (dist <= MAX_RENDER_DISTANCE) {
                    heatPoints.push([point.lat, point.lon, point.value / 10]);
                }
            });
        }

        console.log(`Rendering ${heatPoints.length} points from tile ${tileId}`);

        if (window.heatLayer && window.stellaMap) window.stellaMap.removeLayer(window.heatLayer);

        if (heatPoints.length > 0){
                window.heatLayer = L.heatLayer(heatPoints, {
                radius: 25,
                blur: 15,
                maxZoom: 10,
                gradient: { 0.4: 'blue', 0.6: 'cyan', 0.7: 'lime', 0.8: 'yellow', 1: 'red' }
            }).addTo(map);
        }
    } catch (err) {
        console.error("Light pollution heatmap failed:", err);
    }
}