let map = null;
let markerGroup = null;
let moveTimeout;
let dataLayer = L.featureGroup();

const MAP_CONFIG = {
    REF_ZOOM: 10,
    REF_RADIUS: 25,
    BLUR_RATIO: 0.65,
}

const getHeatOptions = (zoom) => {
    const zoomDiff = zoom - MAP_CONFIG.REF_ZOOM;
    const radius = MAP_CONFIG.REF_RADIUS * Math.pow(1.5, zoomDiff);
    const clampedRadius = Math.max(10, Math.min(radius, 55));

    return {
        radius: clampedRadius,
        blur: clampedRadius * MAP_CONFIG.BLUR_RATIO,
        maxZoom: 18,
        minOpacity: 0.05,
        max: 1.0,
        gradient: {
            0.15: '#0022ff',
            0.30: '#00ffff',
            0.50: '#00ff00', 
            0.70: '#ffff00',
            0.85: '#ff4400',
            1.0:  '#ffffff'
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

    const originalCreateCanvas = L.Canvas.prototype._initCanvas;
    L.Canvas.prototype._initCanvas = function () {
        originalCreateCanvas.call(this);
        const ctx = this._ctx;
        if (ctx && this._canvas) {
            this._canvas.getContext('2d', { willReadFrequently: true });
        }
    };

    const southWest = L.latLng(-89.981557, -180);
    const northEast = L.latLng(89.993461, 180);
    const bounds = L.latLngBounds(southWest, northEast);

    map.setMaxBounds(bounds);
    map.options.maxBoundsViscosity = 1.0;

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
    const currentOptions = getHeatOptions(currentZoom);

    const west = Math.floor(bounds.getWest() / STEP) * STEP;
    const east = Math.floor(bounds.getEast() / STEP) * STEP;
    const south = Math.floor(bounds.getSouth() / STEP) * STEP;
    const north = Math.floor(bounds.getNorth() / STEP) * STEP;

    const fetchTile = async (tLat, tLon) => {
        const url = `https://AndrewMulert.github.io/light_tiles/t_${tLat}_${tLon}.json`;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.warn( `Missing Tile: ${tLat}, ${tLon} at ${url}`);
                return null;
            }
            return await response.json();
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

        let localMax = 0;
        let topPoints = [];

        let distribution = { low: 0, cyan: 0, green: 0, yellow: 0, high: 0 };
        let pointsProcessed = 0;

        results.forEach(({data}) => {
            if (!data || !data.length) return;
            data.forEach(row => {
                const rowMax = Math.max(...row);
                if (rowMax > localMax) localMax = rowMax;
            });
        });

        results.forEach(({data, lat, lon}) => {
            if (!data || !data.length) return;
            const rows = data.length;
            const cols = data[0].length;
        
            let stride = currentZoom < 7 ? 3 : 1;
            stride = Math.max(1, stride);

            const NOISE_FLOOR = 1.0;
            const VISUAL_CEILING = Math.max(localMax, 65);

            for (let r = 0; r < rows; r += stride) {
                for (let c = 0; c < cols; c+= stride) {
                    const val = data[r][c];
                    if (val > localMax) localMax = val;

                    if (val <= NOISE_FLOOR) continue;
                    let assignedColor = "Unknown";

                    const latOffset = ((rows - 1 - r) / (rows - 1)) * STEP;
                    const lonOffset = (c / (cols - 1)) * STEP;

                    const pLat = lat + latOffset;
                    const pLon = lon + lonOffset;

                    const valLog = Math.log10(val);
                    const minLog = Math.log10(NOISE_FLOOR);
                    const maxLog = Math.log10(VISUAL_CEILING);

                    let linearIntensity = (valLog - minLog) / (maxLog - minLog);
                    linearIntensity = Math.max(0, Math.min(1, linearIntensity));
                    const gamma = currentZoom > 10 ? 1.0 : 1.3;

                    let finalIntensity = Math.pow(linearIntensity, gamma);

                    if (isNaN(finalIntensity)) continue;

                    if (finalIntensity > 0.90) { 
                        assignedColor = "White/Hotspot"; 
                        distribution.high++; 
                    } else if (finalIntensity > 0.75) { 
                        assignedColor = "Red/Orange"; 
                        distribution.yellow++; 
                    } else if (finalIntensity > 0.45) { 
                        assignedColor = "Yellow/Green"; 
                        distribution.green++; 
                    } else if (finalIntensity > 0.20) { 
                        assignedColor = "Cyan/Blue"; 
                        distribution.cyan++; 
                    } else { 
                        assignedColor = "Deep Blue"; 
                        distribution.low++; 
                    }

                    if (Math.random() > 0.995) {
                        console.group(`Point Diagnostic [Raw: ${val}]`);
                        console.log(`1. Raw Value: ${val}`);
                        console.log(`2. Log10: ${valLog.toFixed(3)} (Range: ${minLog.toFixed(2)} to ${maxLog.toFixed(2)})`);
                        console.log(`3. Linear Normalization (0-1): ${linearIntensity.toFixed(3)}`);
                        console.log(`4. Final Intensity: ${finalIntensity.toFixed(3)}`);
                        console.log(`5. Gradient Color Bracket: ${finalIntensity > 0.9 ? 'White' : finalIntensity > 0.7 ? 'Red' : 'Blue/Green'}`);
                        console.groupEnd();
                    }

                    if (isNaN(finalIntensity)) continue;

                    window.capturedMapData.push({
                        lat: Number(pLat.toFixed(4)),
                        lon: Number(pLon.toFixed(4)),
                        v: Number(val.toFixed(2)),
                        i: Number(finalIntensity.toFixed(4)),
                        color: assignedColor,
                        zoom: currentZoom
                    });

                    if (topPoints.length < 5 || val > topPoints[4].v) {
                        const pLat = lat + ((rows - 1 - r) / (rows - 1)) * STEP;
                        const pLon = lon + (c / (cols - 1)) * STEP;
                        topPoints.push({ lat: pLat.toFixed(4), lon: pLon.toFixed(4), v: val });
                        topPoints.sort((a, b) => b.v - a.v);
                        if (topPoints.length > 5) topPoints.pop();
                    }

                    if (!isNaN(finalIntensity) && finalIntensity > 0) {
                        heatPoints.push([pLat, pLon, Math.min(1.0, finalIntensity)]);
                    }

                    pointsProcessed++;
                }
            }
        });

        console.group(`🌌 DATA DIAGNOSTIC: Zoom ${currentZoom}`);
        console.log(`📡 Tiles: ${successfulTiles}/${tileCoords.length} | Local Max Brightness: ${localMax}`);
        console.table(topPoints);

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
            window.heatLayer = L.heatLayer(heatPoints, currentOptions).addTo(window.stellaMap);

            const canvas = window.heatLayer._canvas;
            if (canvas) {
                canvas.classList.add('stella-heat-layer')
            }
        }

        if (window.currentUser?.accessLevel >= 10) {
            console.log("💾 Triggering data export...");
            window.downloadCapturedData();
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

        const driveTime = prefs && prefs.maxDriveTime ? prefs.maxDriveTime : 60;
        const miles = (driveTime / 60) * 45;
        const meters = miles * 1609.34;

        if (isNaN(meters)) {
            console.error("🚨 Calculation Error: Radius is NaN", { driveTime, miles });
            return;
        }

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

window.downloadCapturedData = function() {
    /* Temporary Fix: window.currentUser = { accessLevel: 10 }; downloadCapturedData();*/
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const userAccess = isLocal ? 10 : (window.currentUser?.accessLevel || 0);

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
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log(`✅ Exported ${window.capturedMapData.length} points.`);
}