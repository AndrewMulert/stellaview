import SunCalc from "https://esm.sh/suncalc@1.9.0";
import { calculateDriveTime, calculateFahrenheit, getNDVI, getRadianceValue} from './utils.js';
import * as api from './api.js';
import { predictWithBrain } from "./brain.js";

/**
* @param {Object} site
* @param {Object} weatherStatus
* @param {number} travelTime
* @param {Object} prefs 
* @param {number} moonIllum
* @param {Object} aqiStatus
*/

function calculateScore(site, weatherStatus, travelTime, moonIllum, prefs, aqiStatus = null, radiance = 0, ndvi = 0, moonIsUpNow) {
    const tempUnit = prefs?.tempUnit || 'fahrenheit';
    const minTemp = prefs?.minTemp || 40;
    const maxTemp = prefs?.maxTemp || 90;
    const maxDrive = prefs?.maxDriveTime || 120;
    
    let currentTemp = weatherStatus.avgTemp;
    if (tempUnit === 'celsius') {
        currentTemp = calculateFahrenheit(currentTemp);
    }

    const darknessScore = Math.max(0, 10 - (Math.log1p(radiance) * 2.5));
    const pm25 = aqiStatus ? aqiStatus.pm25 : 10;
    const hazePenalty = Math.max(0, (pm25 - 10) / 5);

    const idealTemp = (minTemp + maxTemp) / 2;
    const tempDiff = Math.abs(currentTemp - idealTemp);
    const comfortPenalty = tempDiff * 0.15;

    const distancePenalty = (travelTime / maxDrive) * 5;
    const moonPenalty = moonIsUpNow ? (Math.pow(moonIllum, 2) * 15) : 0;
    const natureBonus = ndvi * 2;

    const finalScore = (darknessScore - hazePenalty - comfortPenalty - distancePenalty - moonPenalty + natureBonus);
    const percentage = Math.max(0, Math.min(100, (finalScore / 10) * 100));
    return percentage.toFixed(1);
}

export async function findBestSites(date, userLocation, allDarkSites, prefs) {
    const weeklyContainer = document.querySelector("#weekly-outlook");
    if (weeklyContainer) weeklyContainer.classList.add('hidden');

    /*A running talley of why locations may fail to determine the overall reason for failure*/
    let failureCounts = { clouds: 0, cold: 0, hot: 0, moon: 0, aqi: 0};
    console.log("Starting engine with", allDarkSites.length, "sites.");


    const decisionSpan = document.querySelector("#hero_decision");
    if (decisionSpan) decisionSpan.textContent = "Beginning our search, unfolding the map...";

    let latestStay = prefs.latestStayOut || "04:00";
    let timeStr = latestStay.toString();

    if (!timeStr.includes(':')) {
        latestStay = `${timeStr.padStart(2, '0')}:00`;
    }

    const times = SunCalc.getTimes(date, userLocation.lat, userLocation.lon);
    let startOfNight = times.night;
    const now = new Date();
    let windowEndTime = times.nightEnd;

    if (now > startOfNight && now < windowEndTime){
        startOfNight = now;
    }

    if (latestStay.includes(':')) {
        const [h, m] = latestStay.split(':');
        windowEndTime = new Date(date);
        windowEndTime.setHours(parseInt(h), parseInt(m), 0);
        if (parseInt(h) < 12) windowEndTime.setDate(windowEndTime.getDate() + 1);
    }

    const moonIllum = SunCalc.getMoonIllumination(date).fraction;
    const moonTimes = SunCalc.getMoonTimes(date, userLocation.lat, userLocation.lon);

    const moonPosNow = SunCalc.getMoonPosition(now, userLocation.lat, userLocation.lon);
    const moonIsUpNow = moonPosNow.altitude > 0;

    
    if (moonIllum > 0.8 && (moonIsUpNow || moonTimes.alwaysUp)){
        console.log(`❌ GLOBAL FAIL: Moon is ${Math.round(moonIllum * 100)}% bright and visible.`);
        return { sites: [], topFailure: 'moon' };
    }

    const [lightRes, vegRes] = await Promise.all([
        fetch('https://andrewmulert.github.io/light_tiles/manifest.json'),
        fetch('https://AndrewMulert.github.io/vegetation_tiles/manifest.json')
    ]);
    const lightTiles = (await lightRes.json()).tiles;
    const vegTiles = (await vegRes.json()).tiles || (await vegRes.json()).available_tiles;

    const results = await Promise.all(allDarkSites.map(async (site) => {
        const travelTime = calculateDriveTime(userLocation, site);


        if (travelTime > prefs.maxDriveTime || 120){
            console.log(`  -> Filtered: Drive too long (${Math.round(travelTime)} > ${prefs.maxDriveTime})`);
            return null;
        };

        const [weatherStatus, aqiStatus, radiance, ndvi] = await Promise.all([checkWeatherWindow(site, startOfNight, windowEndTime, prefs), checkAirQuality(site), getRadianceValue(site.lat, site.lon, lightTiles), getNDVI(site.lat, site.lon, vegTiles)]);
        console.log(`Site: ${site.name} | Rad: ${radiance} | NDVI: ${ndvi}`);

        if (radiance > (prefs.maxBortle || 5)){
            console.log(`  -> Filtered: Too much light pollution (${radiance} > ${prefs.maxBortle})`);
            return null;
        };

        if (weatherStatus.success && aqiStatus.success) {
            const moonPos = SunCalc.getMoonPosition(weatherStatus.bestTime, site.lat, site.lon);
            const moonDeg = moonPos.altitude *(180 / Math.PI);

            if (moonIllum > 0.2 && moonDeg > 0) {
                console.log(`❌ FAIL ${site.name}: Moon is ${Math.round(moonIllum * 100)}% bright and visible.`);
                failureCounts.moon++;
                return null;
            }

            console.log(`  => SUCCESS: ${site.name} passed all checks.`);

            const isMoonActuallyVisible = moonDeg > 0;

            const score = calculateScore(site, weatherStatus, travelTime, moonIllum, prefs, aqiStatus, radiance, ndvi, isMoonActuallyVisible);

            return { ...site, travelTime: Math.round(travelTime), score: score, bestTime: weatherStatus.bestTime, duration: weatherStatus.duration, avgTemp: weatherStatus.avgTemp, avgClouds: weatherStatus.avgClouds, radiance: radiance, ndvi: ndvi};
        } else {
            const reason = !weatherStatus.success ? weatherStatus.reason : 'aqi';
            console.log(`  -> Filtered: ${reason} constraints failed.`);
            failureCounts[reason]++;
            return null;
        }
    }));

    const finalSites = results.filter(site => site !== null);
    
    const topFailure = Object.keys(failureCounts).reduce((a, b) => failureCounts[a] > failureCounts[b] ? a : b, 'distance');

    return {sites: finalSites, topFailure};
}

