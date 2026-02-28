const BASE_WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

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

    const query = `[out:json][timeout:30];
    (
        nwr["leisure"~"nature_reserve|park"](around:${radiusMeters},${lat},${lon});
        nwr["boundary"~"national_park|protected_area"](around:${radiusMeters},${lat},${lon});
  
        nwr["tourism"="viewpoint"]["access"!~"private|no"](around:${radiusMeters},${lat},${lon});
  
        nwr["natural"="peak"]["access"!~"private|no"](around:${radiusMeters},${lat},${lon});
    );
    nwr._["landuse"!~"residential|farmyard|construction"];
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

                const privateKeywords = ["ranch", "farm", "estate", "residence", "private", "club", "driveway"];
                if (privateKeywords.some(word => name.includes(word))) return null;

                const isOfficial = /park|reserve|recreation|forest|monument|wilderness|area/i.test(name) || tags.leisure === "nature_reserve" || tags.boundary === "protected_area";

                const blacklist = ["landfill", "waste", "dump", "quarry", "treatment", "industrial", "prison"];

                if (blacklist.some(word => name.includes(word) || landuse.includes(word))) return null;

                if (isOfficial) console.log(`⭐ Official Site Verified: ${tags.name}`);

                return {
                    name: tags.name || "Remote Dark Spot",
                    lat: el.lat || (el.center ? el.center.lat : null),
                    lon: el.lon || (el.center ? el.center.lon : null),
                    type: tags.leisure || tags.natural || "park",
                    trustFactor: isOfficial ? 1.0: 0.5
                };
            }).filter(site => site && site.lat && site.lon);

        } catch (e) {
            if (i === retries - 1) {
                const loader = document.getElementById('ai-loader');
                const statusText = document.getElementById('ai-status-text');

                loader.classList.remove('hidden');
                const spinner = loader.querySelector(".spinner");
                if (spinner) spinner.classList.add('hidden');
                statusText.innerText = "❌ Request failed. Please refresh and try again.";
                setTimeout(() => {
                    loader.classList.add('hidden')

                    if (spinner) spinner.classList.remove('hidden');
                }, 3000);
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