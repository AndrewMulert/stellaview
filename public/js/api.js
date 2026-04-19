export const BASE_WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const CACHE_KEY = "stella_geo_cache";
const CACHE_DURATION = 60 * 60 * 1000;
const aqiCache = new Map();
const delay = ms => new Promise(res => setTimeout(res, ms));
const weatherCache = new Map();

let globalMeanTempCache = null;
let meanTempPromise = null;
let apiQueue = Promise.resolve();
let weatherQueue = Promise.resolve();

function getLocalCache() {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
}

function setLocalCache(cache) {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

function snap(coord) {
    return parseFloat(coord.toFixed(2));
}

function driveTimeToRadius(minutes) {
    return minutes * 1.60934; 
}

function cleanupOldCache() {
    const geoCache = getLocalCache();
    const now = Date.now();
    const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
    let changed = false;
    for (const key in geoCache) {
        if (now - geoCache[key].timestamp > MAX_AGE) {
            delete geoCache[key];
            changed = true;
        }
    }
    if (changed) setLocalCache(geoCache);
}

async function queuedWeatherFetch(url, options = {}) {
    weatherQueue = weatherQueue.then(async () => {
        await delay(100);
        return fetch(url, options);
    });
    return weatherQueue;
}

export async function geocode(query) {
    if (!query) return null;
    try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
        const response = await fetch(url, { headers: { 'User-Agent': 'StellaView-App'} });
        const data = await response.json();

        if (data && data.length > 0) {
            return {
                lat: parseFloat(data[0].lat),
                lon: parseFloat(data[0].lon),
                label: data[0].display_name
            };
        }
    } catch (err) {
        console.error("Geocoding failed:", err);
    }
    return null;
}

export async function getAirQuality(lat, lon, days = 7) {
    if (lat === undefined || lon === undefined) {
        console.error("❌ getAirQuality blocked: lat/lon is undefined");
        return {success: false, reason: "missing_coords"};
    }

    const cacheKey = `${snap(lat)}_${snap(lon)}_${days}`;
    if (aqiCache.has(cacheKey)) {
        return aqiCache.get(cacheKey);
    }

    const request = (async () => {
        const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${snap(lat)}&longitude=${snap(lon)}&hourly=pm2_5&forecast_days=${days}`;
    
        try {
            const response = await queuedWeatherFetch(url);
            if (response.status === 429) throw new Error("429");
            if (!response.ok) throw new Error("AQI_API_FAIL");
            const data = await response.json();
            return {success: true, hourly: data.hourly, timezone: data.timezone, source: 'live' };
        } catch (error) {
            return {success: true, fallback: true, hourly: { pm2_5: new Array(168).fill(5), source: 'fallback' } };
        };
    })();
    aqiCache.set(cacheKey, request);
    return request;
}

export async function getDrivingDistance(coordinates) {
    const url = `https://router.project-osrm.org/table/v1/driving/${coordinates}?sources=0`;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        const data = await response.json();
        if (data.code !== 'Ok') throw new Error("OSRM_FAIL");

        return data.durations[0].slice(1).map(seconds => seconds / 60);
    } catch (e) {
        console.warn("OSRM Failed or Timed Out. Triggering local estimation fallback.");
        return null;
    }
};

export async function getNearbyDarkPlaces(lat, lon, maxDriveTime = 60) {
    const geoCache = getLocalCache();
    const radiusKm = driveTimeToRadius(maxDriveTime);
    const radiusMeters = radiusKm * 1000;
    const cacheId = `${lat.toFixed(2)}|${lon.toFixed(2)}|${radiusKm.toFixed(0)}|v3.3_dynamic_radius`;
    
    if (geoCache[cacheId] && (Date.now() - geoCache[cacheId].timestamp < CACHE_DURATION)) {
        console.log("💾 Using cached StellaView map data for this region...");
        return geoCache[cacheId].data;
    }

    const query = `[out:json][timeout:50];
    (
        nwr["leisure"~"nature_reserve"](around:${radiusMeters},${lat},${lon});
        nwr["boundary"~"national_park|protected_area|wilderness_area"](around:${radiusMeters},${lat},${lon});
        nwr["tourism"~"camp_site"](around:${radiusMeters},${lat},${lon});
        nwr["natural"~"peak|canyon"](around:${radiusMeters},${lat},${lon});
    );
    out center 150;`;

    const mirrors = [
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass-api.de/api/interpreter",
        "https://lz4.overpass-api.de/api/interpreter"
    ];

    let data = null;
    for (const baseUrl of mirrors) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 55000);

            const res = await fetch(`${baseUrl}?data=${encodeURIComponent(query)}`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (res.ok) {
                data = await res.json();
                break;
            }
        } catch (err) {
            console.warn(`Mirror ${baseUrl} failed or timed out, trying next...`);
       }
    }
            
    if (!data) {
        console.error(`All Overpass mirrors failed.`);
        const loader = document.getElementById('ai-loader');
        const statusText = document.getElementById('ai-status-text');
        if (loader) loader.classList.remove('hidden');
        if (statusText) statusText.innerText = "❌ Request failed. Please refresh.";
        return [];
    }

    try {
        const finalResults = data.elements.map(el => {
            const tags = el.tags || {};

            const forbiddenLanduse = ["residential", "industrial", "commercial"].includes(tags.landuse);
            const privateAccess = ["private", "no"].includes(tags.access);
            const isLit = tags.lit === "yes";

            if (forbiddenLanduse || privateAccess || isLit) return null;

            const name = (tags.name || "").toLowerCase();
            const landuse = (tags.landuse || "").toLowerCase();

            const privateKeywords = ["ranch", "farm", "estate", "residence", "private", "club", "driveway"];
            if (privateKeywords.some(word => name.includes(word))) return null;

            const isHistoricDistrict = name.includes("historic district") || name.includes("townsite");
            const isOfficial = !isHistoricDistrict && (
                /park|reserve|recreation|forest|monument|wilderness|area/i.test(name) || 
                tags.leisure === "nature_reserve" || 
                tags.boundary === "protected_area"
            );

            const blacklist = ["landfill", "waste", "dump", "quarry", "treatment", "industrial", "prison"];

            const urbanKeywords = ["tennis", "soccer", "baseball", "playground", "skate", "complex", "stadium", "memorial", "elementary", "high school"];

            if (blacklist.some(word => name.includes(word) || landuse.includes(word))) return null;

            if (urbanKeywords.some(word => name.includes(word) || landuse.includes(word))) return null;

            if (isOfficial) console.log(`⭐ Official Site Verified: ${tags.name || "Unnamed Protected Area"}`);

            return {
                name: tags.name || "Remote Dark Spot",
                lat: el.lat || (el.center ? el.center.lat : null),
                lon: el.lon || (el.center ? el.center.lon : null),
                type: tags.leisure || tags.natural || "park",
                trustFactor: isOfficial ? 1.5: 0.5
            };
        }).filter(site => site && site.lat && site.lon);

        if (finalResults.length > 0) {
            geoCache[cacheId] = {
                timestamp: Date.now(),
                data: finalResults
            };
            setLocalCache(geoCache);
        }

        const sortedResults = finalResults.sort((a, b) => {
            if (b.trustFactor !== a.trustFactor) return b.trustFactor - a.trustFactor;
            if (a.name === "Remote Dark Spot" && b.name !== "Remote Dark Spot") return 1;
            if (a.name !== "Remote Dark Spot" && b.name === "Remote Dark Spot") return -1;
            return 0;
        });
        
        return sortedResults;
    } catch (e) {
        console.error("Error processing dark place data:", e);
        return [];
    }
}