export async function findWeeklyOutlook(userLoc, allSites, prefs, trainedModel = null) {
    const nearbySites = allSites.filter(site => {
        const travelTime = calculateDriveTime(userLoc, site);
        return travelTime <= (prefs.maxDriveTime || 120);
    });

    console.log(`Weekly Outlook: Parallel checking ${nearbySites.length} nearby sites.`);

    const [vegRes, lightRes] = await Promise.all([
        fetch('https://AndrewMulert.github.io/vegetation_tiles/manifest.json'),
        fetch('https://andrewmulert.github.io/light_tiles/manifest.json')
    ]);
    const vegTiles = (await vegRes.json()).tiles;
    const lightTiles = (await lightRes.json()).tiles;

    const processSite = async (site) => {
        try {
            const [weatherData, aqiData, siteNDVI, radiance] = await Promise.all([api.getWeatherData(site.lat, site.lon, 8),api.getAirQuality(site.lat, site.lon, 7), getNDVI(site.lat, site.lon, vegTiles), getRadianceValue(site.lat, site.lon, lightTiles)]);
            
            const travelTime = calculateDriveTime(userLoc, site);
            const siteWeeklyResults = [];

            for (let i = 1; i < 7; i ++) {
                const checkDate = new Date();
                checkDate.setUTCDate(checkDate.getUTCDate() + i);
                checkDate.setUTCHours(12, 0, 0, 0);

                const times = SunCalc.getTimes(checkDate, site.lat, site.lon);
                const nightStart = times.nauticalDusk;
                const nightEnd = times.nauticalDawn;

                if (!nightStart || !nightEnd || nightStart >= nightEnd) {
                    if (nightStart >= nightEnd) {
                        nightEnd.setDate(nightEnd.getDate() + 1);
                    }
                };

                const moonIllum = SunCalc.getMoonIllumination(checkDate).fraction;
                const moonTimes = SunCalc.getMoonTimes(checkDate, site.lat, site.lon);

                const moonUpDuringNight = (moonTimes.rise < nightEnd && moonTimes.set > nightStart) || !moonTimes.set;

                if (moonIllum > 0.8 && moonUpDuringNight) {
                    console.log(`🌙 Weekly Skip: ${site.name} - Moon Washout predicted.`);
                    continue;
                }

                const weatherStatus = await checkWeatherWindow(site, nightStart, nightEnd, prefs, weatherData);
                if (!weatherStatus.success) continue;

                const hourIndex = (i * 24) + 22;
                const currentAqiStatus = aqiData.fallback ? {success: true, pm25: 10, fallback: true } : { success: true, pm25: aqiData.hourly?.pm2_5[hourIndex] ?? 10 };


                const moonPos = SunCalc.getMoonPosition(weatherStatus.bestTime, site.lat, site.lon);
                const moonIsUpNow = moonPos.altitude > 0;

                const prefetched = {
                    weather: weatherStatus,
                    aqi: currentAqiStatus,
                    radiance: radiance || 0,
                    ndvi: siteNDVI,
                    travelTime: travelTime,
                    moonIsUp: moonIsUpNow,
                    moonIllum: moonIllum
                };

                let score;

                if (trainedModel) {
                    const brainResult = await predictWithBrain(trainedModel, [site], userLoc, prefs, prefetched);
                    if (brainResult && brainResult.sites && brainResult.sites.length > 0) {
                        score = brainResult.sites[0].score || 0;
                        console.log(`AI Score for ${site.name}: ${score}%`);
                    } else {
                        console.log(`🧠 AI Skip during Weekly Outlook: ${site.name}`);
                        continue;
                    }
                } else {
                    score = calculateScore(site, weatherStatus, travelTime, moonIllum, prefs, currentAqiStatus, radiance, siteNDVI, moonIsUpNow);
                }

                const origin = `${userLoc.lat},${userLoc.lon}`;
                const destination = `${site.lat},${site.lon}`;
                const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;

                siteWeeklyResults.push({
                    date: checkDate.toDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric' }),
                    siteName: site.name,
                    score: score,
                    avgTemp: Math.round(weatherStatus.avgTemp),
                    avgClouds: Math.round(weatherStatus.avgClouds),
                    condition: weatherStatus.avgClouds < 10 ? 'Clear': 'Partly Cloudy',
                    bortle: site.bortle || 'N/A',
                    mapUrl: googleMapsUrl || '#',
                    moon: Math.round(moonIllum * 100),
                    moonUp: moonIsUpNow
                });
            }
            return siteWeeklyResults;
        } catch (e) {
            console.error(`Weekly fetch failed for ${site.name}`, e);
            return [];
        }
    };

    const resultsArray = [];
    const batchSize = 5;

    for (let i = 0; i < nearbySites.length; i += batchSize) {
        const batch = nearbySites.slice(i, i + batchSize);
        const batchPromises = batch.map(site => processSite(site));
        const batchResults = await Promise.all(batchPromises);
        resultsArray.push(...batchResults);
        
        if (i + batchSize < nearbySites.length) {
            await new Promise(r => setTimeout(r, 300));
        }
    }

    const flatResults = resultsArray.flat();

    const groupedByDate = flatResults.reduce((acc, item) => {
        if (!acc[item.date]) acc[item.date] = [];
        acc[item.date].push(item);
        return acc;
    }, {});

    const availableDates = Object.keys(groupedByDate);

    if (availableDates.length > 0) {
        const nearestDate = availableDates[0];

        const bestOfNearestDay = groupedByDate[nearestDate].sort((a, b) => b.score - a.score).slice(0, 5);
        return bestOfNearestDay;
    }

    return [];
}

