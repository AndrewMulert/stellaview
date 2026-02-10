import { findBestSites } from './engine.js';
import { getActivePrefs } from './config.js';

year = document.querySelector("#year").textContent = new Date().getFullYear();

async function runStargazingEngine() {
    const user = null;
    const prefs = await getActivePrefs(user);
    const date = new Date();

    navigator.geolocation.getCurrentPosition(async (pos) => {
        const userLoc = { lat: pos.coords.latitude, lon: pos.coords.longitude };

        const allSites = await fetch('./sites.json').then(res => res.json());

        const results = await findBestSites(date, userLoc, allSites, prefs);

        displayResults(results, prefs);
    });
}

function displayResults(sites, prefs) {
    sites.forEach(site => {
        const leaveDate = new Date(site.bestStartTime);
        leaveDate.setMinutes(leaveDate.getMinutes() - site.travelTime - prefs.departureLeadTime);

        console.log(`To reach ${site.name}, leave at: ${leaveDate.toLocaleTimeString()}`);
    })
}