import { calculateDistance, formatCoords } from './utils.js';

let map = null;
let markerGroup = null;

const getHeatOptions = (zoom) => {
    const dynamicRadius = zoom <= 7 ? 15 : Math.pow(zoom, 1.8);

    const dynamicBlur = zoom < 8 ? 25 : 15;

    return {
        radius: dynamicRadius,
        blur: 15,
        maxZoom: 18,
        minOpacity: 0.1,
        max: zoom > 12 ? 0.4 : (zoom <= 8 ? 1.0 : 0.6),
        gradient: {
            0.10: '#0d001c',
            0.25: 'blue',
            0.50: 'cyan',
            0.70: 'lime',
            0.85: 'yellow',
            1.00: 'red'
        }
    }
};

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

    map.on('moveend', () => {
        const center = map.getCenter();
        window.loadLightPollution(center.lat, center.lng);
    });

    map.on('zoomend', () => {
        if (window.heatLayer) {
            window.heatLayer.setOptions(getHeatOptions(map.getZoom()));
        }
    });
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
    const STEP = 5;
    const heatPoints = [];
    const currentZoom = window.stellaMap.getZoom();

    const getColorForIntensity = (i) => {
        if (i < 0.1) return "Purple (Below Threshold)";
        if (i < 0.3) return "Blue";
        if (i < 0.5) return "Cyan";
        if (i < 0.7) return "Lime";
        if (i < 1.0) return "Yellow";
        return "Red";
    };

    const latBase = Math.floor(userLat / STEP) * STEP;
    const lonBase = Math.floor(userLon / STEP) * STEP;

    const fetchTile = async (tLat, tLon) => {
        try {
            const response = await fetch(`https://AndrewMulert.github.io/light_tiles/t_${tLat}_${tLon}.json`);
            return response.ok ? await response.json() : null;
        } catch { return null; }
    };

    const tileCoords = [];
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            tileCoords.push({ lat: latBase + (i * STEP), lon: lonBase + (j * STEP)});
        }
    }

    try{
        const results = await Promise.all(tileCoords.map(c => fetchTile(c.lat, c.lon).then(data => ({data, ...c}))));

        const successfulTiles = results.filter(r => r.data).length;
        console.log(`📡 Tiles fetched: ${successfulTiles}/9`);

        let maxValFound = 0;
        results.forEach(({data}) => {
            if (!data) return;
            data.forEach(row => {
                const rowMax = Math.max(...row);
                if (rowMax > maxValFound) maxValFound = rowMax;
            });
        });

        console.log(`📊 Max Value in current data: ${maxValFound}`);

        results.forEach(({data, lat, lon}) => {
            if (!data) return;
            const rows = data.length;
            const cols = data[0].length;
            const currentZoom = window.stellaMap.getZoom();

            const stride = 1;

            for (let r = 0; r < rows; r+= stride) {
                for (let c = 0; c < cols; c+= stride) {
                    const val = data[r][c];
                    if (val <  0.5) continue;

                    const latSpacing = STEP / rows;
                    const lonSpacing = STEP / cols;

                    const jitter = () => (Math.random() - 0.5) * 1.5;
                    const pLat = lat + ( ( (rows - 1 - r ) / (rows - 1) ) * STEP) + (jitter() * latSpacing);
                    const pLon = lon + ( (c / (cols - 1)) * STEP ) + (jitter() * lonSpacing);

                    const URBAN_CEILING = 250;
                    let intensity = Math.log10(val + 1) / Math.log10(URBAN_CEILING + 1);
                    intensity = Math.min(1.0, intensity);

                    if (currentZoom > 10) {
                        const zoomBoost = (currentZoom - 10) * 0.2;
                        intensity = Math.min(1.0, intensity + zoomBoost);
                    };

                    if (currentZoom < 6) {
                        intensity = Math.max(0.2, intensity);
                    }

                    if (heatPoints.length % 500 === 0) {
                        console.log(`📍 Point sample: [Lat: ${pLat.toFixed(2)}, Lon: ${pLon.toFixed(2)}] | Raw: ${val.toFixed(2)} | Intensity: ${intensity.toFixed(3)} | Color: ${getColorForIntensity(intensity)}`);
                    }

                    heatPoints.push([pLat, pLon, intensity]);
                }
            }
       });

        if (window.heatLayer && window.stellaMap) window.stellaMap.removeLayer(window.heatLayer);

        if (typeof L.heatLayer !== 'function') {
            console.error("❌ Leaflet Heat plugin is missing!");
            return;
        }

        if (heatPoints.length > 0) {
            const currentZoom = window.stellaMap.getZoom();
            const options = getHeatOptions(currentZoom);

            window.heatLayer = L.heatLayer(heatPoints, options).addTo(window.stellaMap);
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