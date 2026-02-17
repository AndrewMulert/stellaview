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
let currentSearchId = 0;
let activeAbortController = null;

async function initAI() {
    const loader = document.getElementById('ai-loader');
    const statusText = document.getElementById('ai-status-text');

    try{
        loader.classList.remove('hidden');
        const MODEL_VERSION = "2.1.5-optimization";
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

    currentSearchId++;
    const thisSearchId = currentSearchId;

    navigator.geolocation.getCurrentPosition(async (pos) => {
        statusText.innerText = "📌 Location Received...";
        console.log("Step 4: Location received!", pos.coords.latitude, pos.coords.longitude);
        const userLoc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        await updateUI(userLoc, prefs, thisSearchId);
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
        let rawDate = site.bestTime;
        let targetArrival;

        if (rawDate instanceof Date) {
            targetArrival = rawDate;
        } else if (typeof rawDate === "string") {
            const formatted = rawDate.includes('T') ? rawDate : rawDate.replace(' ', 'T') + 'Z';
            targetArrival = new Date(formatted);
        } else {
            targetArrival = new Date();
        }

        const driveTime = Math.round(site.travelTime || 0);

        const leaveDate = new Date(targetArrival.getTime() - (driveTime) * 60000);

        const cloudVal = (site.avgClouds !== undefined && site.avgClouds !== null) ? Math.round(site.avgClouds) : '--';
        const tempDisplay = (site.avgTemp !== undefined && site.avgTemp !== null) ? Math.round(site.avgTemp) : '--';

        const timeOptions = {hour: 'numeric', minute: '2-digit', hour12: true};
        const viewingStr = targetArrival.toLocaleTimeString([], timeOptions);
        const leaveStr = leaveDate.toLocaleTimeString([], timeOptions);

        const card = document.createElement("div");
        card.className = "site-card";
        card.innerHTML = `
            <h3>${site.name} (Score: ${site.score})</h3>
            <p><strong>Bortle:</strong> ${site.bortle || 'N/A'} </p>
            <p><strong>Viewing Starts:</strong> ${viewingStr}</p>
            <p><strong>Window:</strong> ${site.duration || '0'} hours of clear sky</p>
            <p><strong>Conditions: </strong> ${tempDisplay} °F / ${cloudVal}% clouds</p>
            <p><strong>Drive Time:</strong> ~${driveTime} mins</p>
            <p class="leave-time">Leave by: ${leaveStr}</p>
            <div>
            <a href="${site.mapUrl}" target="_blank">Directions</a>
            </div>
        `;
        container.appendChild(card);
    });
    
    sites.forEach(site => {
        if (site.bestTime && !isNaN(new Date(site.bestTime))) {
            const leaveTime = new Date(new Date(site.bestTime).getTime() - (site.travelTime * 60000));
            const formattedLeave = leaveTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            console.log(`✅ Suggestion: Leave for ${site.name} at ${formattedLeave}`);
        } else {
            console.warn(`skipping time log for ${site.name}: bestTime missing or invalid.`);
        }
    });
};

async function handleSearch() {
    const query = document.querySelector("#location_input").value;
    if (!query) return;

    currentSearchId++;
    const thisSearchId = currentSearchId;

    if (activeAbortController) activeAbourtController.abort();
    activeAbortController = new AbortController();
    
    const decisionSpan = document.querySelector("#hero_decision");
    const loader = document.getElementById('ai-loader');
    const statusText = document.getElementById('ai-status-text');
    const spinner = loader.querySelector(".spinner");
    const weeklyContainer = document.querySelector("#weekly_outlook");

    if (decisionSpan) {
        decisionSpan.textContent = "The universe is calling; let’s find where it’s clearest.";
    }

    if (weeklyContainer) {
        weeklyContainer.classList.add('hidden');
        weeklyContainer.innerHTML = "";
    }

    if (loader) {
        loader.classList.remove('hidden');
    }

    if (spinner) {
        spinner.classList.remove('hidden');
    }

    if (statusText) {
        statusText.innerText = "🔍 Starting new search...";
    }

    console.log(`Searching for: ${query}...`);

    try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
        const response = await fetch(url, { headers: { 'User-Agent': 'StellaView-App'}, signal: activeAbortController.signal});
        const data = await response.json();

        if (data.length > 0) {
            if (thisSearchId !== currentSearchId) return;

            const newCoords = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon)};
            console.log("Found location:", data[0].display_name);
            statusText.innerText = "📌 Location found...";

            const prefs = await getActivePrefs();
            await updateUI(newCoords, prefs);

        } else {
            alert("Location not found. Try a different city!");
            loader.classList.add('hidden');
        }
    } catch (err) {
        if (err.name === 'AbortError') console.log("Old search aborted.");
        else console.error("Search failed:", err);
    }
}

