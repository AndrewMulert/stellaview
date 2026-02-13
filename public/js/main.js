console.log("!!! MAIN.JS IS LOADED !!!");

import { findBestSites } from './engine.js';
import { getActivePrefs } from './config.js';
import { trainStellaBrain, predictWithBrain } from './brain.js';

const yearSpan = document.querySelector("#year");
const timeSpan = document.querySelector("#home_time");
const decisionSpan = document.querySelector("#hero_decision");

if (yearSpan) {
    yearSpan.textContent = new Date().getFullYear();
};

if (decisionSpan) {
    decisionSpan.textContent = "The universe is calling; let’s find where it’s clearest.";
}

function timeUpdater() {
    if (timeSpan) {
        const now = new Date();
        let hours = now.getHours();
        let minutes = now.getMinutes();
        const meridiem = hours >= 12 ? 'PM': 'AM';

        hours = hours % 12;
        hours = hours ? hours : 12;

        const displayMinutes = minutes < 10? `0${minutes}` : minutes;

        timeSpan.textContent = `${hours}:${displayMinutes} ${meridiem}`;
    }
};

timeUpdater();
setInterval(timeUpdater, 1000);

let trainedModel = null;

async function initAI() {
    try{
        trainedModel = await trainStellaBrain();
        console.log("AI is online and ready.");
    } catch (e) {
        console.error("CRITICAL AI ERROR:", e)
        console.warn("AI failed to load. Falling back to Manual Engine")
    }
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
        await updateUI(userLoc, prefs);
        return;
    }

    navigator.geolocation.getCurrentPosition(async (pos) => {
        console.log("Step 4: Location received!", pos.coords.latitude, pos.coords.longitude);
        const userLoc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        await updateUI(userLoc, prefs);
    },
    async (err) => {
        let errorType = "Unknown Error";
        if (err.code === 1) errorType = "Permission Denied";
        if (err.code === 2) errorType = "Position Unavailable";
        if (err.code === 3) errorType = "Timeout";

        console.warn(`Location Error: ${errorType}. Using fallback from config.`);
        await updateUI(prefs.fallback_loc, prefs);
    },
    {timeout: 8000, enableHighAccuracy: false}
);
}

function displayResults(sites, prefs) {
    const container = document.querySelector("#results-container");
    if (!container) return;

    container.innerHTML = "";

    sites.forEach(site => {
        const startTime = site.bestStartTime ? new Date(site.bestStartTime) : new Date();

        const leadTime = prefs.departureLeadTime || 30;
        const totalBuffer = site.travelTime + (prefs.departureLeadTime || 30);

        const leaveDate = new Date(startTime.getTime());
        leaveDate.setMinutes(leaveDate.getMinutes() - totalBuffer);

        const timeString = isNaN(leaveDate.getTime()) ? "TBD" : leaveDate.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit' });

        const card = document.createElement("div");
        card.className = "site-card";
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
            await updateUI(newCoords, prefs);

        } else {
            alert("Location not found. Try a different city!");
        }
    } catch (err) {
        console.error("Search failed:", err);
    }
}

const updateUI = async (coords, prefs) => {
    console.log(`Updating UI for ${coords.lat}, ${coords.lon}`);
    const date = new Date();
    const allSites = await fetch('./js/sites.json').then(res => res.json());

    let results;

    if (trainedModel) {
        results = await predictWithBrain(trainedModel, allSites, coords, prefs);
    } else {
        results = await findBestSites(date, coords, allSites, prefs);
    }

    const { sites, topFailure} = results;

    const container = document.querySelector("#results-container");
    if (container) container.innerHTML = "";

    if (sites.length > 0) {
        decisionSpan.textContent = "Tonight is a good night for stargazing.";
        displayResults(sites, prefs);
    } else {
        const reason = topFailure || "clouds";
        const messages = {
            clouds: "Hazy vision. The stars continue their dance beyond the veil.",
            cold: "Don't become a popsicle! Save the view for a warmer day",
            hot: "You're on fire! Stay indoors and avoid the heat tonight.",
            moon: "The Man on the Moon gives his greetings and illuminates the landscape",
            distance: "The universe is calling, but it's a bit too far of a drive.",
            aqi: "Smoke and mirrors. The air is too thick for a clear view tonight."
        };
        decisionSpan.textContent = messages[topFailure] || "Must have forgotten to take the lens cap off, can't get a prediction";

        console.warn(`Engine finished: 0 sites found. Primary Blocker: ${topFailure}`);
    }
};

document.addEventListener('click', (e) => {
    if (e.target.closest('#search_btn')) {
        handleSearch()
    }
});

document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && e.target.id === 'location_input') handleSearch();
});

window.addEventListener('load', () => {
    initAI();
})

runStargazingEngine();