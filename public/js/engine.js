import SunCalc from "suncalc";

/**
* @param {Date} date
* @param {Object} userLocation
* @param {Array} allDarkSites
* @param {Object} prefs 
*/


export async function findBestSites(date, userLocation, allDarkSites, prefs) {

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
        if (travelTime > prefs.maxDriveTime) return null;

        if (site.bortle > prefs.maxBortle) return null;

        const isWeatherGood = await checkWeatherWindow(site, startOfNight, windowEndTime, prefs.minTemp);

        return isWeatherGood ? site : null;
    }));

    return results.filter(site => site !== null);
}

async function checkWeatherWindow(site, start, end, minTemp) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${site.lat}&longitude=${site.lon}&hourly=temperature_2m,cloud_cover&forecast_days=2&timezone=auto`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        const startTime = start.getTime();
        const endTime = end.getTime();

        const windowIndices = data.hourly.time
            .map((t, index) => ({ time: new Date(t).getTime(), index}))
            .filter(item => item.time >= startTime && item.time <= endTime);

        const cloudValues = windowIndices.map(item => data.hourly.cloud_cover[item.index]);
        const tempValues = windowIndices.map(item => data.hourly.temperature_2m[item.index]);

        const tooCloudy = cloudValues.some(clouds => clouds > 20);
        const tooCold = tempValues.some(temp => temp < minTemp);
        const tooHot = tempValues.some(temp => temp > maxTemp);

        return !tooCloudy && !tooCold && !tooHot;
    } catch (error) {
        console.error("weather API failed", error);
        return false;
    }
}