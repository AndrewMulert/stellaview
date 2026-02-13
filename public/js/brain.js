import 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js';
import { checkWeatherWindow, checkAirQuality } from './engine.js';
import { calculateDriveTime, normalizeInputs} from './utils.js';
/*import { generateMockHistory } from './trainer.js';*/

const tf = window.tf;

function generateMockHistory(numSamples = 500) {
    const trainingData = [];

    for (let i = 0; i < numSamples; i++){
        const scenario = {
            bortle: Math.floor(Math.random() * 9) + 1,
            clouds: Math.random() * 100,
            pm25: Math.random() * 80,
            temp: Math.random() * 110 -10,
            illumination: Math.random(),
            publicRating: Math.random() * 5,
            userRating: Math.random() * 5
        };

        const inputVector = [
            (10 - scenario.bortle) / 10,
            (100 - scenario.clouds) / 100,
            Math.max(0, (50 - scenario.pm25) / 50),
            (1 - scenario.illumination),
            1 - (Math.abs(scenario.temp - 68) / 40),
            scenario.publicRating / 5,
            scenario.userRating / 5
        ];

        let score = (10 - scenario.bortle) 
            - (scenario.clouds / 20) 
            - (scenario.pm25 /10) 
            - (Math.abs(scenario.temp - 68) * 0.1);
        
        score += (scenario.publicRating * 0.5) + (scenario.userRating * 1.0);

        const normalizedOutput = Math.max(0, Math.min(1, score / 15));

        trainingData.push({ input: inputVector, output: [normalizedOutput] });
    }
    return trainingData;
}

export async function trainStellaBrain() {
    const data = generateMockHistory(1000);

    const inputs = tf.tensor2d(data.map(d => d.input));
    const outputs = tf.tensor2d(data.map(d => d.output));

    const model = tf.sequential();
    model.add(tf.layers.dense({ units: 12, inputShape: [7], activation: 'relu'}));
    model.add(tf.layers.dense({ units: 8, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));

    model.compile({
        optimizer: tf.train.adam(0.01),
        loss: 'meanSquaredError'
    });

    console.log("Brain training started...");
    await model.fit(inputs, outputs, {
        epochs: 30,
        callbacks: {
            onEpochEnd: (epoch, logs) => console.log(`Epoch ${epoch}: Loss = ${logs.loss.toFixed(4)}`)
        }
    });

    inputs.dispose();
    outputs.dispose();

    console.log("Brain training complete!");
    return model;
}

export async function predictWithBrain(model, allSites, userLoc, prefs) {
    const SEARCH_RADIUS_KM = 300;
    let failureCounts = {clouds: 0, cold: 0, hot: 0, moon: 0, aqi: 0};
    const date = new Date();

    const startOfNight = new Date(date);
    const windowEndTime = new Date(date.getTime() + 6 * 60 * 60 * 1000);

    const validSites = [];

    for (const site of allSites) {
        const travelTime = Math.round(calculateDriveTime(userLoc, site));

        if (travelTime > prefs.maxDriveTime){
            console.log(`🧠 AI Skip: ${site.name} is too far (${Math.round(travelTime)}m).`);
            continue;
        }
        const weather = await checkWeatherWindow(site, startOfNight, windowEndTime, prefs);
        const aqi = await checkAirQuality(site);

        console.log(`Checking ${site.name}: Weather=${weather.success}, AQI=${aqi.success}`);

        if (weather.success && aqi.success) {
            const brainStats = {
                clouds: weather.avgClouds,
                temp: (prefs.tempUnit === 'celsius') ? (weather.avgTemp * 9/5) + 32 : weather.avgTemp, 
                pm25: aqi.pm25
            };

            const moonData = { illumination: 0.1 };
            const inputData = normalizeInputs(site, brainStats, moonData, travelTime, prefs);

            const inputTensor = tf.tensor2d([inputData]);
            const prediction = model.predict(inputTensor);
            const scoreData = await prediction.data();
            const score = scoreData[0];
            console.log(`🧠 Brain Scoring: ${site.name} | Raw Score: ${score}`);

            validSites.push({
                ...site,
                score: (score * 100).toFixed(2),
                travelTime: travelTime,
                bestStartTime: startOfNight.toISOString()
            });

            inputTensor.dispose();
            prediction.dispose();
        } else {
            const reason = !weather.success ? weather.reason : 'aqi';
            failureCounts[reason]++;
        }
    }

    validSites.sort((a, b) => b.score - a.score);

    const hasFailures = Object.values(failureCounts).some(v => v > 0);
    const topFailure = hasFailures ? Object.keys(failureCounts).reduce((a, b) => failureCounts[a] > failureCounts[b] ? a : b) : 'distance';

    return { sites: validSites, topFailure};
}