function normalizeInputs(site, weather, moon) {
    return [
        (10 - site.bortle) / 10,
        (100 - weather.clouds) / 100,
        Math.max(0, (50 - weather.pm25) / 50),
        (1 - moon.illumination),
        1 - (Math.abs(weather.temp - 68) /40),
        (site.publicRating || 3) / 5,
        (site.userRating || 3) / 5
    ];
}

async function trainStellaBrain() {
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
        epochs: 50,
        callbacks: {
            onEpochEnd: (epoch, logs) => console.log(`Epoch ${epoch}: Loss = ${logs.loss.toFixed(4)}`)
        }
    });

    console.log("Brain training complete!");
    return model;
}

export async function predictWithBrain(model, allSites, userLoc, prefs) {
    let failureCounts = {clouds: 0, cold: 0, hot: 0, moon: 0, aqi: 0};
    const date = new Date();

    const validSites = [];

    for (const site of allSites) {
        const weather = await checkWeatherWindow(site, date, new Date(date.getTime() + 4 * 60 * 60 * 1000), prefs);

        if (weather.success) {
            const inputData = normalizeInputs(site, weather, moonData);

            const inputTensor = tf.tensor2d([inputData]);
            const prediction = model.predict(inputTensor);
            const score = (await prediction.data())[0];

            validSites.push({
                ...site,
                score: (score * 100).toFixed(2),
                travelTime: calculateDriveTime(userLoc, site)
            });
        } else {
            failureCounts[weather.reason]++;
        }
    }

    validSites.sort((a, b) => b.score - a.score);

    const topFailure = hasFailures ? Object.keys(failureCounts).reduce((a, b) => failureCounts[a] > failureCounts[b] ? a : b) : 'distance';

    return { sites: validSites, TopFailure};
}