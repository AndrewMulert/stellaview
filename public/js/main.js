console.log("!!! MAIN.JS IS LOADED !!!");

import { findBestSites, findWeeklyOutlook, renderWeeklyOutlook } from './engine.js';
import { getActivePrefs } from './config.js';
import { trainStellaBrain, predictWithBrain } from './brain.js';
import * as api from "./api.js";

const yearSpan = document.querySelector("#year");
const timeSpan = document.querySelector("#home_time");
const decisionSpan = document.querySelector("#hero_decision");
let wakeLock = null;
let lastSearchTime = 0;
const SEARCH_COOLDOWN = 15000;

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
let currentUser = null;

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log("☀️ Wake Lock active. Stella won't sleep.");
        }
    } catch (err) {
        console.warn("WakeLock failed:", err.message);
    }
}

async function initAI() {
    const loader = document.getElementById('ai-loader');
    const statusText = document.getElementById('ai-status-text');

    try{
        loader.classList.remove('hidden');
        const MODEL_VERSION = "2.2.3_personalized_results";
        const MAX_AGE_MS = 30 * 24 * 60 * 1000;

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
            const prefs = await getActivePrefs(window.currentUser);
            trainedModel = await trainStellaBrain(prefs);
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

async function initializeUserSession() {
    try {
        const response = await fetch(`/api/user/me?t=${Date.now()}`, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });

        if (response.ok) {
            const user = await response.json();
            console.log("✅ Welcome back, " + user.accountInfo.firstName);
            window.currentUser = user;
            updateModalView(user);

            const cache = user.preferences?.cachedNearbySites;
            if (cache && cache.sites && cache.sites.length > 0) {
                console.log(`🧠 Warming Engine with ${cache.sites.length} known locations...`);
                window.engineWarmth = cache.sites;
            }
            updateModalView(user);
            return;
        }

        console.log("👤 No session found. Running as Guest.");
    } catch (err) {
        console.warn("🌐 Connection issue checking session. Defaulting to Guest.", err);
    } 

    window.currentUser = null;
    updateModalView(null);
}

async function runStargazingEngine() {
    const loader = document.getElementById('ai-loader');
    const statusText = document.getElementById('ai-status-text');
    const container = document.getElementById('results-container');

    if (container) {
        container.classList.add("hidden");
        container.innerHTML = "";
    }

    console.log("Step 1: Engine function called");

    const prefs = await getActivePrefs(window.currentUser);
    console.log("Step 2: Prefs loaded:", prefs);

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
        await updateUI(userLoc, prefs, thisSearchId, false);
    },
    async (err) => {
        let errorType = "Unknown Error";
        if (err.code === 1) errorType = "Permission Denied";
        if (err.code === 2) errorType = "Position Unavailable";
        if (err.code === 3) errorType = "Timeout";

        console.info(`Location Error: ${errorType}. Using fallback from config.`);

        let fallback = prefs.homeLocation;

        if (!fallback || fallback.lat === null || fallback.lat === undefined) {
            console.error("🚨 User prefs homeLocation is invalid. Falling back to System Default (Yellowstone).");
            import('./config.js').then(m => {
                fallback = m.DEFAULT_PREFS.homeLocation;
                updateUI(fallback, prefs, thisSearchId);
            });

            return;
        }
        await updateUI(fallback, prefs, thisSearchId, true);
    },
    {timeout: 8000, enableHighAccuracy: false}
);
}

