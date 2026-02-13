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

export function normalizeInputs(site, weather, moonIllum, travelTime, prefs) {
    const normBortle = (10 - site.bortle) / 10;
    const normClouds = (100 - weather.avgClouds) / 100;
    const normAQI = Math.max(0, (50 - weather.pm25 || 10) / 50);
    const normMoon = (1 - moonIllum)
    const tempF = (prefs.tempUnit === 'celsius') ? calculateFahrenheit(weather.avgTemp) : weather.avgTemp;
    const normTemp =  1 - (Math.abs(tempF - 68) /40);
    const normPublic =  (site.rating || 0) / 5;
    const normUser = (site.userRating || 0) / 5;
    return [normBortle, normClouds, normAQI, normMoon, normTemp, normPublic, normUser];
}