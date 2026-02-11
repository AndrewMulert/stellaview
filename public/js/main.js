console.log("!!! MAIN.JS IS LOADED !!!"); // Put this on LINE 1

import { findBestSites } from './engine.js';
import { getActivePrefs } from './config.js';

const yearSpan = document.querySelector("#year");

if (yearSpan) {
    yearSpan.textContent = new Date().getFullYear();
}

async function runStargazingEngine() {
    console.log("Step 1: Engine function called");

    const user = null;
    const prefs = await getActivePrefs(user);
    console.log("Step 2: Prefs loaded:", prefs);
    const date = new Date();

    console.log("Step 3: Requesting location...");
    
    if (!navigator.geolocation) {
        console.error("Geolocation is not supported by this browser.");
        return;
    }

    navigator.geolocation.getCurrentPosition(async (pos) => {
        console.log("Step 4: Location received!", pos.coords.latitude, pos.coords.longitude);
        const userLoc = { lat: pos.coords.latitude, lon: pos.coords.longitude };

        console.log("Step 5: Fetching sites.json...");
        const allSites = await fetch('./js/sites.json').then(res => res.json());

        console.log("Step 6: Running engine algorithm...");
        const results = await findBestSites(date, userLoc, allSites, prefs);

        console.log("Step 7: Algorithm complete.");

        if (results.length === 0) {
            console.warn("No sites matched your criteria. (They are likely too far away!)");
        } else {
            console.log(`Success! Found ${results.length} matching sites.`);
            displayResults(results, prefs);
        }
    }, (err) => {
        console.error("Location Error:", err.message);
    }, { timeout: 10000 });
}

function displayResults(sites, prefs) {
    const container = document.querySelector("#results-container");
    if (!container) return;

    container.innerHTML = "";

    sites.forEach(site => {
        const leaveDate = new Date(site.bestStartTime);
        const totalBuffer = site.travelTime + (prefs.departureLeadTime || 30);
        leaveDate.setMinutes(leaveDate.getMinutes()-totalBuffer);

        const card = document.createElement("div");
        card.classname = "site-card";
        card.innerHTML = `
            <h3>${site.name}</h3>
            <p><strong>Bortle:</strong> ${site.bortle}</p>
            <p><strong>Drive Time:</strong> ~${site.travelTime} mins</p>
            <p class="leave-time">Leave by: ${leaveDate.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</p>
        `;
        container.appendChild(card);
    });
    
    sites.forEach(site => {
        const leaveDate = new Date(site.bestStartTime);
        leaveDate.setMinutes(leaveDate.getMinutes() - site.travelTime - prefs.departureLeadTime);

        console.log(`To reach ${site.name}, leave at: ${leaveDate.toLocaleTimeString()}`);
    });
};

async function searchByCity(cityname) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityname)}&format=json&limit=1`;

    try {
        const response = await fetch(runAllChains, {
            headers: { 'User-Agent': 'StellaView-App' }
        });
        const data = await response.json();

        if (data.length > 0) {
            return {
                lat: parseFloat(data[0].lat),
                lon: parseFloat(data[0].lon),
                name: data[0].display_name
            };
        }
    } catch (err) {
        console.error("Search failed", err);
    }
};

async function handleSearch() {
    const query = document.querySelector("#location_input").value;
    if (!query) return;

    console.log(`Searching for: ${query}...`);

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;

    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'StellaView-App'}});
        const data = await response.json();

        if (data.length > 0) {
            const newCoords = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon)};
            console.log("Found location:", data[0].display_name);

            const prefs = await getActivePrefs();
            const allSites = await fetch('./js/sites.json').then(res => res.json());

            const results = await findBestSites(new Date(), newCoords, allSites, prefs);
            displayResults(results, prefs);
        } else {
            alert("Location not found. Try a different city!");
        }
    } catch (err) {
        console.error("Search failed:", err);
    }
}

document.addEventListener('click', (e) => {
    if (e.target.id === 'search_btn') handleSearch();
});

document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && e.target.id === 'location_input') handleSearch();
});

runStargazingEngine();