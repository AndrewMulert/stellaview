import SunCalc from "https://esm.sh/suncalc@1.9.0";

/**
* @param {Date} date
* @param {Object} userLocation
* @param {Array} allDarkSites
* @param {Object} prefs 
*/


export async function findBestSites(date, userLocation, allDarkSites, prefs) {
    /*A running talley of why locations may fail to determine the overall reason for failure*/
    let failureCounts = { clouds: 0, cold: 0, hot: 0, moon: 0};
    console.log("Starting engine with", allDarkSites.length, "sites.");


    const decisionSpan = document.querySelector("#hero_decision");
    decisionSpan.textContent = "Beginning our search, unfolding the map...";

    const times = SunCalc.getTimes(date, userLocation.lat, userLocation.lon);
    const startOfNight = times.night;

    let windowEndTime = times.nightEnd;
    if (prefs.latestStayOut) {
        const [hours, minutes] = prefs.latestStayOut.split(':');
        windowEndTime = new Date(date);
        windowEndTime.setHours(parseInt(hours), parseInt(minutes), 0);

        if (parseInt(hours) < 12) windowEndTime.setDate(windowEndTime.getDate() + 1);
    }

    const moonIllumination = SunCalc.getMoonIllumination(date).fraction;
    const moonTimes = SunCalc.getMoonTimes(date, userLocation.lat, userLocation.lon);

    const moonRise = moonTimes.rise;
    const moonSet = moonTimes.set;

    const moonUpAtStart = startOfNight > moonRise && startOfNight < moonSet;
    const moonUpAtEnd = windowEndTime > moonRise && windowEndTime < moonSet;

    const moonIsUp =  moonUpAtStart || moonUpAtEnd || moonTimes.alwaysUp;
    
    if (moonIllumination > 0.8 && moonIsUp){
        console.log(`  -> Filtered: Moon too bright (${Math.round(moonIllumination * 100)}%) and visible during window.`);
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
            
            let currentTemp = weatherStatus.avgTemp;
            if (prefs.tempUnit === 'celsius') {
                currentTemp = calculateFahrenheit(currentTemp);
            }
            
            const darknessScore = (10 - site.bortle);
            const altitudeBonus = (site.elevation || 0) / 1000;
            const hazePenalty = aqiStatus.pm25 / 10;

            const tempDiff = Math.abs(currentTemp - 68);
            const comfortPenalty = tempDiff * 0.1;

            let distInMiles = travelTime;
            const distancePenalty = distInMiles / 60;

            const finalScore = darknessScore + altitudeBonus - hazePenalty - comfortPenalty - distancePenalty;
            return { ...site, travelTime: Math.round(travelTime), score: finalScore.toFixed(2), bestStartTime: startOfNight.toISOString()};
        } else {
            const failureReason = !weatherStatus.success ? weatherStatus.reason : 'aqi';
            console.log(`  -> Filtered: ${failureReason} constraints failed.`);
            failureCounts[failureReason.reason]++;
            return null;
        }
    }));

    const finalSites = results.filter(site => site !== null);
    
    const hasFailures = Object.values(failureCounts).some(v => v > 0);
    const topFailure = hasFailures ? Object.keys(failureCounts).reduce((a, b) => failureCounts[a] > failureCounts[b] ? a : b) : 'distance';

    return {sites: finalSites, topFailure};
}

async function checkWeatherWindow(site, start, end, prefs) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${site.lat}&longitude=${site.lon}&hourly=temperature_2m,cloud_cover&forecast_days=2&timezone=auto`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        const startTime = start.getTime();
        const endTime = end.getTime();

        const windowIndices = data.hourly.time
            .map((t, index) => ({ time: new Date(t).getTime(), index}))
            .filter(item => item.time >= startTime && item.time <= endTime);
            console.log(`Weather Window for ${site.name}: Found ${windowIndices.length} hourly data points.`);

        if (windowIndices.length === 0) {
            console.error(`    !! No weather data found for ${site.name} in the night window.`);
            return false; 
        }

        const cloudValues = windowIndices.map(item => data.hourly.cloud_cover[item.index]);
        const tempValues = windowIndices.map(item => data.hourly.temperature_2m[item.index]);
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

        const demoMode = true;

        if (demoMode) return true;

        return !tooCloudy && !tooCold && !tooHot
    } catch (error) {
        console.error("weather API failed", error);
        return false;
    }
}

async function checkAirQuality(site) {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${site.lat}&longitude=${site.lon}&hourly=pm2_5&forecast_days=1`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        const currentPM25 = data.hourly.pm2_5[0];

        if(currentPM25 > 35){
            console.log(` !! AQI fail for ${site.name}: PM2.5 is ${currentPM25}`);
            return { success: false, reason: 'aqi'};
        }

        return {success: true, pm25: currentPM25};
    } catch (error) {
        console.error("AQI API failed, skipping check", error);
        return {success: true, pm25: 10};
    }
}

function calculateDriveTime(loc1, loc2) {
    const R = 3958.8;
    const dLat = (loc2.lat - loc1.lat) * Math.PI / 180;
    const dLon = (loc2.lon - loc1.lon) * Math.PI /180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(loc1.lat * Math.PI / 180) * Math.cos(loc2.lat * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distanceMiles = R * c;

    return (distanceMiles / 45) * 60;
}

function calculateCelsius(temp) {
    const celsius = (temp - 32) * (5/9);
    return celsius;
}

function calculateFahrenheit(temp) {
    const fahrenheit = (temp * 9/5) + 32;
    return fahrenheit;
}

function calculateKilometers(distance) {
    const kilometers = distance * 1.60934;
    return kilometers;
}