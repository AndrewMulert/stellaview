import SunCalc from "https://esm.sh/suncalc@1.9.0";

/**
* @param {Date} date
* @param {Object} userLocation
* @param {Array} allDarkSites
* @param {Object} prefs 
*/


export async function findBestSites(date, userLocation, allDarkSites, prefs) {
    let failureCounts = { clouds: 0, cold: 0, hot: 0};
    console.log("Starting engine with", allDarkSites.length, "sites.");

    const times = SunCalc.getTimes(date, userLocation.lat, userLocation.lon);
    const startOfNight = times.night;

    let windowEndTime = times.nightEnd;
    if (prefs.latestStayOut) {
        const [hours, minutes] = prefs.latestStayOut.split(':');
        windowEndTime = new Date(date);
        windowEndTime.setHours(parseInt(hours), parseInt(minutes), 0);

        if (parseInt(hours) < 12) windowEndTime.setDate(windowEndTime.getDate() + 1);
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

        const weatherStatus = await checkWeatherWindow(site, startOfNight, windowEndTime, prefs);

        if (weatherStatus.success) {
            console.log(`  => SUCCESS: ${site.name} passed all checks.`);
            return { ...site, travelTime: Math.round(travelTime)};
        } else {
            console.log(`  -> Filtered: Weather/Temp constraints failed.`);
            failureCounts[weatherStatus.reason]++;
            return null;
        }
    }));

    const finalSites = results.filter(site => site !== null);

    return {sites: finalSites, topFailure: Object.keys(failureCounts).reduce((a, b) => failureCounts[a] > failureCounts[b] ? a : b)};
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

function calculateDriveTime(loc1, loc2) {
    const R = 3958.8;
    const dLat = (loc2.lat - loc1.lat) * Math.PI / 180;
    const dLon = (loc2.lon - loc1.lon) * Math.PI /180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(loc1.lat * Math.PI / 180) * Math.cos(loc2.lat * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distanceMiles = R * c;

    return (distanceMiles / 45) * 60;
}