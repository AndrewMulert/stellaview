import SunCalc from "https://esm.sh/suncalc@1.9.0";
import { calculateDriveTime, calculateFahrenheit} from './utils.js';
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

function calculateScore(site, weatherStatus, travelTime, moonIllum, prefs, aqiStatus = null, radiance = 0) {
    let currentTemp = weatherStatus.avgTemp;
    if (prefs.tempUnit === 'celsius') {
        currentTemp = calculateFahrenheit(currentTemp);
    }

    const darknessScore = Math.max(0, 10 - (Math.log1p(radiance) * 2.5));
    const altitudeBonus = (site.elevation || 0) / 1000;

    const pm25 = aqiStatus ? aqiStatus.pm25 : 10;
    const hazePenalty = pm25 / 10;

    const tempDiff = Math.abs(currentTemp - 68);
    const comfortPenalty = tempDiff * 0.1;
    const distancePenalty = travelTime / 60;

    const moonPenalty = moonIllum * 2;

    const finalScore = darknessScore + altitudeBonus - hazePenalty - comfortPenalty - distancePenalty - moonPenalty;
    return finalScore.toFixed(2);
}

export async function findBestSites(date, userLocation, allDarkSites, prefs) {
    /*A running talley of why locations may fail to determine the overall reason for failure*/
    let failureCounts = { clouds: 0, cold: 0, hot: 0, moon: 0, aqi: 0};
    console.log("Starting engine with", allDarkSites.length, "sites.");


    const decisionSpan = document.querySelector("#hero_decision");
    if (decisionSpan) decisionSpan.textContent = "Beginning our search, unfolding the map...";

    const times = SunCalc.getTimes(date, userLocation.lat, userLocation.lon);
    let startOfNight = times.night;
    const now = new Date();

    let windowEndTime = times.nightEnd;

    if (now > startOfNight && now < windowEndTime){
        startOfNight = now;
    }

    if (prefs.latestStayOut) {
        const [hours, minutes] = prefs.latestStayOut.split(':');
        windowEndTime = new Date(date);
        windowEndTime.setHours(parseInt(hours), parseInt(minutes), 0);

        if (parseInt(hours) < 12) windowEndTime.setDate(windowEndTime.getDate() + 1);
    }

    const moonIllum = SunCalc.getMoonIllumination(date).fraction;
    const moonTimes = SunCalc.getMoonTimes(date, userLocation.lat, userLocation.lon);
    const moonIsUp =  (startOfNight > moonTimes.rise && startOfNight < moonTimes.set) || moonTimes.alwaysUp;

    
    if (moonIllum > 0.8 && moonIsUp){
        console.log(`  -> Filtered: Moon too bright (${Math.round(moonIllum * 100)}%) and visible during window.`);
        return { sites: [], topFailure: 'moon' };
    }

    const results = await Promise.all(allDarkSites.map(async (site) => {
        const travelTime = calculateDriveTime(userLocation, site);

        const tile = await TileManager.fetchTile(site.lat, site.lon);
        let radiance = 0;
        if (tile) {
            radiance = getRadianceFromTile(tile, site.lat, site.lon);
            console.log (`Site: ${site.name} | Drive: ${Math.round(travelTime)}m | Real-time Radiance: ${radiance}`);
        } else {
            console.log(`Site: ${site.name} | Drive: ${Math.round(travelTime)}m`);
        }


        if (travelTime > prefs.maxDriveTime){
            console.log(`  -> Filtered: Drive too long (${Math.round(travelTime)} > ${prefs.maxDriveTime})`);
            return null;
        };

        if (radiance > prefs.maxBortle){
            console.log(`  -> Filtered: Too much light pollution (${radiance} > ${prefs.maxBortle})`);
            return null;
        };

        const [weatherStatus, aqiStatus] = await Promise.all([checkWeatherWindow(site, startOfNight, windowEndTime, prefs), checkAirQuality(site)]);

        if (weatherStatus.success && aqiStatus.success) {
            console.log(`  => SUCCESS: ${site.name} passed all checks.`);
            const score = calculateScore(site, weatherStatus, travelTime, moonIllum, prefs, aqiStatus, radiance);
            return { ...site, travelTime: Math.round(travelTime), score: score, bestTime: weatherStatus.bestTime, duration: weatherStatus.duration, avgTemp: weatherStatus.avgTemp, avgClouds: weatherStatus.avgClouds, radiance: radiance};
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

    console.log(`Weekly Outlook: Only checking ${nearbySites.length} nearby sites.`);

    const weeklyResults = [];

    for (const site of nearbySites) {
        
        try {
            const weatherData = await api.getWeatherData(site.lat, site.lon, 8);
            const aqiData = await api.getAirQuality(site.lat, site.lon, 7);
            const travelTime = calculateDriveTime(userLoc, site);

            for (let i = 1; i < 7; i ++) {
                const checkDate = new Date();
                checkDate.setUTCDate(checkDate.getUTCDate() + i);
                checkDate.setUTCHours(12, 0, 0, 0);
                const hourIndex = (i * 24) + 22;
                const currentAqiStatus = aqiData.fallback ? {success: true, pm25: 10, fallback: true } : { success: true, pm25: aqiData.hourly?.pm2_5[hourIndex] ?? 10 };


                const times = SunCalc.getTimes(checkDate, site.lat, site.lon);

                const nightStart = times.nauticalDusk;
                const nightEnd = times.nauticalDawn;

                if (!nightStart || !nightEnd || nightStart >= nightEnd) {
                    if (nightStart >= nightEnd) {
                        nightEnd.setDate(nightEnd.getDate() + 1);
                    }
                };

                const moonIllum = SunCalc.getMoonIllumination(checkDate).fraction;

                const weatherStatus = await checkWeatherWindow(site, nightStart, nightEnd, prefs, weatherData)

                const prefetched = {
                    weather: weatherStatus,
                    aqi: currentAqiStatus,
                    radiance: site.radiance || 0
                };

                if (weatherStatus.success) {
                    let score;

                    if (trainedModel) {
                        const brainResult = await predictWithBrain(trainedModel, [site], userLoc, prefs, prefetched);
                        score = brainResult.sites[0].score || 0;
                        console.log(`AI Score for ${site.name}: ${score}%`);
                    } else {
                        score = calculateScore(site, weatherStatus, travelTime, moonIllum, prefs, currentAqiStatus, site.radiance);
                    }

                    weeklyResults.push({
                        date: checkDate.toDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric' }),
                        siteName: site.name,
                        score: score,
                        avgTemp: Math.round(weatherStatus.avgTemp),
                        condition: weatherStatus.avgClouds < 10 ? 'Clear': 'Partly Cloudy'
                });
                }
            }
        } catch (e) {
            console.error(`Weekly fetch failed for ${site.name}`, e);
        }
    } 
    return weeklyResults;
}

export function renderWeeklyOutlook(weeklyData, prefs) {
    const container = document.getElementById('weekly_outlook');
    const grid = document.getElementById('weekly_grid');

    if(!weeklyData || weeklyData.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    grid.innerHTML = '';

    weeklyData.sort((a, b) => new Date(a.date) - new Date(b.date));

    const absoluteBest = [...weeklyData].sort((a, b) => b.score = a.score)[0];

    weeklyData.forEach(item => {
        const unit = prefs.tempUnit === 'celsius' ? 'C' : 'F';
        const card = document.createElement('div');
        const isChamp = item.siteName === absoluteBest;
        card.className =   `weekly-card ${isChamp ? 'champion-highlight' : ''}`;

        card.innerHTML = `
            <h3 class="date">${item.date} ${isChamp ? '(Weekly Best)' : ''}</h3>
            <h2 class="site-name">${item.siteName} (${item.score}% Match)</h2>
            <p class="temp">${item.avgTemp} °${unit}</p>
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
        console.log(`  !! Weather fail for ${site.name}: It's too cloudy (${maxCloudObserved}%).`);
        return { success: false, reason: 'clouds' };
    }

    if (bestHour.temp < prefs.minTemp) {
        console.log(`  !! Weather fail for ${site.name}: It's too cold (${minTempObserved}°).`);
        return { success: false, reason: 'cold' };
    }

    if (bestHour.temp > prefs.maxTemp) {
        console.log(`  !! Weather fail for ${site.name}: It's too hot (${maxTempObserved}°).`);
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

    if (!aqiData || !aqiData.success || aqiData.fallback) {
        console.log(`!! AQI fail for ${site.name}: PM2.5 is ${aqiData.pm25}`);
        return { success: true, pm25: 10, fallback: true };
    }

    const hourlyList = aqiData.hourly?.pm2_5;

    if (!hourlyList || hourlyList.length === 0) {
        console.warn(`⚠️ No AQI data found for ${site.name}, using fallback.`);
        return { success: true, pm25: 10, fallback: true};
    }

    const currentPM25 = hourlyList[0];

    if (currentPM25 > 35) {
        console.log(`!! AQI fail for ${site.name}: PM2.5 is ${currentPM25}`);
        return { success: false, reason: 'aqi' };
    }

    return {success: true, pm25: currentPM25};
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