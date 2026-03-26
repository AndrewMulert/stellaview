let map = null;
let markerGroup = null;
let moveTimeout;
let dataLayer = L.featureGroup();

const getHeatOptions = (zoom) => {
    const radius = Math.max(10, (zoom - 2) * 5);
    const blur = radius * 0.85;

    return {
        radius: radius,
        blur: blur,
        maxZoom: 13,
        minOpacity: 0.15,
        max: 0.85,
        gradient: {
            0.05: '#000033',
            0.15: '#4b0082',
            0.30: '#00ffff',
            0.50: '#00ff00',
            0.70: '#ffff00',
            0.85: '#ff0000',
            1.00: '#ffffff'
        }
    };
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

    const originalCreateCanvas = L.Canvas.prototype._initCanvas;
    L.Canvas.prototype._initCanvas = function () {
        originalCreateCanvas.call(this);
        const ctx = this._ctx;
        if (ctx) {
            this._canvas.getContext('2d', { willReadFrequently: true });
        }
    };

    const southWest = L.latLng(-89.981557, -180);
    const northEast = L.latLng(89.993461, 180);
    const bounds = L.latLngBounds(southWest, northEast);

    map.setMaxBounds(bounds);

    map.on('drag', function() {
        map.panInsideBounds(bounds, { animate: false });
    });

    map.on('layeradd', (e) => {
        if (e.layer._canvas) {
            e.layer._canvas.getContext('2d', { willReadFrequently: true });
        }
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    markerGroup = L.layerGroup().addTo(map);
    window.radiusGroup = L.layerGroup().addTo(map);
    dataLayer.addTo(map);
    window.stellaMap = map;

    map.on('moveend', function() {
        clearTimeout(moveTimeout);
        moveTimeout = setTimeout(() => {
            const center = map.getCenter();
            window.loadLightPollution(center.lat, center.lng);
        }, 250);
    });

    map.on('zoomend', function() {
        var currentZoom = map.getZoom();
        var newRadius = calculateRadius(currentZoom);

        dataLayer.setStyle({
            radius: newRadius
        });

        if (window.heatLayer) {
            window.heatLayer.setOptions(getHeatOptions(map.getZoom()));
        }
    });
};

window.updateMapMarkers = function(sites) {
    if (!markerGroup || !map) return;
    markerGroup.clearLayers();

    sites.forEach(site => {
        const dynamicColor = getScoreColor(site.score);

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
    window.capturedMapData = [];

    const STEP = 5;
    const heatPoints = [];
    const currentZoom = window.stellaMap.getZoom();
    const bounds = window.stellaMap.getBounds();

    const west = Math.floor(bounds.getWest() / STEP) * STEP;
    const east = Math.floor(bounds.getEast() / STEP) * STEP;
    const south = Math.floor(bounds.getSouth() / STEP) * STEP;
    const north = Math.floor(bounds.getNorth() / STEP) * STEP;

    const fetchTile = async (tLat, tLon) => {
        try {
            const response = await fetch(`https://AndrewMulert.github.io/light_tiles/t_${tLat}_${tLon}.json`);
            return response.ok ? await response.json() : null;
        } catch { return null; }
    };

    const tileCoords = [];
    for (let lat = south; lat <= north; lat += STEP) {
        for (let lon = west; lon <= east; lon += STEP) {
            tileCoords.push({ lat, lon });
        }
    }

    try {
        const results = await Promise.all(tileCoords.map(c => fetchTile(c.lat, c.lon).then(data => ({data, ...c}))));
        const successfulTiles = results.filter(r => r.data).length;

        let localMax = 0.1;
        results.forEach(({data}) => {
            if (!data || !data.length) return;
            data.forEach(row => {
                const rowMax = Math.max(...row);
                if (rowMax > localMax) localMax = rowMax;
            });
        });

        console.group(`🌌 DATA DIAGNOSTIC: Zoom ${currentZoom}`);
        console.log(`📡 Tiles: ${successfulTiles}/9 | Local Max Brightness: ${localMax}`);

        let distribution = { low: 0, cyan: 0, green: 0, yellow: 0, high: 0 };
        let topPoints = [];
        let pointsProcessed = 0;

        results.forEach(({data, lat, lon}) => {
            if (!data || !data.length) return;
            const rows = data.length;
            const cols = data[0].length;
        
            let stride = currentZoom <= 6 ? 3 : 1;

            const BASELINE_NOISE = 0.5;
            const FUNCTIONAL_MAX = 120;
            const minLog = Math.log10(BASELINE_NOISE + 1);
            const maxLog = Math.log10(FUNCTIONAL_MAX + 1);
            const logRange = maxLog - minLog;

            for (let r = 0; r < rows; r += stride) {
                for (let c = 0; c < cols; c+= stride) {
                    const val = data[r][c];

                    if (val <= BASELINE_NOISE) continue;
                    let assignedColor = "Unknown";

                    const latOffset = ((rows - 1 - r) / (rows - 1)) * STEP;
                    const lonOffset = (c / (cols - 1)) * STEP;

                    const pLat = lat + latOffset;
                    const pLon = lon + lonOffset;

                    const valLog = Math.log10(val + 1);
                    let intensity = (valLog - minLog) / logRange;
                    intensity = Math.pow(intensity, 0.5);
                    intensity = Math.max(0, Math.min(1.0, intensity));

                    if (isNaN(intensity)) continue;

                    if (intensity > 0.8) {
                        assignedColor = "White/Hotspot";
                        distribution.high++;
                    } else if (intensity > 0.6) {
                        assignedColor = "Yellow/Red";
                        distribution.yellow++;
                    } else if (intensity > 0.4) {
                        assignedColor = "Green/Cyan";
                        distribution.green++;
                    } else if (intensity > 0.2) {
                        assignedColor = "Blue/Indigo";
                        distribution.cyan++;
                    } else {
                        assignedColor = "Deep Blue";
                        distribution.low++;
                    }

                    if (pointsProcessed % 2000 === 0) {
                        console.log(
                            `📍 COORDS: ${pLat.toFixed(4)}, ${pLon.toFixed(4)} | ` +
                            `RAW: ${val.toFixed(1)} | ` +
                            `INTENSITY: ${intensity.toFixed(2)} | ` +
                            `COLOR: ${assignedColor}`
                        );
                    }

                    if (isNaN(intensity)) continue;

                    window.capturedMapData.push({
                        lat: Number(pLat.toFixed(4)),
                        lon: Number(pLon.toFixed(4)),
                        v: Number(val.toFixed(2)),
                        i: Number(intensity.toFixed(4))
                    });

                    if (topPoints.length < 5 || intensity > topPoints[topPoints.length - 1].intensity) {
                        topPoints.push({ lat: pLat.toFixed(4), lon: pLon.toFixed(4), rawVal: val.toFixed(2), intensity });
                        topPoints.sort((a, b) => b.intensity - a.intensity);
                        if (topPoints.length > 5) topPoints.pop();
                    }

                    heatPoints.push([pLat, pLon, Math.min(1.0, intensity)]);
                    pointsProcessed++;
                }
            }
        });

        console.log("🏆 Top 5 Brightest Points in View:");
        console.table(topPoints);
        console.log("📊 Distribution Summary:", distribution);

        if (window.heatLayer && window.stellaMap.hasLayer(window.heatLayer)) {
            window.stellaMap.removeLayer(window.heatLayer);
        }

        if (typeof L.heatLayer !== 'function') {
            console.error("❌ Leaflet Heat plugin is missing!");
            return;
        }

        if (heatPoints.length > 0 && window.stellaMap) {
            const options = getHeatOptions(currentZoom);
            window.heatLayer = L.heatLayer(heatPoints, options).addTo(window.stellaMap);

            const canvas = window.heatLayer._canvas;
            if (canvas) {
                canvas.classList.add('stella-heat-layer')
            }
        }

        if (window.currentUser?.accessLevel >= 10) {
            downloadCapturedData();
        }

        console.groupEnd();
    } catch (err) {
        console.error("Heatmap Load Error:", err);
    }
}

function getScoreColor(score) {
    if (score >= 80) return "#57ff8f";
    if (score >= 60) return "#81ff57";
    if (score >= 40) return "#e3ff57";
    if (score >= 20) return "#ffb957";
    return "#ff5757";
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

window.capturedMapData = [];

function calculateRadius(zoom) {
    return Math.pow(2, zoom / 3);
}

function downloadCapturedData() {
    const userAccess = window.currentUser?.accessLevel || window.accessLevel || 0;

    if (userAccess < 10) {
        console.warn("🚫 Access Denied: Level 10 required for data export. Current level:", window.accessLevel || 0);
        return;
    }

    if (!window.capturedMapData || window.capturedMapData.length === 0) {
        console.warn("⚠️ No data captured to export.");
        return;
    }

    const fileName = `stella_data_${new Date().toISOString().split('T')[0]}.json`;

    const blob = new Blob([JSON.stringify(window.capturedMapData)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);

    console.log(`✅ Exported ${window.capturedMapData.length} points.`);
}