function displayResults(sites, prefs) {
    const container = document.querySelector("#results-container");
    if (!container) return;

    container.classList.add("hidden");
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

        let scoreMessage = "";
        let scorePriority = "";
        if (site.score && site.score !== null) {
            if (site.score >= 80) {
                scorePriority = "score_best";
                scoreMessage = "This site is exceptional for stargazing";
            } else if (site.score >= 60) {
                scorePriority = "score_good";
                scoreMessage = "This site is good for stargazing";
            } else if (site.score >= 40) {
                scorePriority = "score_okay";
                scoreMessage = "This site is okay for stargazing";
            } else if (site.score >= 20) {
                scorePriority = "score_bad";
                scoreMessage = "This site is bad for stargazing";
            } else {
                scorePriority = "score_terrible";
                scoreMessage = "This site is terrible for stargazing";
            }
        }

        const card = document.createElement("div");
        card.className = "site-card";
        card.innerHTML = `
            <div class="card_title">
                <h3>${site.name}</h3>
                <span class="${scorePriority} card_score" title="${scoreMessage}">(${site.score}% Match)</span>
            </div>
            <p class="card_temp"><strong>${tempDisplay} °F</strong></p>
            <div class="card_bortle">
                <svg id="featured_details_svg" width="20px" height="20px"><image width="20px" height="20px" href="/images/icon_info_bortle.svg"></image></svg>
                <p><strong>Bortle:</strong> ${site.bortle || 'N/A'} </p>
            </div>
            <div class="card_duration">
                <svg id="featured_details_svg" width="20px" height="20px"><image width="20px" height="20px" href="/images/icon_info_duration.svg"></image></svg>
                <p><strong>Window:</strong> ${site.duration || '0'} hours</p>
            </div>
            <div class="card_cloud">
                <svg id="featured_details_svg" width="20px" height="20px"><image width="20px" height="20px" href="/images/icon_info_cloudy.svg"></image></svg>
                <p><strong>${cloudVal}%</strong> clouds</p>
            </div>
            <div class="card_viewing">
                <svg id="featured_details_svg" width="20px" height="20px"><image width="20px" height="20px" href="/images/icon_info_view.svg"></image></svg>
                <p><strong>Viewing:</strong> ${viewingStr}</p>
            </div>
            <div class="card_drive">
                <svg id="featured_details_svg" width="20px" height="20px"><image width="20px" height="20px" href="/images/icon_info_drive.svg"></image></svg>
                <p><strong>Travel:</strong> ~${driveTime} mins</p>
            </div>
            <div class="card_leave"> 
                <svg id="featured_details_svg" width="20px" height="20px"><image width="20px" height="20px" href="/images/icon_info_time.svg"></image></svg>
                <p class="leave-time"><strong>Leave by: </strong>${leaveStr}</p>
            </div>
            <div class="card_directions">
                <a href="${site.mapUrl}" target="_blank"><svg id="featured_details_svg" width="20px" height="20px"><image width="20px" height="20px" href="/images/icon_info_directions.svg"></image></svg></a>
                <a class="card_link" href="${site.mapUrl}" target="_blank"><strong>Directions</strong></a>
            </div>
        `;
        container.classList.remove("hidden");
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
    const now = Date.now();
    if (now - lastSearchTime < SEARCH_COOLDOWN) {
        const remaining = Math.ceil((SEARCH_COOLDOWN - (now - lastSearchTime)) / 1000);
        const statusText = document.getElementById('ai-status-text');
        if (statusText) statusText.innerText = `⏳ Please wait ${remaining}s before searching again...`;
        return;
    }

    const query = document.querySelector("#location_input").value;
    if (!query) return;

    lastSearchTime = Date.now();

    currentSearchId++;
    const thisSearchId = currentSearchId;

    if (activeAbortController) activeAbortController.abort();
    activeAbortController = new AbortController();
    
    const decisionSpan = document.querySelector("#hero_decision");
    const featuredSpan = document.querySelector("#feature_container");
    const loader = document.getElementById('ai-loader');
    const statusText = document.getElementById('ai-status-text');
    const spinner = loader.querySelector(".spinner");
    const weeklyContainer = document.querySelector("#weekly_outlook");
    const container = document.querySelector("#results-container");

    if (decisionSpan) {
        decisionSpan.textContent = "The universe is calling; let’s find where it’s clearest.";
    }

    if (featuredSpan) {
        featuredSpan.classList.add('hidden');
        featuredSpan.innerHTML = "";
    }

    if (container) {
        container.classList.add('hidden');
        container.innerHTML = "";
    }

    if (weeklyContainer) {
        weeklyContainer.classList.add('hidden');
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

            const prefs = await getActivePrefs(currentUser);
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

    const driveMinutes = prefs.maxDriveTime || 60;
    const searchRadiusKM = (driveMinutes / 60) * 45 * 1.60934;
    const allSites = await api.getNearbyDarkPlaces(coords.lat, coords.lon, searchRadiusKM);

    if (sessionId !== null && sessionId !== currentSearchId) return;

    if (!allSites || allSites.length === 0) {
        const statusText = document.getElementById('ai-status-text');
        const spinner = loader.querySelector(".spinner");
        if (spinner) spinner.classList.add('hidden');
        if (statusText){
            statusText.innerText = "🔭 No sites found or servers busy. Retrying in 30s...";
        };

        setTimeout(() => {
            if (loader) loader.classList.add('hidden');
        }, 5000);

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
    if (container){
        container.innerHTML = "";
        container.classList.add('hidden');
    }
    
    if (featuredContainer) featuredContainer.innerHTML = "";

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

        syncSearchResults(coords, sites);
    } else {
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

        const shortlisted = allSites;

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
    
    
    let scorePriority = "";
    let scoreMessage = "";
    if (site.score && site.score !== null) {
        if (site.score >= 80) {
            scorePriority = "score_best";
            scoreMessage = "This site is exceptional for stargazing";
        } else if (site.score >= 60) {
            scorePriority = "score_good";
            scoreMessage = "This site is good for stargazing";
        } else if (site.score >= 40) {
            scorePriority = "score_okay";
            scoreMessage = "This site is okay for stargazing";
        } else if (site.score >= 20) {
            scorePriority = "score_bad";
            scoreMessage = "This site is bad for stargazing";
        } else {
            scorePriority = "score_terrible";
            scoreMessage = "This site is terrible for stargazing";
        }
    }

    container.innerHTML = `
    <div class="site-card">
        <div class="card_title">
            <h3>${site.name}</h3>
            <span class="${scorePriority} card_score" title="${scoreMessage}">(${site.score}% Match)</span>
        </div>
        <p class="card_temp"><strong>${tempDisplay} °F</strong></p>
        <div class="card_bortle featured-element">
            <svg id="featured_details_svg" width="20px" height="20px"><image width="20px" height="20px" href="/images/icon_info_bortle.svg"></image></svg>
            <p><strong>Bortle:</strong> ${site.bortle || 'N/A'} </p> 
        </div>
        <div class="card_duration">
            <svg id="featured_details_svg" width="20px" height="20px"><image width="20px" height="20px" href="/images/icon_info_duration.svg"></image></svg>
            <p><strong>Window:</strong> ${site.duration || '0'} hours</p>
        </div>
        <div class="card_cloud">
            <svg id="featured_details_svg" width="20px" height="20px"><image width="20px" height="20px" href="/images/icon_info_cloudy.svg"></image></svg>
            <p><strong>${cloudVal}%</strong> clouds</p>
        </div>
        <div class="card_viewing">
            <svg id="featured_details_svg" width="20px" height="20px"><image width="20px" height="20px" href="/images/icon_info_view.svg"></image></svg>
            <p><strong>Viewing:</strong> ${viewingStr}</p>
        </div>
        <div class="card_drive">
            <svg id="featured_details_svg" width="20px" height="20px"><image width="20px" height="20px" href="/images/icon_info_drive.svg"></image></svg>
            <p><strong>Travel:</strong> ~${driveTime} mins</p>
        </div>
        <div class="card_leave">
            <svg id="featured_details_svg" width="20px" height="20px"><image width="20px" height="20px" href="/images/icon_info_time.svg"></image></svg>
            <p><strong>Leave by:</strong> ${leaveStr}</p>
        </div>
        <div class="card_directions">
            <a href="${site.mapUrl}" target="_blank"><svg id="featured_details_svg" width="20px" height="20px"><image width="20px" height="20px" href="/images/icon_info_directions.svg"></image></svg></a>
            <a class="card_link" href="${site.mapUrl}" target="_blank"><strong>Directions</strong></a>
        </div>
    `
}

async function syncSearchResults(coords, sites) {
    if (!window.currentUser || !Array.isArray(sites) || sites.length === 0) return;

    try {
        const discoveryData = sites.map(site => ({
            name: site.name,
            lat: site.lat,
            lon: site.lon,
            bortle: site.bortle,
            vegetation: site.ndvi || 0,
            distance: site.travelTime || 0,
            osmId: site.osmId || `gen_${Math.random().toString(36).substr(2, 9)}`,
            score: site.score,
            bestTime: site.bestTime,
            avgTemp: site.avgTemp,
            avgClouds: site.avgClouds
        }));
        
        const response = await fetch('/api/user/save-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discoveredSites: discoveryData}),
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        console.log("✅ Sync successful:", data);
    } catch (err) {
        console.error("Discovery sync failed:", err);
    }
}

document.addEventListener('click', (e) => {
    if (e.target.closest('#search_btn')) {
        handleSearch()
    }
});

document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && e.target.id === 'location_input') handleSearch();
});

document.addEventListener("visibilityChange", () => {
    if (document.visibilityState === "visible") {
        if (!document.getElementById('ai-loader').classList.contains('hidden')) {
            console.log("♻️ Stella resumed. Ensuring AI is still active...");
            if (!trainedModel) initAI();
        }
    }
});

document.getElementById('hero_details').addEventListener('click', () => {
    const drawer = document.getElementById('stella-drawer');
    const chevron = document.querySelector('button#hero_details #hero_details_svg');

    drawer.classList.toggle('hidden');

    chevron.classList.toggle('rotate-chevron');
});

async function startApp() {
    console.log("🚀 Initializing StellaView...");
    await initializeUserSession();
    await initAI();
    await runStargazingEngine();
}

window.addEventListener('load', startApp);