export async function getWeatherData(lat, lon, days = 1, fahrenheit = true, attempts = 3) {
    if (lat === undefined || lon === undefined) {
        console.error("❌ getWeatherData blocked: lat/lon is undefined");
        return null;
    }

    const cacheKey = `${snap(lat)}_${snap(lon)}_${days}_${fahrenheit}`;
    if (weatherCache.has(cacheKey)) {
        return weatherCache.get(cacheKey);
    }

    const unit = fahrenheit ? "&temperature_unit=fahrenheit" : "";
    const url = `${BASE_WEATHER_URL}?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,cloud_cover&forecast_days=${days}&timezone=GMT${unit}`;

    
    try {
        const response = await queuedWeatherFetch(url);
        if (!response.ok) throw new Error("Weather API failed");
        const data = await response.json();
        weatherCache.set(cacheKey, data);
        return data;
    } catch (err) {
        return null;
    }
}

export async function getMeanTemperature(lat, lon){
    const regionalKey = `${lat.toFixed(1)}_${lon.toFixed(1)}`;
    
    if (globalMeanTempCache?.key === regionalKey) return globalMeanTempCache.value;
    if (meanTempPromise) return meanTempPromise;

    meanTempPromise = (async () => {
        try {
            const url = `${BASE_WEATHER_URL}?latitude=${lat.toFixed(1)}&longitude=${lon.toFixed(1)}&daily=temperature_2m_mean&timezone=auto&forecast_days=1`;
            const res = await queuedWeatherFetch(url);
            const data = await res.json();
            const val = data?.daily?.temperature_2m_mean?.[0] || null;

            globalMeanTempCache = { key: regionalKey, value: val };
            return val;
        } catch (error) {
            console.error("Mean Temp API Error:", error);
            return null;
        } finally {
            meanTempPromise = null;
        }
    })();
    return meanTempPromise;
}

cleanupOldCache();