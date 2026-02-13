const BASE_WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

export async function getAirQuality(lat, lon) {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=pm2_5&forecast_days=1`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("AQI API Error");
        const data = await response.json();

        return {success: true, pm25: data.hourly.pm2_5[0]};
    } catch (error) {
        console.error("AQI API failed:", error);
        return {success: true, pm25: 10, fallback: true };
    }
}

export async function getBortleFromRadiance(lat, lon){
    
    return radianceAlgorithm(lat, lon);
}

export async function getNearbyDarkPlaces(lat, lon, radiusKm) {
    const radiusMeters = radiusKm * 1000;

    const query = `[out:json][timeout:60];
    (
        nwr["boundary"~"national_park|wilderness_area"](around:40000,${lat},${lon});
        nwr["natural"~"peak|plateau"](around:40000,${lat},${lon});
        nwr["landuse"="conservation"](around:40000,${lat},${lon});
    );
    out center 20;`;

    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

    try{
        const response = await fetch(url);
        if (!response.ok) throw new Error("OSM Network Response Error");
        const data = await response.json();

        return data.elements.map(el => {
            const latVal = el.lat || (el.center ? el.center.lat : null);
            const lonVal = el.lon || (el.center ? el.center.lon : null);

            return {
                name: el.tags.name || "Remote Dark Spot",
                lat: latVal,
                lon: lonVal,
                type: el.tags.leisure || el.tags.natural || "park",
                bortle: 4
            };
        }).filter(site => site.lat && site.lon);
    } catch (e) {
        console.error("Failed to fetch OSM sites:", e);
        return [];
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