const updateUI = async (coords, prefs, sessionId = null) => {
    if (sessionId && sessionId !== currentSearchId) {
        console.log(`Stopping old session: ${sessionId}`);
        return;
    }

    const loader = document.getElementById('ai-loader');
    const statusText = document.getElementById('ai-status-text');
    const weeklyContainer = document.querySelector("#weekly_outlook");

    loader.classList.remove('hidden');
    statusText.innerText = "🔦 Looking for Stargazing Sites...";

    console.log(`Updating UI for ${coords.lat}, ${coords.lon}`);
    const date = new Date();
    const allSites = await api.getNearbyDarkPlaces(coords.lat, coords.lon, prefs.maxDriveTime);

    if (sessionId !== null && sessionId !== currentSearchId) return;

    if (allSites.length === 0) {
        statusText.innerText = "🔧 Dark sky servers are busy. Retrying...";
        return;
    }
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

    const sorted = sites.sort((a, b) => b.score - a.score);
    const topSite = sorted[0];
    const otherSites = sorted.slice(1, 5);

    const container = document.querySelector("#results-container");
    const featuredContainer = document.querySelector("#feature-container");
    if (container) container.innerHTML = "";
    if (featuredContainer) container.innerHTML = "";

    if (sites.length > 0) {
        decisionSpan.textContent = "Tonight is a good night for stargazing.";

        if (featuredContainer && topSite) {
            renderFeaturedSite(topSite, featuredContainer);
        }

        displayResults(otherSites, prefs);

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

function renderFeaturedSite(site, container) {
    let rawDate = site.bestTime;
    let targetArrival;

    if (rawDate instanceof Date) {
        targetArrival = rawDate;
    } else if (typeof rawDate === "string") {
        const formatted = rawDate.includes('T') ? rawDate : rawDate.replace(' ', 'T') + 'Z';
        targetArrival = new Date(formatted);
    } else {
        targetArrival = new Date();
    }

    const driveTime = Math.round(site.travelTime || 0);

    const leaveDate = new Date(targetArrival.getTime() - (driveTime) * 60000);

    const cloudVal = (site.avgClouds !== undefined && site.avgClouds !== null) ? Math.round(site.avgClouds) : '--';
    const tempDisplay = (site.avgTemp !== undefined && site.avgTemp !== null) ? Math.round(site.avgTemp) : '--';

    const timeOptions = {hour: 'numeric', minute: '2-digit', hour12: true};
    const viewingStr = targetArrival.toLocaleTimeString([], timeOptions);
    const leaveStr = leaveDate.toLocaleTimeString([], timeOptions);

    container.innerHTML = `
    <div class="featured-card">
    <h3>${site.name} <span class="top_Score">(${site.score}% Match)</span></h3>
    <p class=top_Temp>${site.avgTemp}°F</p>
    <p><strong>Bortle:</strong> ${site.bortle || 'N/A'} </p>
    <p><strong>Viewing Starts:</strong> ${viewingStr}</p>
    <p><strong>Window:</strong> ${site.duration || '0'} hours of clear sky</p>
    <p><strong>${cloudVal}% clouds</p>
    <p><strong>Drive Time:</strong> ~${driveTime} mins</p>
    <p class="leave-time">Leave by: ${leaveStr}</p>
    `
}

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