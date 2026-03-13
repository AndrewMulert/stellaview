import SunCalc from 'https://esm.sh/suncalc@1.9.0';
import 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js';
import { checkWeatherWindow, checkAirQuality } from './engine.js';
import { calculateDriveTime, getMoonIllumination, getRadianceValue, normalizeInputs, radianceToBortle, getActualDriveTimes, getNDVI} from './utils.js';
import { generateMockHistory } from './trainer.js';
import * as api from './api.js';

const tf = window.tf;

async function initTF() {
    await tf.ready();
    if (tf.engine().backendName !== 'webgpu') {
        await tf.setBackend('webgl');
    }
    console.log("🚀 TensorFlow.js initialized on:", tf.getBackend());
}
initTF();

const BRAIN_CACHE = new Map();

export async function trainStellaBrain(prefs, onProgress) {
    const totalEpochs = 20;
    const data = generateMockHistory(450, prefs);

    const inputs = tf.tensor2d(data.map(d => d.input));
    const outputs = tf.tensor2d(data.map(d => d.output));

    const model = tf.sequential();
    model.add(tf.layers.dense({ units: 32, inputShape: [15], activation: 'relu'}));
    model.add(tf.layers.dropout({ rate: 0.1 }));
    model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));

    model.compile({
        optimizer: tf.train.adam(0.02),
        loss: 'meanSquaredError'
    });

    console.log(`Brain training started... ${new Date()}`);
    await model.fit(inputs, outputs, {
        epochs: totalEpochs,
        batchSize: 32,
        shuffle: true,
        validationSplit: 0.1,
        callbacks: {
            onEpochEnd: (epoch, logs) => {
                const percent = Math.round(((epoch + 1) / totalEpochs) * 100);
                if (onProgress) onProgress(percent);
                if (logs.loss < 0.001) model.stopTraining = true;
                if (epoch % 5 === 0) {
                    console.log(`Epoch ${epoch}: Loss = ${logs.loss.toFixed(4)}, Time = ${new Date()}`)};
                }
        }
    });

    inputs.dispose();
    outputs.dispose();

    console.log(`Brain training complete! ${new Date()}`);
    return model;
}

