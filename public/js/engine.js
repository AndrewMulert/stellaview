import SunCalc from "https://esm.sh/suncalc@1.9.0";
import { calculateDriveTime, calculateFahrenheit} from './utils.js';
import * as api from './api.js';

/**
* @param {Object} site
* @param {Object} weatherStatus
* @param {number} travelTime
* @param {Object} prefs 
* @param {number} moonIllum
* @param {Object} aqiStatus
*/

function calculateScore(site, weatherStatus, travelTime, moonIllum, prefs, aqiStatus = null) {
    let currentTemp = weatherStatus.avgTemp;
    if (prefs.tempUnit === 'celsius') {
        currentTemp = calculateFahrenheit(currentTemp);
    }

    const darknessScore = (10 - site.bortle);
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
    let failureCounts = { clouds: 0, cold: 0, hot: 0, moon: 0};
    console.log("Starting engine with", allDarkSites.length, "sites.");


    const decisionSpan = document.querySelector("#hero_decision");
    if (decisionSpan) decisionSpan.textContent = "Beginning our search, unfolding the map...";

    const times = SunCalc.getTimes(date, userLocation.lat, userLocation.lon);
    const startOfNight = times.night;

    let windowEndTime = times.nightEnd;
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
        console.log(`Site: ${site.name} | Drive: ${Math.round(travelTime)}m | Bortle: ${site.bortle}`);

        if (travelTime > prefs.maxDriveTime){
            console.log(`  -> Filtered: Drive too long (${Math.round(travelTime)} > ${prefs.maxDriveTime})`);
            return null;
        };

        if (site.bortle > prefs.maxBortle){
            console.log(`  -> Filtered: Bortle too high (${site.bortle} > ${prefs.maxBortle})`);
            return null;
        };

        const [weatherStatus, aqiStatus] = await Promise.all([checkWeatherWindow(site, startOfNight, windowEndTime, prefs), checkAirQuality(site)]);

        if (weatherStatus.success && aqiStatus.success) {
            console.log(`  => SUCCESS: ${site.name} passed all checks.`);
            const score = calculateScore(site, weatherStatus, travelTime, moonIllum, prefs, aqiStatus );
            return { ...site, travelTime: Math.round(travelTime), score: score, bestStartTime: startOfNight.toISOString()};
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

export async function findWeeklyOutlook(userLoc, allSites, prefs) {
    const nearbySites = allSites.filter(site => {
        const travelTime = calculateDriveTime(userLoc, site);
        return travelTime <= (prefs.maxDriveTime || 120);
    });

    console.log(`Weekly Outlook: Only checking ${nearbySites.length} nearby sites.`);

    const weeklyResults = [];

    for (const site of nearbySites) {
        
        try {
            const weatherData = await api.getWeatherData(site.lat, site.lon, 8);
            const travelTime = calculateDriveTime(userLoc, site);

            for (let i = 0; i < 7; i ++) {
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

                const weatherStatus = await checkWeatherWindow(site, nightStart, nightEnd, prefs, weatherData)

                if (weatherStatus.success) {
                    const mockAqi = {success: true, pm25: 10};
                    const score = calculateScore(site, weatherStatus, travelTime, moonIllum, prefs, mockAqi);
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
        return
    }

    container.innerHTML = "";

    container.classList.remove('hidden');
    grid.innerHTML = '';

    const counts = weeklyData.reduce((acc, curr) => {
        acc[curr.siteName] = (acc[curr.siteName] || 0) + 1;
        return acc;
    }, {});

    const championName = Object.keys(counts).reduce((a, b) => counts[a] >  counts[b] ? a : b);

    weeklyData.forEach(item => {
        const unit = prefs.tempUnit === 'celsius' ? 'C' : 'F';
        const card = document.createElement('div');
        const isChamp = item.siteName === championName;
        card.className =   `weekly-card ${item.siteName === championName ? 'champion-highlight' : ''}`;

        card.innerHTML = `
            <div class="date">${item.date}</div>
            <div class="site-name">${item.siteName}</div>
            <div class="temp">${item.avgTemp} °${unit}</div>
            <div class="score-badge">Score: ${item.score}</div>
            ${isChamp ? '<div class="champ-label">Weekly Best</div>' : ''}
        `;
        grid.appendChild(card);
    });
}

export async function checkWeatherWindow(site, start, end, prefs, data = null) {
    let weatherData = data;

    if (!weatherData) {
        weatherData = await api.getWeatherData(site.lat, site.lon, 2);
    }

    if (!weatherData || !weatherData.hourly) return { success: false, reason: 'nodata'};

    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();

    console.log(`Checking ${site.name}: Window [${new Date(startTime).toISOString()}] to [${new Date(endTime).toISOString()}]`);

    const windowIndices = weatherData.hourly.time
        .map((t, index) => { const timeStr = t.endsWith('Z') ? t : t + ':00.000Z'; return {time: new Date(timeStr).getTime(), index}})
        .filter(item => { return item.time >= startTime && item.time <= endTime});
        console.log(`Weather Window for ${site.name}: Found ${windowIndices.length} hourly data points.`);

    if (windowIndices.length === 0) {
        console.error(`    !! No weather data found for ${site.name} in the night window.`);
        return {success: false, reason: 'out_of_range'}; 
    }

    const cloudValues = windowIndices.map(item => weatherData.hourly.cloud_cover[item.index]);
    const tempValues = windowIndices.map(item => weatherData.hourly.temperature_2m[item.index]);
    const maxCloudObserved = Math.max(...cloudValues);
    const minTempObserved = Math.min(...tempValues);
    const maxTempObserved = Math.max(...tempValues);

    const tooCloudy = cloudValues.some(clouds => clouds > 20);
    if (tooCloudy) {
        console.log(`  !! Weather fail for ${site.name}: It's too cloudy (${maxCloudObserved}%).`);
        return { success: false, reason: 'clouds' };
    }
    const tooCold = tempValues.some(temp => temp < prefs.minTemp);
    if (tooCold) {
        console.log(`  !! Weather fail for ${site.name}: It's too cold (${minTempObserved}°).`);
        return { success: false, reason: 'cold' };
    }
    const tooHot = tempValues.some(temp => temp > prefs.maxTemp);
    if (tooHot) {
        console.log(`  !! Weather fail for ${site.name}: It's too hot (${maxTempObserved}°).`);
        return { success: false, reason: 'hot' };
    }

    const avgClouds = cloudValues.reduce((a, b) => a + b, 0) / cloudValues.length;
    const avgTemp = tempValues.reduce((a, b) => a + b, 0) / tempValues.length;

    const demoMode = false;

    if (demoMode) return true;

        
    return { 
        success: true, 
        avgClouds: avgClouds, 
        avgTemp: avgTemp 
    };
}

export async function checkAirQuality(site) {
    const aqiData = await api.getAirQuality(site.lat, site.lon);

    if (aqiData.pm25 > 35) {
        console.log(`!! AQI fail for ${site.name}: PM2.5 is ${aqiData.pm25}`);
        return { success: false, reason: 'aqi' };
    }

    return aqiData;
}

function calculateCelsius(temp) {
    const celsius = (temp - 32) * (5/9);
    return celsius;
}

function calculateKilometers(distance) {
    const kilometers = distance * 1.60934;
    return kilometers;
}