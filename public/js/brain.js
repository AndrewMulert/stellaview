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
    const totalEpochs = 30;
    const data = generateMockHistory(300, prefs);

    const inputs = tf.tensor2d(data.map(d => d.input));
    const outputs = tf.tensor2d(data.map(d => d.output));

    const model = tf.sequential();
    model.add(tf.layers.dense({ units: 16, inputShape: [15], activation: 'relu'}));
    model.add(tf.layers.dense({ units: 8, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));

    model.compile({
        optimizer: tf.train.adam(0.01),
        loss: 'meanSquaredError'
    });

    console.log(`Brain training started... ${new Date()}`);
    await model.fit(inputs, outputs, {
        epochs: totalEpochs,
        batchSize: 32,
        shuffle: true,
        callbacks: {
            onEpochEnd: async (epoch, logs) => {
                const percent = Math.round(((epoch + 1) / totalEpochs) * 100);
                if (onProgress) onProgress(percent);
                if (logs.loss < 0.005) model.stopTraining = true;
                if (epoch % 10 === 0) {
                    console.log(`Epoch ${epoch}: Loss = ${logs.loss.toFixed(4)}, Time = ${new Date()}`);
                    await tf.nextFrame();
                };
            }
        }
    });

    inputs.dispose();
    outputs.dispose();

    console.log(`Brain training complete! ${new Date()}`);
    return model;
}

export async function predictWithBrain(model, allSites, userLoc, prefs, preFetchedData = null, context = null) {
    let failureCounts = {clouds: 0, cold: 0, hot: 0, moon: 0, aqi: 0, bortle: 0, distance: 0};
    const statusText = document.getElementById('ai-status-text');
    const loader = document.getElementById('ai-loader');

    if (loader) loader.classList.remove('hidden');

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
    const tracker = (context && context.tracker) ? context.tracker : null;
    loader.classList.remove('hidden');

    const validSitesData = [];

    const processSite = (async (site, i) => {
        const siteKey = `${site.lat.toFixed(2)}_${site.lon.toFixed(2)}_${hourKey}`;
        let data;

        try {
            if (BRAIN_CACHE.has(siteKey)) {
                data = BRAIN_CACHE.get(siteKey);
            } else {
                const weather = await checkWeatherWindow(site, windowStart, windowEnd, prefs);
                const aqi = await checkAirQuality(site);
                const radiance = await getRadianceValue(site.lat, site.lon, lightTiles);
                const siteNDVI = await getNDVI(site.lat, site.lon, vegTiles);

                const moonPos = SunCalc.getMoonPosition(new Date(weather.bestTime), site.lat, site.lon);
                const travelTime = (roadTimes && roadTimes[i] !== undefined) ? roadTimes[i] : calculateDriveTime(userLoc, site);

                data = { weather, aqi, radiance, siteNDVI, travelTime, seasonalMean: regionalMeanTemp, moonIsUpNow: moonPos.altitude > 0 ? 1 : 0};
                BRAIN_CACHE.set(siteKey, data);
            }

            if (!data.weather.success || (data.travelTime > (prefs.maxDriveTime || 120) * 1.1)) {
                const reason = !data.weather.success ? data.weather.reason : 'distance';
                failureCounts[reason]++;
                return;
            }

            const moonIllum = getMoonIllumination(data.weather.bestTime || new Date());
            const pm25 = data.aqi.hourly?.pm2_5?.[0] || 5;
            const startOffset = Math.max(0, (new Date(data.weather.bestTime) - new Date()) / 3600000);

            validSitesData.push({ originalIndex: i, site, duration: data.weather.duration, weather: data.weather, travelTime: data.travelTime, inputData: normalizeInputs(data.radiance, site, data.weather, (data.moonIsUpNow ? moonIllum : 0), data.travelTime, prefs, { ...data.aqi, pm25 }, startOffset, data.siteNDVI, site.trustFactor || 0.5, data.moonIsUpNow, (data.seasonalMean ?? data.weather.avgTemp ?? 50))});
        } catch (err){
            failureCounts.clouds++;
        }
    });

    const queue = [...semiFilteredSites.entries()];

    const delay = (ms) => new Promise(res => setTimeout(res, ms));

    async function worker() {
        while (queue.length > 0) {
            const [index, site] = queue.shift();

            const jitter = Math.floor(Math.random() * 500) + 300;
            await new Promise(res => setTimeout(res, jitter));

            await processSite(site, index);
            
            if (tracker) {
                tracker.completed++
            } else {
                completedCount++;
            }

            if (statusText) {
                let overallProgress = 0;
                if (context && context.mode === 'weekly') {
                    const current = tracker ? tracker.completed : completedCount;
                    const total = context.totalSites || 1;
                    overallProgress = Math.min(Math.round((current / total) * 100), 100);
                    statusText.innerText = `🗓️ Building Weekly Outlook... ${overallProgress}%`;
                } else {
                    overallProgress = Math.round((completedCount / semiFilteredSites.length) * 100);
                    statusText.innerText = `🧠 Making Decision... ${overallProgress}%`;
                }
            } 
            
        }
    }

    await Promise.all(
        Array(Math.min(2, semiFilteredSites.length))
        .fill(null)
        .map((_, i) => delay(i * 800).then(() => worker()))
    );

    let validSites = [];

    if (validSitesData.length > 0) {
        validSitesData.sort((a, b) => a.originalIndex - b.originalIndex);

        const scores = tf.tidy(() => {
            const tensorInputs = tf.tensor2d(validSitesData.map(d => d.inputData), [validSitesData.length, 15]);
            const predictions = model.predict(tensorInputs);
            return predictions.dataSync();
        });

        validSites = validSitesData.map((d, i) => ({
            ...d.site,
            radiance: d.radiance,
            siteNDVI: d.siteNDVI,
            rawScore: scores[i],
            travelTime: d.travelTime,
            bestTime: new Date(d.weather.bestTime),
            duration: d.duration,
            avgTemp: d.weather.avgTemp,
            avgClouds: d.weather.avgClouds,
            mapUrl: `https://www.google.com/maps/dir/?api=1&origin=${userLoc.lat},${userLoc.lon}&destination=${d.site.lat},${d.site.lon}`
        }));

        const rawScores = validSites.map(s => s.rawScore);
        const maxRaw = Math.max(...rawScores);
        const minRaw = Math.min(...rawScores);
        const range = maxRaw - minRaw;

        validSites.forEach(site => {
            let normalizedRel = range > 0 ? (site.rawScore - minRaw) / range : 1.0;
            let humanScore = 65 + (normalizedRel * 33);
            site.score = humanScore.toFixed(1);
        });
        validSites.sort((a, b) => b.score - a.score);
    }

    const hasFailures = Object.values(failureCounts).some(v => v > 0);
    const topFailure = hasFailures ? Object.keys(failureCounts).reduce((a, b) => failureCounts[a] > failureCounts[b] ? a : b) : 'distance';

    return { sites: validSites, topFailure};
}