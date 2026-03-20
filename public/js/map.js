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
    if (!markerGroup || !map) return;
    markerGroup.clearLayers();

    sites.forEach(site => {
        let dynamicColor = "#ff5757"; 
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
    const MAX_RENDER_DISTANCE = 300;
    const STEP = 5;

    const latTile = Math.floor(userLat / STEP) * STEP;
    const lonTile = Math.floor(userLon / STEP) * STEP;
    const tileId = `${latTile}_${lonTile}`;

    const getHeatOptions = (zoom) => {
        let r, b;
        if (zoom >= 12) { r = 3; b = 5; }
        else if (zoom >= 9) { r = 8; b = 10; }
        else { r = 15; b = 20; }

        return {
            radius: r,
            blur: b,
            maxZoom: 18,
            minOpacity: 0.08,
            gradient: {
                0.0: 'rgba(0,0,0,0)',
                0.1: 'rgba(48, 0, 102, 0)',
                0.2: 'blue',
                0.4: 'cyan',
                0.6: 'lime',
                0.8: 'yellow',
                1.0: 'red'
            }
        }
    }

    try{
        const url = `https://AndrewMulert.github.io/light_tiles/t_${tileId}.json`;
        const response = await fetch(url);

        if (!response.ok) {
            console.warn(`No light pollution tile found for ${tileId}`);
            return;
        }

        const gridData = await response.json();
        const userLoc = { lat: userLat, lon: userLon };
        
        const rows = gridData.length;
        const cols = gridData[0].length;
        const heatPoints = [];

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const val = gridData[r][c];

                if (val < 0.2) continue;

                const pLat = latTile + ( ( (rows - 1) - r ) / (rows - 1) ) * STEP;
                const pLon = lonTile + (c / (cols - 1)) * STEP;

                const dist = calculateDistance(userLoc, { lat: pLat, lon: pLon});
                if (dist <= MAX_RENDER_DISTANCE) {
                    heatPoints.push([pLat, pLon, Math.min(val / 3, 1)]);
                }
            }
        }

        console.log(`Rendering ${heatPoints.length} points from tile ${tileId}`);

        if (window.heatLayer && window.stellaMap) window.stellaMap.removeLayer(window.heatLayer);

        if (typeof L.heatLayer !== 'function') {
            console.error("❌ Leaflet Heat plugin is missing!");
            return;
        }

        if (heatPoints.length > 0) {
            const currentZoom = map.getZoom();

            window.heatLayer = L.heatLayer(heatPoints, getHeatOptions(currentZoom)).addTo(map);

            map.off('zoomend.heat');
            map.on('zoomend.heat', () => {
                window.heatLayer.setOptions(getHeatOptions(map.getZoom()));
            });
        }
    } catch (err) {
        console.error("Heatmap Load Error:", err);
    }
}

function getScoreColor(score) {
        if (score >= 80) return "#57ff8f";
        if (score >= 60) return "#81ff57";
        if (score >= 40) return "#e3ff57";
        return "#ffb957";
}

window.syncMapState = function(coords, sites, prefs) {
    if (!window.stellaMap) return;

    window.updateMapMarkers(sites);

    if (window.radiusGroup) {
        window.radiusGroup.clearLayers();

        const miles = (prefs.maxDriveTime / 60) * 45;
        const meters = miles * 1609.34;

        const rangeCircle = L.circle([coords.lat, coords.lon], {
            radius: meters,
            color: '#FFDB59',
            weight: 1,
            fillOpacity: 0.05,
            dashArray: '4, 8',
            interactive: false
        }).addTo(window.radiusGroup);

        const targetBounds = rangeCircle.getBounds();
        window.stellaMap.flyToBounds(targetBounds, {
            padding: [40, 40],
            duration: 1.5,
            easeLinearity: 0.5
        });

        window.stellaMap.once('moveend', () => {
            window.stellaMap.invalidateSize();
            if (typeof window.loadLightPollution === 'function') {
                window.loadLightPollution(coords.lat, coords.lon);
            }
        });
    }
};