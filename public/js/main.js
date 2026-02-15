console.log("!!! MAIN.JS IS LOADED !!!");

import { findBestSites, findWeeklyOutlook, renderWeeklyOutlook } from './engine.js';
import { getActivePrefs } from './config.js';
import { trainStellaBrain, predictWithBrain } from './brain.js';
import * as api from "./api.js";

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
    const loader = document.getElementById('ai-loader');
    const statusText = document.getElementById('ai-status-text');

    try{
        loader.classList.remove('hidden');
        const MODEL_VERSION = "2.1.0-8input";
        const MAX_AGE_MS = 7 * 24 * 60 * 1000;

        const savedModels = await tf.io.listModels();
        const metadata = JSON.parse(localStorage.getItem('stella_metadata') || '{}');
        const now = Date.now();

        const isModelValid = savedModels['localstorage://stella-model'] && metadata.version === MODEL_VERSION && (now - (metadata.timestamp || 0)) < MAX_AGE_MS;

        if (isModelValid) {
            statusText.innerText = "💾 Loading saved brain from storage...";
            trainedModel = await tf.loadLayersModel('localstorage://stella-model');
        } else {
            if (!isModelValid && savedModels['localstorage://stella-model']) {
                console.log("♻️ Brain is outdated or architecture changed. Wiping old model...");
                await tf.io.removeModel('localstorage://stella-model');
            }
            statusText.innerText = "🎓 Training AI for your device... (This may take 10-20 seconds)";
            console.log("🎓 Training a fresh brain...");
            trainedModel = await trainStellaBrain();
            await trainedModel.save('localstorage://stella-model');

            localStorage.setItem('stella_metadata', JSON.stringify({
                version: MODEL_VERSION,
                timestamp: now
            }));

            statusText.innerText ="⭐ AI is online (Loaded from disk).";
        }
    } catch (e) {
        console.error("CRITICAL AI ERROR:", e)
        statusText.innerText = "⚠️ AI failed. Using manual mode.";
        setTimeout(() => loader.classList.add('hidden'), 3000);
        console.warn("AI failed to load. Falling back to Manual Engine")
        trainedModel = null;
    }
}

async function runStargazingEngine() {
    const loader = document.getElementById('ai-loader');
    const statusText = document.getElementById('ai-status-text');

    console.log("Step 1: Engine function called");

    const user = null;
    const prefs = await getActivePrefs(user);
    console.log("Step 2: Prefs loaded:", prefs);
    const date = new Date();

    console.log("Step 3: Requesting location...");
    statusText.innerText = "🌎 Grabbing Location...";
    
    if (!navigator.geolocation) {
        console.error("Geolocation is not supported by this browser.");
        await updateUI(userLoc, prefs);
        return;
    }

    navigator.geolocation.getCurrentPosition(async (pos) => {
        statusText.innerText = "📌 Location Received...";
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
        const buffer = (site.travelTime || 0) + (prefs.departureLeadTime || 30);

        const leaveDate = new Date(startTime.getTime());
        leaveDate.setMinutes(leaveDate.getMinutes() - buffer);

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

    const statusText = document.getElementById('ai-status-text');
    statusText.innerText ="🔍 Starting new search...";

    console.log(`Searching for: ${query}...`);

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;

    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'StellaView-App'}});
        const data = await response.json();

        if (data.length > 0) {
            const newCoords = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon)};
            console.log("Found location:", data[0].display_name);
            statusText.innerText = "📌 Location found...";

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
    const loader = document.getElementById('ai-loader');
    const statusText = document.getElementById('ai-status-text');
    const weeklyContainer = document.querySelector("#weekly-outlook");

    console.log(`Updating UI for ${coords.lat}, ${coords.lon}`);
    const date = new Date();
    statusText.innerText = "🔦 Looking for Stargazing Sites...";
    const allSites = await api.getNearbyDarkPlaces(coords.lat, coords.lon, prefs.maxDriveTime);
    console.log(`Dynamic Search: Found ${allSites.length} potential sites.`);

    let results;

    if (trainedModel) {
        statusText.innerText = "🧠 Making Decision...";
        results = await predictWithBrain(trainedModel, allSites, coords, prefs);
        statusText.innerText = "🥳 Conclusion Formed!";
    } else {
        statusText.innerText = "✏️ Writing Notes...";
        results = await findBestSites(date, coords, allSites, prefs);
        statusText.innerText = "📃 Publishing Results!";
    }

    const { sites, topFailure} = results;

    const container = document.querySelector("#results-container");
    if (container) container.innerHTML = "";

    if (sites.length > 0) {
        decisionSpan.textContent = "Tonight is a good night for stargazing.";
        displayResults(sites, prefs);

        if (weeklyContainer) weeklyContainer.classList.add('hidden');

        statusText.innerText = "✨ Clear skies found!";

        const spinner = loader.querySelector(".spinner");
        if (spinner) spinner.classList.add('hidden');

        setTimeout(() => {
            loader.classList.add('hidden')

            if (spinner) spinner.classList.remove('hidden');
        }, 3000);
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

        if (weeklyContainer) weeklyContainer.classList.remove('hidden');

        statusText.innerText = "🗓️ Tonight's a miss. Checking the rest of the week...";

        const shortlisted = sites.length > 0 ? sites : allSites.filter(s => {
            return true;
        });

        const weeklyData = await findWeeklyOutlook(coords, shortlisted, prefs, trainedModel);
        renderWeeklyOutlook(weeklyData, prefs);

        statusText.innerText = "✅ Weekly Outlook Updated";

        const spinner = loader.querySelector(".spinner");
        if (spinner) spinner.classList.add('hidden');

        setTimeout(() => {
            loader.classList.add('hidden')

            if (spinner) spinner.classList.remove('hidden');
        }, 3000);
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

async function startApp() {
    await initAI();
    await runStargazingEngine();
}

window.addEventListener('load', startApp);