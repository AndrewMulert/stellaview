export const BASE_WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const CACHE_KEY = "stella_geo_cache";
const CACHE_DURATION = 60 * 60 * 1000;
const aqiCache = new Map();

function getLocalCache() {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
}

function setLocalCache(cache) {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

function cleanupOldCache() {
    const geoCache = getLocalCache();
    const now = Date();
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

    const cacheKey = `${lat.toFixed(1)}_${lon.toFixed(1)}_${days}`;

    if (aqiCache.has(cacheKey)) {
        return aqiCache.get(cacheKey);
    }

    const request = (async () => {
        const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=pm2_5&forecast_days=${days}`;
    
        try {
            const response = await fetch(url);
            
            if (response.status === 429) throw new Error("429");
            if (!response.ok) throw new Error("API_ERROR");
        
            const data = await response.json();
            return {success: true, hourly: data.hourly, timezone: data.timezone, source: 'live' };
        } catch (error) {
            console.error(`AQI ${error.message === '429' ? 'Rate Limited' : 'Failed'}: Using fallback.`);
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
        const timeout = setTimeout(() => controller.abort(), 4000);

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

export async function getNearbyDarkPlaces(lat, lon, maxDriveTime = 60, retries = 3) {
    const geoCache = getLocalCache();
    const radiusKm = driveTimeToRadius(maxDriveTime);

    const QUERY_VERSION = "v3.3_dynamic_radius";
    const cacheId = `${lat.toFixed(2)}|${lon.toFixed(2)}|${radiusKm.toFixed(0)}|${QUERY_VERSION}`;
    const cachedEntry = geoCache[cacheId];
    
    if (cachedEntry && (Date.now() - cachedEntry.timestamp < CACHE_DURATION)) {
        console.log("💾 Using cached StellaView map data for this region...");
        return cachedEntry.data;
    }
    
    const radiusMeters = radiusKm * 1000;

    const query = `[out:json][timeout:60];
    (
      nwr["leisure"~"nature_reserve"](around:${radiusMeters},${lat},${lon});
      nwr["boundary"~"national_park|protected_area|wilderness_area"](around:${radiusMeters},${lat},${lon});
      nwr["tourism"~"camp_site"](around:${radiusMeters},${lat},${lon});
      nwr["natural"~"peak|canyon"](around:${radiusMeters},${lat},${lon});
    );
    nwr._["lit"!~"yes"]["access"!~"private|no"]["landuse"!~"residential|industrial|commercial"];
    out center 150;`;

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

            const finalResults = data.elements.map(el => {
                const tags = el.tags || {};
                const name = (tags.name || "").toLowerCase();
                const landuse = (tags.landuse || "").toLowerCase();

                const privateKeywords = ["ranch", "farm", "estate", "residence", "private", "club", "driveway"];
                if (privateKeywords.some(word => name.includes(word))) return null;

                const isOfficial = /park|reserve|recreation|forest|monument|wilderness|area/i.test(name) || 
                    tags.leisure === "nature_reserve" || 
                    tags.boundary === "protected_area";

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
            console.error(`Attempt ${i+1} failed:`, e);
            if (i === retries - 1) {
                const loader = document.getElementById('ai-loader');
                const statusText = document.getElementById('ai-status-text');

                loader.classList.remove('hidden');
                const spinner = loader.querySelector(".spinner");
                if (spinner) spinner.classList.add('hidden');
                if (statusText) {
                    statusText.innerText = "❌ Request failed. Please refresh and try again.";
                }
                setTimeout(() => {
                    loader.classList.add('hidden')

                    if (spinner) spinner.classList.remove('hidden');
                }, 3000);
                console.error("❌ OSM Fetch failed after retries:", e);
                statusText.innerText = "⚠️ Weather Call Failed. Try Again";
                return [];
            }
        }
    }
    return [];
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

export async function getMeanTemperature(lat, lon){
    try {
        const avgTempUrl = `${BASE_WEATHER_URL}?latitude=${lat}&longitude=${lon}&daily=temperature_2m_mean&timezone=auto&forecast_days=1`;
        const avgRes = await fetch(avgTempUrl);

        if (avgRes.status === 429) {
            console.warn("Rate limited by Open-Meteo. Falling back.");
            return null;
        }

        const avgData = await avgRes.json();

        if (avgData?.daily?.temperature_2m_mean) {
            return avgData.daily.temperature_2m_mean[0];
        }
        return null;
    } catch (error) {
        console.error("Mean Temp API Error:", error);
        return null;
    }
}

function driveTimeToRadius(minutes) {
    return (minutes / 60) * 60 * 1.60934;
}

cleanupOldCache();