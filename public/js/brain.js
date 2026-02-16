import 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js';
import { checkWeatherWindow, checkAirQuality } from './engine.js';
import { calculateDriveTime, getMoonIllumination, getRadianceValue, normalizeInputs, radianceToBortle, getActualDriveTimes, getNDVI} from './utils.js';
import { generateMockHistory } from './trainer.js';

const tf = window.tf;

export async function trainStellaBrain() {
    const data = generateMockHistory(1000);

    const inputs = tf.tensor2d(data.map(d => d.input));
    const outputs = tf.tensor2d(data.map(d => d.output));

    const model = tf.sequential();
    model.add(tf.layers.dense({ units: 12, inputShape: [11], activation: 'relu'}));
    /*model.add(tf.layers.dense({ units: 8, activation: 'relu' }));*/
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
    const validSites = [];

    const date = new Date();

    const startOfNight = new Date();
    startOfNight.setHours(20, 30, 0, 0);
    const windowEndTime = new Date(startOfNight.getTime() + 6 * 60 * 60 * 1000);


    let lightTiles = null, vegTiles = null, roadTimes = null;

    if (!preFetchedData) {
        const [lightRes, vegRes] = await Promise.all([
            fetch('https://andrewmulert.github.io/light_tiles/manifest.json'),
            fetch('https://AndrewMulert.github.io/vegetation_tiles/manifest.json')
        ]);
        lightTiles = (await lightRes.json()).tiles;
        const vegManifest = await vegRes.json();
        vegTiles = vegManifest.available_tiles || vegManifest.tiles;
        roadTimes = await getActualDriveTimes(userLoc, allSites)
    }

    for (let i = 0; i < allSites.length; i++) {
        const site = allSites[i];
        let weather, aqi, radiance, siteNDVI, travelTime;

        if(preFetchedData) {
            weather = preFetchedData.weather;
            aqi = preFetchedData.aqi;
            radiance = preFetchedData.radiance || 0;
            siteNDVI = preFetchedData.ndvi || 0.1;
            travelTime = preFetchedData.travelTime;
        } else {
            const startOfNight = new Date();
            startOfNight.setHours(20, 30, 0, 0);
            const windowEndTime = new Date(startOfNight.getTime() + 6 * 60 * 60 * 1000);

            weather = await checkWeatherWindow(site, startOfNight, windowEndTime, prefs);
            aqi = await checkAirQuality(site);
            radiance = await getRadianceValue(site.lat, site.lon, lightTiles);
            console.log(`📡 NASA Radiance for ${site.name}: ${radiance}`);
            siteNDVI = await getNDVI(site.lat, site.lon, vegTiles);
            console.log(`🌿 NDVI lookup for ${site.name}: ${siteNDVI}`);
            travelTime = (roadTimes && roadTimes[i] !== undefined) ? roadTimes [i] : calculateDriveTime(userLoc, site);
        }

        if (travelTime > prefs.maxDriveTime){
            console.log(`🧠 AI Skip: ${site.name} is too far (${Math.round(travelTime)}m).`);
            continue;
        }

        console.log(`Checking ${site.name}: Weather=${weather.success}, AQI=${aqi.success}`);

        if (weather.success && aqi.success) {

            const pm25Value = (aqi.hourly && aqi.hourly.pm2_5) ? aqi.hourly.pm2_5[0] || 5 : 5;

            const brainStats = {
                clouds: weather.avgClouds,
                temp: (prefs.tempUnit === 'celsius') ? (weather.avgTemp * 9/5) + 32 : weather.avgTemp, 
                pm25: pm25Value
            };

            const aqiDataForBrain = { ...aqi, pm25: pm25Value };

            const moonIllum = getMoonIllumination(startOfNight);

            const now = new Date();
            const startOffset = Math.max(0, (new Date(weather.bestTime) - now) / 3600000);

            const inputData = normalizeInputs(radiance, site, weather, moonIllum, travelTime, prefs, aqiDataForBrain, startOffset, siteNDVI);

            if (inputData.some(val => isNaN(val))) {
                console.error(`🚨 Input Data contains NaN for ${site.name}:`, inputData);
                continue;
            }

            const inputTensor = tf.tensor2d([inputData]);
            const prediction = model.predict(inputTensor);
            const scoreData = await prediction.data();
            const score = isNaN(scoreData[0]) ? 0 : scoreData[0];

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
            console.log("2. AI Normalized (The 0-1 values):", inputData);
            console.log("3. Final Result:", {
                rawScore: score,
                boosted: boostedScore
            });
            console.groupEnd();

            validSites.push({
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

            inputTensor.dispose();
            prediction.dispose();
        } else {
            const reason = !weather.success ? weather.reason : 'aqi';
            failureCounts[reason]++;
        }
    }

    if (validSites.length > 0) {
        const results = validSites.map(s => s.rawScore);
        const max = Math.max(...results);
        const min = Math.min(...results);

        validSites.forEach(site => {
            let humanScore = Math.pow(site.rawScore, 0.4) * 100;

            site.score = Math.min(99.9, humanScore).toFixed(1);
        });
    }

    validSites.sort((a, b) => b.score - a.score);

    const hasFailures = Object.values(failureCounts).some(v => v > 0);
    const topFailure = hasFailures ? Object.keys(failureCounts).reduce((a, b) => failureCounts[a] > failureCounts[b] ? a : b) : 'distance';

    return { sites: validSites, topFailure};
}