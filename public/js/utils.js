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

export function normalizeInputs(site, weather, moon) {
    return [
        (10 - site.bortle) / 10,
        (100 - weather.clouds) / 100,
        Math.max(0, (50 - weather.pm25) / 50),
        (1 - moon.illumination),
        1 - (Math.abs(weather.temp - 68) /40),
        (site.publicRating || 3) / 5,
        (site.userRating || 3) / 5
    ];
}