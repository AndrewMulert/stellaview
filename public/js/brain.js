import 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js';
import { checkWeatherWindow, checkAirQuality } from './engine.js';
import { calculateDriveTime, getMoonIllumination, getRadianceValue, normalizeInputs} from './utils.js';
import { generateMockHistory } from './trainer.js';

const tf = window.tf;

export async function trainStellaBrain() {
    const data = generateMockHistory(1000);

    const inputs = tf.tensor2d(data.map(d => d.input));
    const outputs = tf.tensor2d(data.map(d => d.output));

    const model = tf.sequential();
    model.add(tf.layers.dense({ units: 12, inputShape: [8], activation: 'relu'}));
    model.add(tf.layers.dense({ units: 8, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));

    model.compile({
        optimizer: tf.train.adam(0.001),
        loss: 'meanSquaredError'
    });

    console.log("Brain training started...");
    await model.fit(inputs, outputs, {
        epochs: 20,
        shuffle: true,
        validationSplit: 0.1,
        callbacks: {
            onEpochEnd: (epoch, logs) => console.log(`Epoch ${epoch}: Loss = ${logs.loss.toFixed(4)}, Time = ${new Date()}`)
        }
    });

    inputs.dispose();
    outputs.dispose();

    console.log("Brain training complete!");
    return model;
}

export async function predictWithBrain(model, allSites, userLoc, prefs, preFetchedData = null) {
    let failureCounts = {clouds: 0, cold: 0, hot: 0, moon: 0, aqi: 0};
    const date = new Date();

    const startOfNight = new Date();
    startOfNight.setHours(20, 30, 0, 0);
    const windowEndTime = new Date(startOfNight.getTime() + 6 * 60 * 60 * 1000);

    const indexResponse = await fetch('https://andrewmulert.github.io/light_tiles/manifest.json');
    const manifest = await indexResponse.json();
    const tiles = manifest.tiles;

    const validSites = [];

    for (const site of allSites) {
        const travelTime = Math.round(calculateDriveTime(userLoc, site));

        let weather, aqi, radiance;

        if(preFetchedData) {
            weather = preFetchedData.weather;
            aqi = preFetchedData.aqi;
            radiance = preFetchedData.radiance || 0;
        } else {
            weather = await checkWeatherWindow(site, startOfNight, windowEndTime, prefs);
            aqi = await checkAirQuality(site);
            radiance = await getRadianceValue(site.lat, site.lon, tiles);
            console.log(`📡 NASA Radiance for ${site.name}: ${radiance}`);
        }

        if (travelTime > prefs.maxDriveTime){
            console.log(`🧠 AI Skip: ${site.name} is too far (${Math.round(travelTime)}m).`);
            continue;
        }

        console.log(`Checking ${site.name}: Weather=${weather.success}, AQI=${aqi.success}`);

        if (weather.success && aqi.success) {

            const brainStats = {
                clouds: weather.avgClouds,
                temp: (prefs.tempUnit === 'celsius') ? (weather.avgTemp * 9/5) + 32 : weather.avgTemp, 
                pm25: aqi.pm25
            };


            const moonIllum = getMoonIllumination(startOfNight);
            const inputData = normalizeInputs(radiance, site, weather, moonIllum, travelTime, prefs, aqi);

            if (inputData.some(val => isNaN(val))) {
                console.error(`🚨 Input Data contains NaN for ${site.name}:`, inputData);
                continue;
            }

            const inputTensor = tf.tensor2d([inputData]);
            const prediction = model.predict(inputTensor);
            const scoreData = await prediction.data();
            const score = scoreData[0];

            const finalScore = isNaN(score) ? 0 : score;


            console.log(`🧠 Brain Scoring: ${site.name} | Raw Score: ${finalScore}`);

            const boostedScore = (Math.sqrt(finalScore) * 600000).toFixed(1);

            console.group(`📊 Data Audit: ${site.name}`);
            console.log("1. Sensor Raw:", {
                radiance: radiance,
                clouds: brainStats.clouds,
                temp: brainStats.temp,
                moon: moonIllum,
                travel: travelTime
            });
            console.log("2. AI Normalized (The 0-1 values):", inputData);
            console.log("3. Final Result:", {
                rawScore: finalScore,
                boosted: boostedScore
            });
            console.groupEnd();

            validSites.push({
                ...site,
                rawScore: finalScore,
                travelTime: travelTime,
                bestTime: weather.bestTime,
                duration: weather.duration,
                avgTemp: weather.avgTemp,
                avgClouds: weather.avgClouds,
                clouds: weather.avgClouds
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
            const normalized = (site.rawScore - min) / (max-min);
            site.score = (60 + (normalized * 39)).toFixed(1);
        });
    }

    validSites.sort((a, b) => b.score - a.score);

    const hasFailures = Object.values(failureCounts).some(v => v > 0);
    const topFailure = hasFailures ? Object.keys(failureCounts).reduce((a, b) => failureCounts[a] > failureCounts[b] ? a : b) : 'distance';

    return { sites: validSites, topFailure};
}