export function renderWeeklyOutlook(weeklyData, prefs) {
    const container = document.getElementById('weekly_outlook');
    const grid = document.getElementById('weekly_grid');

    if(!container || !grid) {
        console.warn("weekly outlook DOM elements not found.");
        return;
    }

    if(!weeklyData || weeklyData.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    grid.innerHTML = '';

    weeklyData.sort((a, b) => new Date(a.date) - new Date(b.date));

    const sortedData = [...weeklyData].sort((a, b) => b.score - a.score);
    const absoluteBestName = sortedData.length > 0 ? sortedData[0].siteName : null;

    weeklyData.forEach(item => {
        const unit = prefs.tempUnit === 'celsius' ? 'C' : 'F';
        const card = document.createElement('div');

        const isChamp = item.siteName === absoluteBestName;
        card.className =   `weekly-card`;

        card.innerHTML = `
            <h2 class="card_date">${isChamp ? `${item.date}` : ''}</h2>
            <h3>${item.siteName} <span class="card_score">(${item.score}% Match)</span></h3>
                <p class="card_temp">${item.avgTemp} °${unit}</p>
                <div class="card_bortle">
                    <svg id="featured_details_svg" width="20px" height="20px"><image width="20px" height="20px" href="/images/icon_info_bortle.svg"></image></svg>
                    <p><strong>Bortle:</strong> ${item.bortle}</p>
                </div>
                <div class="card_cloud">
                    <svg id="featured_details_svg" width="20px" height="20px"><image width="20px" height="20px" href="/images/icon_info_cloudy.svg"></image></svg>
                    <p><strong>${item.avgClouds}%</strong> clouds</p>
                </div>
                <div class="card_directions">
                    <a href="${item.mapUrl}" target="_blank"><svg id="featured_details_svg" width="20px" height="20px"><image width="20px" height="20px" href="/images/icon_info_directions.svg"></image></svg></a>
                    <p class="weekly_stats_directions"><a href="${item.mapUrl}" target="_blank"><strong>Directions</strong></a></p>
                </div>
        `;
        grid.appendChild(card);
    });
}

export async function checkWeatherWindow(site, start, end, prefs, data = null) {
    let weatherData = data || await api.getWeatherData(site.lat, site.lon, 2);

    if (!weatherData?.hourly) return { success: false, reason: 'nodata'};

    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();

    console.log(`Checking ${site.name}: Window [${new Date(startTime).toISOString()}] to [${new Date(endTime).toISOString()}]`);

    const hours = weatherData.hourly.time.map((t, i) => ({
        time: new Date (t.endsWith('Z') ? t : t + ':00.000Z').getTime(),
        clouds: weatherData.hourly.cloud_cover[i],
        temp: weatherData.hourly.temperature_2m[i],
        index: i
    }))
    .filter(h => h.time >= startTime && h.time <= endTime);


    if (hours.length === 0) {
        console.error(`    !! No weather data found for ${site.name} in the night window.`);
        return {success: false, reason: 'out_of_range'}; 
    }

    let bestHour = hours.reduce((prev, curr) => (curr.clouds < prev.clouds ? curr : prev));

    if (bestHour.clouds > 20) {
        console.log(`  !! Weather fail for ${site.name}: It's too cloudy (${bestHour.clouds}%).`);
        return { success: false, reason: 'clouds' };
    }

    if (bestHour.temp < prefs.minTemp) {
        console.log(`!! Cold fail: ${bestHour.temp}° < ${prefs.minTemp}°`);
        return { success: false, reason: 'cold' };
    }

    if (bestHour.temp > prefs.maxTemp) {
        console.log(`!! Heat fail: ${bestHour.temp}° > ${prefs.maxTemp}°`);
        return { success: false, reason: 'hot' };
    }

    let durationHours = 0;
    const startIndex = hours.findIndex(h => h.time === bestHour.time);
    for (let i = startIndex; i < hours.length; i++) {
        if (hours[i].clouds <=25) durationHours++;
        else break;
    }

        
    return { 
        success: true, 
        bestTime: new Date(bestHour.time),
        duration: durationHours,
        avgClouds: bestHour.clouds, 
        avgTemp: bestHour.temp 
    };
}

export async function checkAirQuality(site) {
    const aqiData = await api.getAirQuality(site.lat, site.lon, 1);
    const threshold = 35; // Standard "Unhealthy for Sensitive Groups" cutoff

    if (!aqiData || !aqiData.success || aqiData.fallback) {
        return { success: true, pm25: 12, fallback: true };
    }

    const currentPM25 = aqiData.hourly?.pm2_5[0] || 12;

    if (currentPM25 > threshold) {
        console.log(`!! AQI fail: ${site.name} is too hazy (${currentPM25} PM2.5)`);
        return { success: false, reason: 'aqi' };
    }
    return { success: true, pm25: currentPM25 };
}

const TileManager = {
    basePath: '/js/data/',
    tileSize: 5,
    cache: new Map(),

    getTileName(lat, lon) {
        const latBase = Math.floor(lat / this.tileSize) * this.tileSize;
        const lonBase = Math.floor(lon / this.tileSize) * this.tileSize;
        return `tile_${latBase}_${lonBase}.json`;
    },

    async fetchTile(lat, lon) {
        const fileName = this.getTileName(lat, lon);
        
        if (this.cache.has(fileName)) return this.cache.get(fileName);

        try {
            const response = await fetch(this.basePath + fileName);
            if (!response.ok) throw new Error(`Tile ${fileName} not found`);
            
            const data = await response.json();
            this.cache.set(fileName, data);
            return data;
        } catch (err) {
            console.error("Light Data Error:", err);
            return null;
        }
    }
};

function getRadianceFromTile(tile, lat, lon) {
    const meta = tile.metadata;
    
    const latPct = (meta.lat_range[1] - lat) / (meta.lat_range[1] - meta.lat_range[0]);
    const lonPct = (lon - meta.lon_range[0]) / (meta.lon_range[1] - meta.lon_range[0]);

    const row = Math.floor(latPct * (meta.rows - 1));
    const col = Math.floor(lonPct * (meta.cols - 1));

    if (tile.data[row] && tile.data[row][col] !== undefined) {
        return tile.data[row][col];
    }
    return 0; 
}

function calculateCelsius(temp) {
    const celsius = (temp - 32) * (5/9);
    return celsius;
}

function calculateKilometers(distance) {
    const kilometers = distance * 1.60934;
    return kilometers;
}