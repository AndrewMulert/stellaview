const BASE_WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

export async function getAirQuality(lat, lon, days = 7) {
    if (lat === undefined || lon === undefined) {
        console.error("❌ getAirQuality blocked: lat/lon is undefined");
        return {success: false, reason: "missing_coords"};
    }

    const safeDays = Math.min(days, 7);
    
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=pm2_5&forecast_days=${safeDays}`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("AQI API Error");
        const data = await response.json();

        return {success: true, hourly: data.hourly, timezone: data.timezone };
    } catch (error) {
        console.error("AQI API failed, using pristine air fallback.", error);
        return {success: true, fallback: true, hourly: { pm2_5: new Array(168).fill(5) } };
    }
}

export async function getBortleFromRadiance(lat, lon){
    
    return radianceAlgorithm(lat, lon);
}

export async function getDrivingDistance(coordinates) {
    const url = `https://router.project-osrm.org/table/v1/driving/${coordinates}?sources=0`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.code !== 'Ok') return null;

        return data.durations[0].slice(1).map(seconds => seconds / 60);
    } catch (e) {
        console.error("OSRM Error:", e);
        return null;
    }
}

export async function getNearbyDarkPlaces(lat, lon, radiusKm, retries = 3) {
    const radiusMeters = radiusKm * 1000;

   const query = `[out:json][timeout:60];
(
  // 1. Natural high points and wilderness areas
  nwr["natural"~"peak|volcano|plateau|ridge|dune"](around:${radiusMeters},${lat},${lon});
  nwr["leisure"="nature_reserve"](around:${radiusMeters},${lat},${lon});
  
  // 2. Scenic viewpoints (often remote)
  nwr["tourism"="viewpoint"](around:${radiusMeters},${lat},${lon});
);
// Filter out features specifically tagged with urban landuse
nwr._["landuse"!~"residential|industrial|commercial|construction"];
out center 40;`;

    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url);
            
            if (response.status === 504 || response.status === 429) {
                const waitTime = (i + 1) * 2000;
                console.warn(`🔄 Overpass busy. Retry ${i+1}/${retries} in ${waitTime}ms...`);
                await new Promise(res => setTimeout(res, waitTime));
                continue; 
            }

            if (!response.ok) throw new Error("OSM Network Response Error");
            
            const data = await response.json();

            return data.elements.map(el => {
                const tags = el.tags || {};
                const name = (tags.name || "").toLowerCase();
                const landuse = (tags.landuse || "").toLowerCase();
                const latVal = el.lat || (el.center ? el.center.lat : null);
                const lonVal = el.lon || (el.center ? el.center.lon : null);

                const blacklist = ["landfill", "waste", "dump", "quarry", "treatment", "industrial", "prison"];

                const isSketchy = blacklist.some(word => name.includes(word) || landuse.includes(word));

                if (isSketchy) return null

                return {
                    name: el.tags.name || "Remote Dark Spot",
                    lat: latVal,
                    lon: lonVal,
                    type: el.tags.leisure || el.tags.natural || "park",
                    bortle: 4
                };
            }).filter(site => site.lat && site.lon);

        } catch (e) {
            if (i === retries - 1) {
                console.error("❌ OSM Fetch failed after retries:", e);
                return [];
            }
        }
    }
}

export async function getWeatherData(lat, lon, days = 1, fahrenheit = true) {
    if (lat === undefined || lon === undefined) {
        console.error("❌ getWeatherData blocked: lat/lon is undefined");
        return null;
    }
    const unit = fahrenheit ? "&temperature_unit=fahrenheit" : "";
    const url = `${BASE_WEATHER_URL}?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,cloud_cover&forecast_days=${days}&timezone=GMT${unit}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error("Weather API failed");
    return await response.json();
}

let cachedVegManifest = null;

/**
 * Loads the list of available NASA tiles from GitHub.
 */
async function loadVegManifest() {
    if (cachedVegManifest) return cachedVegManifest;
    try {
        const response = await fetch('https://AndrewMulert.github.io/vegetation_tiles/manifest.json');
        const data = await response.json();
        cachedVegManifest = data.available_tiles || data.tiles || [];
        return cachedVegManifest;
    } catch (e) {
        console.error("NDVI Manifest load failed:", e);
        return [];
    }
}

/**
 * Converts lat/lon to NASA NDVI values (-0.2 to 1.0)
 * Scaled for Stella's brain to use as a "nature" score.
 */
export async function getNDVI(lat, lon) {
    if (lat === undefined || lon === undefined) return 0.01;

    const manifest = await loadVegManifest();

    // 1. Convert to NASA Sinusoidal Grid (10-degree tiles)
    const h = Math.floor((lon + 180) / 10);
    const v = Math.floor((90 - lat) / 10);
    const tileId = `h${h.toString().padStart(2, '0')}v${v.toString().padStart(2, '0')}`;

    // 2. Check if we have data for this part of the world
    if (!manifest.includes(tileId)) {
        return 0.01; // Fallback for ocean/missing tiles
    }

    try {
        const url = `https://AndrewMulert.github.io/vegetation_tiles/tiles/${tileId}.json`;
        const response = await fetch(url);
        if (!response.ok) return 0.01;

        const tileObj = await response.json();
        const grid = tileObj.data; // The 2D array from processing

        const rows = grid.length;
        const cols = grid[0].length;

        // 3. Map lat/lon to specific pixel in the 10x10 degree tile
        // latPct: 0 at top (north), 1 at bottom (south)
        // lonPct: 0 at left (west), 1 at right (east)
        const latPct = ((90 - lat) % 10) / 10;
        const lonPct = ((lon + 180) % 10) / 10;

        const row = Math.floor(latPct * (rows - 1));
        const col = Math.floor(lonPct * (cols - 1));

        const safeRow = Math.max(0, Math.min(rows - 1, row));
        const safeCol = Math.max(0, Math.min(cols - 1, col));

        // 4. Return scaled value
        // NASA NDVI is stored as Int (e.g. 5000) with 0.0001 scale
        const rawValue = grid[safeRow][safeCol];
        const ndvi = rawValue * 0.0001;
        console.log(`Checking Tile: ${tileId} | Pixel Row: ${safeRow} | Pixel Col: ${safeCol}`);
        // Return value clamped for AI (don't want negatives breaking weights)
        return Math.max(0.01, ndvi);

    } catch (error) {
        console.error("NDVI Fetch error:", error);
        return 0.01;
    }
}