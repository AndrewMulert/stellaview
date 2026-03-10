import SunCalc from 'https://esm.sh/suncalc@1.9.0';
import 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js';
import { checkWeatherWindow, checkAirQuality } from './engine.js';
import { calculateDriveTime, getMoonIllumination, getRadianceValue, normalizeInputs, radianceToBortle, getActualDriveTimes, getNDVI} from './utils.js';
import { generateMockHistory } from './trainer.js';
import * as api from './api.js';

const tf = window.tf;

export async function trainStellaBrain(prefs) {
    const data = generateMockHistory(1500, prefs);

    const inputs = tf.tensor2d(data.map(d => d.input));
    const outputs = tf.tensor2d(data.map(d => d.output));

    const model = tf.sequential();
    model.add(tf.layers.dense({ units: 20, inputShape: [15], activation: 'relu'}));
    model.add(tf.layers.dense({ units: 10, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));

    model.compile({
        optimizer: tf.train.adam(0.01),
        loss: 'meanSquaredError'
    });

    console.log("Brain training started...");
    await model.fit(inputs, outputs, {
        epochs: 30,
        batchSize: 64,
        yieldEveryIteration: true,
        shuffle: true,
        validationSplit: 0.1,
        callbacks: {
            onEpochEnd: (epoch, logs) => {
                if (logs.loss < 0.001) model.stopTraining = true;
                if (epoch % 10 === 0) {
                    console.log(`Epoch ${epoch}: Loss = ${logs.loss.toFixed(4)}, Time = ${new Date()}`)};
                }
        }
    });

    inputs.dispose();
    outputs.dispose();

    console.log("Brain training complete!");
    return model;
}

export async function predictWithBrain(model, allSites, userLoc, prefs, preFetchedData = null) {
    let failureCounts = {clouds: 0, cold: 0, hot: 0, moon: 0, aqi: 0};
    const statusText = document.getElementById('ai-status-text');
    const loader = document.getElementById('ai-loader');

    const lat = userLoc?.lat || 44.4605;
    const lon = userLoc?.lon || -110.8281;
    const sunTimes = SunCalc.getTimes(new Date(), lat, lon);
    const astroDusk = sunTimes.astronomicalDusk ? new Date(sunTimes.astronomicalDusk) : new Date(new Date().setHours(20, 0, 0, 0));
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
    
    let windowStart = new Date(Math.max(new Date(), astroDusk.getTime()));
    const bufferTime = (prefs.departureLeadTime || 30) * 60 * 1000;
    const travelPadding = 60 * 60 * 1000;
    let windowEnd = new Date(userHomeCutoff.getTime() - travelPadding - bufferTime);
    if (windowEnd <= windowStart) windowEnd = new Date(windowStart.getTime() + (60 * 60 * 1000));
    

    console.log(`🌌 Search Window: ${windowStart.toLocaleTimeString()} to ${windowEnd.toLocaleTimeString()}`);

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

        roadTimes = await getActualDriveTimes(userLoc, allSites);
    }

    let completedCount = 0;
    loader.classList.remove('hidden');

    const sitePromises = allSites.map(async (site, i) => {
        const statusText = document.getElementById('ai-status-text');
        const seasonalMean = preFetchedData?.seasonalMean || (await api.getMeanTemperature(site.lat, site.lon));

        let weather, aqi, radiance, siteNDVI, travelTime, moonIsUpNow;

        travelTime = (roadTimes && roadTimes[i] !== undefined) ? roadTimes[i] : calculateDriveTime(userLoc, site);
        const maxDrive = (prefs.maxDriveTime || 120);
        if (travelTime > maxDrive * 1.1) return null;
        

        if(preFetchedData) {
            weather = preFetchedData.weather;
            aqi = preFetchedData.aqi;
            radiance = preFetchedData.radiance || 0;
            siteNDVI = preFetchedData.ndvi || 0.1;
            travelTime = preFetchedData.travelTime;
            moonIsUpNow = preFetchedData.moonIsUp !== undefined ? preFetchedData.moonIsUp : 0;
            seasonalMean = preFetchedData.seasonalMean;
        } else {
           [weather, aqi, radiance, siteNDVI] = await Promise.all([
                checkWeatherWindow(site, windowStart, windowEnd, prefs),
                checkAirQuality(site),
                getRadianceValue(site.lat, site.lon, lightTiles),
                getNDVI(site.lat, site.lon, vegTiles)
           ]);

            const moonPos = SunCalc.getMoonPosition(new Date(weather.bestTime), site.lat, site.lon);
            moonIsUpNow = moonPos.altitude > 0 ? 1 : 0;
        }

        completedCount++;
        statusText.innerText = `🧠 Making Decision... ${Math.round((completedCount / allSites.length) * 100)}%`;

        console.log(`Checking ${site.name}: Weather=${weather.success}, AQI=${aqi.success}`);

        const moonIllum = getMoonIllumination(weather.bestTime || new Date());
        
        if (moonIllum > 0.85 && moonIsUpNow) {
            failureCounts.moon++;
            return null;
        }

        if (!weather.success || !aqi.success) {
            const reason = !weather.success ? weather.reason : 'aqi';
            failureCounts[reason]++;
            return null;
        }

        const siteBortle = radianceToBortle(radiance);
        if (prefs.maxBortle && siteBortle > prefs.maxBortle) return null;

        const pm25Value = (aqi.hourly && aqi.hourly.pm2_5) ? aqi.hourly.pm2_5[0] || 5 : 5;
            const now = new Date();
            const startOffset = Math.max(0, (new Date(weather.bestTime) - now) / 3600000);
        
        const aqiDataForBrain = { ...aqi, pm25: pm25Value };

        const trustFactor = site.trustFactor || 0.5;


        const score = tf.tidy(() => {
            const inputData = normalizeInputs(radiance, site, weather, moonIllum, travelTime, prefs, aqiDataForBrain, startOffset, siteNDVI, trustFactor, moonIsUpNow, seasonalMean);
            const inputTensor = tf.tensor2d([inputData], [1, 15]);
            const prediction = model.predict(inputTensor);
            console.log("Normalized (The 0-1 values):", inputData);
            return prediction.dataSync()[0];
        });

        console.groupCollapsed(`📊 Brain Audit: ${site.name} (${(score * 100).toFixed(1)}%)`);
        console.log("Raw Sensor Data:", { radiance, siteNDVI, clouds: weather.avgClouds, temp: weather.avgTemp });
        console.log("Final AI Score:", score);
        console.groupEnd();

        const brainStats = {
            clouds: weather.avgClouds,
            temp: (prefs.tempUnit === 'celsius') ? (weather.avgTemp * 9/5) + 32 : weather.avgTemp, 
            pm25: pm25Value
        };

        const origin = `${userLoc.lat},${userLoc.lon}`;
        const destination = `${site.lat},${site.lon}`;


        console.log(`🧠 Brain Scoring: ${site.name} | Raw Score: ${score}`);

        const boostedScore = (score * 100).toFixed(1);

        console.group(`📊 Data Audit: ${site.name}`);
        console.log("1. Sensor Raw:", {
            radiance: radiance,
            siteNDVI: siteNDVI,
            clouds: brainStats.clouds,
            temp: brainStats.temp,
            moon: moonIllum,
            travel: travelTime
        });
        console.log("3. Final Result:", {
            rawScore: score,
            boosted: boostedScore
        });
        console.groupEnd();

        return({
            ...site,
            radiance: radiance,
            ndvi: siteNDVI,
            bortle: radianceToBortle(radiance),
            rawScore: score,
            travelTime: travelTime,
            bestTime: weather.bestTime,
            duration: weather.duration,
            avgTemp: weather.avgTemp,
            avgClouds: weather.avgClouds,
            score: 0,
            mapUrl: `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`
        });
    });

    const results = await Promise.all(sitePromises);
    const validSites = results.filter(s => s !== null);

    if (validSites.length > 0) {
        validSites.forEach(site => {
            let humanScore = Math.pow(site.rawScore, 0.4) * 100;
            site.score = Math.min(99.9, humanScore).toFixed(1);
        });
        validSites.sort((a, b) => b.score - a.score);
    }

    const hasFailures = Object.values(failureCounts).some(v => v > 0);
    const topFailure = hasFailures ? Object.keys(failureCounts).reduce((a, b) => failureCounts[a] > failureCounts[b] ? a : b) : 'distance';

    return { sites: validSites, topFailure};
}