export function calculateDriveTime(loc1, loc2) {
    const R = 3958.8;
    const dLat = (loc2.lat - loc1.lat) * Math.PI / 180;
    const dLon = (loc2.lon - loc1.lon) * Math.PI /180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(loc1.lat * Math.PI / 180) * Math.cos(loc2.lat * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distanceMiles = R * c;

    return (distanceMiles / 45) * 60;
}

export function calculateFahrenheit(temp) {
    const fahrenheit = (temp * 9/5) + 32;
    return fahrenheit;
}

function normalizeTempContextual(currentTemp, minPref, maxPref, monthlyAvg) {
    if (currentTemp < minPref || currentTemp > maxPref) return 0.0;

    const contextualIdeal = (monthlyAvg + 68) /2;

    const range = (maxPref - minPref) / 2;
    const diff = Math.abs(currentTemp - contextualIdeal);

    return Math.max(0, 1 - (diff / range));
}

export function normalizeInputs(radiance, site, weather, moonIllum, travelTime, prefs, aqiStatus) {
    const logRad = Math.log10(radiance + 1);
    const normRadiance = Math.max(0, 1 - (logRad / 2.5));

    const cloudVal = weather.avgClouds ?? weather.clouds ?? 100; 
    const normClouds = Math.max(0, (100 - cloudVal) / 100);

    const pm25Raw = aqiStatus?.pm25;
    const safePm25 = (typeof pm25Raw !== 'number' || isNaN(pm25Raw)) ? 10 : pm25Raw;
    const normAQI = Math.max(0, (100 - safePm25) / 100);

    const mIllum = (moonIllum !== undefined) ? moonIllum : 1.0;
    const normMoon = (1 - mIllum);

    const currentTempF = (prefs.tempUnit === 'celsius') ? calculateFahrenheit(weather.avgTemp) : weather.avgTemp;
    
    const monthlyAvg = weather.monthlyAvg || 40;
    const normTemp =  normalizeTempContextual(currentTempF, prefs.minTemp, prefs.maxTemp, monthlyAvg);

    const normPublic =  (site.rating !== undefined) ? site.rating / 5 : 0.5;
    const normUser = (site.userRating !== undefined) ? site.rating / 5 : 0.5;

    const normTravel = Math.max(0, 1 - (travelTime / 300));

    return [normRadiance, normClouds, normAQI, normMoon, normTemp, normPublic, normUser, normTravel];
}

export async function getRadianceValue(lat, lon, manifestTiles) {
    const STEP = 5;

    const latTile = Math.floor(lat / STEP) * STEP;
    const lonTile = Math.floor(lon / STEP) * STEP;
    const tileId = `${latTile}_${lonTile}`;

    if (!manifestTiles.includes(tileId)) {
        return 0.01;
    }

    try {
        const url = `https://AndrewMulert.github.io/light_tiles/t_${tileId}.json`;
        const response = await fetch(url);
        if (!response.ok) return 0.01;

        const gridData = await response.json();

        const rows = gridData.length;
        const cols = gridData[0].length;

        const latPct = 1 - ((lat - latTile) / STEP);
        const lonPct = (lon - lonTile) / STEP;

        const row = Math.floor(latPct * (rows - 1));
        const col = Math.floor(lonPct * (cols - 1));

        const safeRow = Math.max(0, Math.min(rows - 1, row));
        const safeCol = Math.max(0, Math.min(cols - 1, col));

        return gridData[safeRow][safeCol];
    } catch (error){
        console.error("Radiance fetch error:", error);
        return 0.01;
    }
}

export function bortleToRadiance(bortle) {
    if (bortle <= 1) return 0.1;
    return parseFloat(Math.pow(10, (bortle / 3.3) - 0.5).toFixed(2));
}

export function getMoonIllumination(date) {
    const referenceNewMoon = new Date('2024-01-11T11:57:00Z');
    const msPerDay = 86400000;
    const daysSince = (date - referenceNewMoon) / msPerDay;
    const cyclePos = (daysSince % 29.53059) / 29.53059;

    return Math.abs(Math.sin(cyclePos * Math.PI));
}