export async function predictWithBrain(model, allSites, userLoc, prefs, preFetchedData = null) {
    let failureCounts = {clouds: 0, cold: 0, hot: 0, moon: 0, aqi: 0, bortle: 0, distance: 0};
    const statusText = document.getElementById('ai-status-text');
    const loader = document.getElementById('ai-loader');

    const lat = userLoc?.lat || 44.4605;
    const lon = userLoc?.lon || -110.8281;
    const sunTimes = SunCalc.getTimes(new Date(), lat, lon);
    const astroDusk = sunTimes.astronomicalDusk ? new Date(sunTimes.astronomicalDusk) : new Date(new Date().setHours(20, 0, 0, 0));
    let windowStart = new Date(Math.max(new Date(), astroDusk.getTime()));
    const hourKey = windowStart.getHours();

    const tomorrowDawn = new Date();
    tomorrowDawn.setDate(tomorrowDawn.getDate() + 1);
    tomorrowDawn.setHours(5, 0, 0, 0);
    const astroDawn = sunTimes.astronomicalDawn ? new Date(sunTimes.astronomicalDawn) : tomorrowDawn;

    let userHomeCutoff = new Date(astroDusk);

    if (prefs.latestStayOut) {
        const [hours, minutes] = (prefs.latestStayOut || "02:00").split(':');
        let prefDate = new Date(astroDusk);
        prefDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        if (parseInt(hours) < 12) prefDate.setDate(prefDate.getDate() + 1);
        userHomeCutoff = prefDate < astroDawn ? prefDate : astroDawn;
    }
    
    const bufferTime = (prefs.departureLeadTime || 30) * 60 * 1000;
    const travelPadding = 60 * 60 * 1000;
    let windowEnd = new Date(userHomeCutoff.getTime() - travelPadding - bufferTime);
    const minimumWindowEnd = new Date(windowStart.getTime() + (60 * 60 * 1000));
    if (windowEnd < minimumWindowEnd) {
        windowEnd = minimumWindowEnd;
    }
    

    console.log(`🌌 Search Window: ${windowStart.toLocaleTimeString()} to ${windowEnd.toLocaleTimeString()}`);

    statusText.innerText ="📡 Fetching regional climate data...";
    const regionalMeanTemp = await api.getMeanTemperature(lat, lon);

    let lightTiles = null, vegTiles = null, roadTimes = null;
    if (!preFetchedData) {
        const [lightRes, vegRes] = await Promise.all([
            fetch('https://andrewmulert.github.io/light_tiles/manifest.json'),
            fetch('https://AndrewMulert.github.io/vegetation_tiles/manifest.json')
        ]);
        const lightData = await lightRes.json();
        const vegData = await vegRes.json();
        lightTiles = lightData.tiles;
        vegTiles = vegData.tiles || vegData.available_tiles;
    }

    const hydratedSites = await Promise.all(allSites.map(async (site) => {
        const rad = await getRadianceValue(site.lat, site.lon, lightTiles);
        return {...site, radiance: rad, bortle: radianceToBortle(rad)};
    }));

    const semiFilteredSites = hydratedSites.filter(site => {
        if (prefs.maxBortle) {
            const limit = prefs.maxBortle || 4;
            if (isNaN(site.bortle)) return true;
            return site.bortle <= (limit + 0.5);
        }
        return true;
    });

    semiFilteredSites.sort((a, b) =>  a.radiance - b.radiance);

    console.log(`✂️ Pruned ${allSites.length - semiFilteredSites.length} light-polluted sites. Processing ${semiFilteredSites.length} viable spots.`);

    if (!preFetchedData && semiFilteredSites.length > 0) {
        roadTimes = await getActualDriveTimes(userLoc, semiFilteredSites);
    } else {
        roadTimes = [];
    }

    let completedCount = 0;
    loader.classList.remove('hidden');

    const lats = allSites.map(s => s.lat).join(',');
    const lons = allSites.map(s => s.lon).join(',');

    const processSite = (async (site, i) => {
        await new Promise(r => setTimeout(r, i * 15));
        const siteKey = `${site.lat.toFixed(2)}_${site.lon.toFixed(2)}_${hourKey}`;
        let data;

        if (BRAIN_CACHE.has(siteKey)) {
            data = BRAIN_CACHE.get(siteKey);
        } else {
            try {
                const [weather, aqi, radiance, siteNDVI] = await Promise.all([
                    checkWeatherWindow(site, windowStart, windowEnd, prefs),
                    checkAirQuality(site),
                    getRadianceValue(site.lat, site.lon, lightTiles),
                    getNDVI(site.lat, site.lon, vegTiles),
                ]);

                const moonPos = SunCalc.getMoonPosition(new Date(weather.bestTime), site.lat, site.lon);
                const travelTime = (roadTimes && roadTimes[i] !== undefined) ? roadTimes[i] : calculateDriveTime(userLoc, site);

                data = { weather, aqi, radiance, siteNDVI, travelTime, seasonalMean: regionalMeanTemp, moonIsUpNow: moonPos.altitude > 0 ? 1 : 0};
                BRAIN_CACHE.set(siteKey, data);
            } catch (err) {
                failureCounts.clouds++
                return null;
            }
        }

        const { weather, aqi, radiance, siteNDVI, travelTime, seasonalMean, moonIsUpNow } = data;

        const maxDrive = (prefs.maxDriveTime || 120);
        if (travelTime > maxDrive * 1.1) {
            failureCounts.distance++;
            return null;
        };

        const siteBortle = radianceToBortle(radiance);
        if (prefs.maxBortle && siteBortle > prefs.maxBortle) {
            failureCounts.bortle++;
            return null
        };

        const moonIllum = getMoonIllumination(weather.bestTime || new Date());
        if (moonIllum > 0.85 && moonIsUpNow) { failureCounts.moon++; return null; }
        
        if (!weather.success || !aqi.success) {
            const reason = !weather.success ? weather.reason: 'aqi';
            if (failureCounts[reason] !== undefined) failureCounts[reason]++;
            return null;
        }

        const score = tf.tidy(() => {
            const pm25 = aqi.hourly?.pm2_5?.[0] || 5;
            const startOffset = Math.max(0, (new Date(weather.bestTime) - new Date()) / 3600000);
            const inputData = normalizeInputs( radiance, site, weather, (moonIsUpNow ? moonIllum : 0), 
                travelTime, prefs, { ...aqi, pm25 }, 
                startOffset, siteNDVI, site.trustFactor || 0.5, 
                moonIsUpNow, (seasonalMean ?? weather.avgTemp ?? 50)
            );
            return model.predict(tf.tensor2d([inputData], [1, 15])).dataSync()[0];
        });

        return {
            ...site,
            radiance, siteNDVI, rawScore: score, travelTime,
            bestTime: weather.bestTime,
            avgTemp: weather.avgTemp, 
            avgClouds: weather.avgClouds,
            mapUrl: `https://www.google.com/maps/dir/?api=1&origin=${userLoc.lat},${userLoc.lon}&destination=${site.lat},${site.lon}`
        };
    });

    const MAX_CONCURRENCY = 3;
    const results = new Array(allSites.length).fill(null);
    const queue = [...semiFilteredSites.entries()];

    async function worker() {
        while (queue.length > 0) {
            const [index, site] = queue.shift();
            const result = await processSite(site, index);
            results[index] = result;

            completedCount++;
            const progress = Math.round((completedCount / semiFilteredSites.length) * 100);
            statusText.innerText = `🧠 Making Decision... ${progress}%`;
            
        }
    }

    await Promise.all(Array(Math.min(MAX_CONCURRENCY, allSites.length)).fill(null).map(() => worker()));

    const validSites = results.filter(s => s !== null);

    if (validSites.length > 0) {
        const rawScores = validSites.map(s => s.rawScore);
        const maxRaw = Math.max(...rawScores);
        const minRaw = Math.min(...rawScores);
        const range = maxRaw - minRaw;

        validSites.forEach(site => {
            let normalizedRel = range > 0 ? (site.rawScore - minRaw) / range: 1.0;
            let humanScore = 65 + (normalizedRel * 33);
            site.score = humanScore.toFixed(1);
        });
        validSites.sort((a, b) => b.score - a.score);
    }

    const hasFailures = Object.values(failureCounts).some(v => v > 0);
    const topFailure = hasFailures ? Object.keys(failureCounts).reduce((a, b) => failureCounts[a] > failureCounts[b] ? a : b) : 'distance';

    return { sites: validSites, topFailure};
}