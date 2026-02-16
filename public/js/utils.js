import * as api from "./api.js";

export function calculateDriveTime(loc1, loc2) {
    const R = 3958.8;
    const dLat = (loc2.lat - loc1.lat) * Math.PI / 180;
    const dLon = (loc2.lon - loc1.lon) * Math.PI /180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(loc1.lat * Math.PI / 180) * Math.cos(loc2.lat * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distanceMiles = R * c;

    return (distanceMiles / 45) * 60;
}

export async function getActualDriveTimes(userLoc, sites) {
    const coordinates = `${userLoc.lon},${userLoc.lat};` + sites.map(s => `${s.lon},${s.lat}`).join(';');
    const data = await api.getDrivingDistance(coordinates);
    return data;
}

export function calculateFahrenheit(temp) {
    const fahrenheit = (temp * 9/5) + 32;
    return fahrenheit;
}

function normalizeTempContextual(currentTemp, minPref, maxPref, monthlyAvg) {
    if (currentTemp < minPref || currentTemp > maxPref) return 0.0;

    const contextualIdeal = (monthlyAvg + 68) /2;

    const sigma = (maxPref - minPref) / 4;
    const score  = Math.exp(-Math.pow(currentTemp - contextualIdeal, 2) / (2 * Math.pow(sigma, 2)));

    return score;
}

export function normalizeInputs(radiance, site, weather, moonIllum, travelTime, prefs, aqiStatus, startOffset, siteNDVI) {
    if (travelTime > prefs.maxDriveTime) return null;
    
    const logRad = Math.log10(radiance + 1);
    const normRadiance = Math.max(0, 1 - (logRad / 2.5));

    let normNDVI = 0.8;
    if (siteNDVI > 0.85) normNDVI = 0.1;
    else if (siteNDVI < 0.1) normNDVI = 0.4;
    else normNDVI = 1.0;

    const cloudVal = weather.avgClouds ?? weather.clouds ?? 100; 
    const normClouds = Math.max(0, (100 - cloudVal) / 100);

    const normStart = Math.max(0, 1 -(startOffset / 12));

    const duration = weather.duration || 0;
    const normDuration = duration <= 1 ? 0 : Math.min((duration -1) / 5, 1);

    const pm25Raw = aqiStatus?.pm25;
    const safePm25 = (typeof pm25Raw !== 'number' || isNaN(pm25Raw)) ? 10 : pm25Raw;
    const normAQI = Math.max(0, (100 - safePm25) / 100);

    const mIllum = (moonIllum !== undefined) ? moonIllum : 1.0;
    const normMoon = Math.pow(1 - mIllum, 2);

    const currentTempF = (prefs.tempUnit === 'celsius') ? calculateFahrenheit(weather.avgTemp) : weather.avgTemp;
    
    const monthlyAvg = weather.monthlyAvg || 40;
    const normTemp =  normalizeTempContextual(currentTempF, prefs.minTemp, prefs.maxTemp, monthlyAvg);

    const normPublic =  (site.rating !== undefined) ? site.rating / 5 : 0.5;
    const normUser = (site.userRating !== undefined) ? site.userRating / 5 : 0.5;

    const normTravel = Math.max(0, 1 - (travelTime / 120));

    return [normRadiance, normNDVI, normClouds, normAQI, normMoon, normTemp, normPublic, normUser, normTravel, normDuration, normStart];
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

export function radianceToBortle(radiance) {
    if (radiance <= 0.1) return 1;

    const calculatedBortle = 3.3 * (Math.log10(radiance) + 0.5);

    return Math.max(1, Math.min(9, Math.round(calculatedBortle)));
}

export function getMoonIllumination(date) {
    const referenceNewMoon = new Date('2024-01-11T11:57:00Z');
    const msPerDay = 86400000;
    const daysSince = (date - referenceNewMoon) / msPerDay;
    const cyclePos = (daysSince % 29.53059) / 29.53059;

    return Math.abs(Math.sin(cyclePos * Math.PI));
}

export async function getVegManifest() {
    const response = await fetch('https://andrewmulert.github.io/vegetation_tiles/manifest.json');
    const data = await response.json();
    return data.available_tiles;
}

export async function getNDVIValue(lat, lon, manifestTiles) {
    const h = Math.floor((lon + 180) / 10); 
    const v = Math.floor((90 - lat) / 10);
    
    const tileId = `h${h.toString().padStart(2, '0')}v${v.toString().padStart(2, '0')}`;

    if (!manifestTiles.includes(tileId)) {
        return 0;
    }

    try {
        const url = `https://andrewmulert.github.io/vegetation_tiles/tiles/${tileId}.json`;
        const response = await fetch(url);
        if (!response.ok) return 0;

        const tileData = await response.json();
        const grid = tileData.data;

        const rows = grid.length;
        const cols = grid[0].length;

        const latInTile = (90 - lat) % 10;
        const lonInTile = (lon + 180) % 10;

        const row = Math.floor((latInTile / 10) * (rows - 1));
        const col = Math.floor((lonInTile / 10) * (cols - 1));

        const safeRow = Math.max(0, Math.min(rows - 1, row));
        const safeCol = Math.max(0, Math.min(cols - 1, col));

        const rawValue = grid[safeRow][safeCol];

        return rawValue * 0.0001; 

    } catch (error) {
        console.error("NDVI fetch error:", error);
        return 0;
    }
}

export async function getNDVI(lat, lon) {
    try {
        const response = await fetch('/js/data/veg_data_idaho.json');
        if (!response.ok) throw new Error("Local data unavailable");
        
        const vegData = await response.json();
        const { metadata, data } = vegData;

        const inBounds = lat >= metadata.lat_min && lat <= metadata.lat_max && 
                         lon >= metadata.lon_min && lon <= metadata.lon_max;

        if (inBounds) {
            const row = Math.floor(((metadata.lat_max - lat) / (metadata.lat_max - metadata.lat_min)) * (metadata.rows - 1));
            const col = Math.floor(((lon - metadata.lon_min) / (metadata.lon_max - metadata.lon_min)) * (metadata.cols - 1));
            
            let val = data[row]?.[col];
            
            if (val !== undefined && val !== 0) {
                let normalizedVal = val > 10000 ? val / 1000000000000 : (val > 1 ? val / 10000 : val);
                
                return Math.max(0, Math.min(1, normalizedVal));
            }
        }

        return 0.22;

    } catch (err) {
        console.warn("NDVI Lookup failed, using safety fallback.");
        return 0.22; 
    }
}