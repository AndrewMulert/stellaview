export function generateMockHistory(numSamples = 1000) {
    const trainingData = [];

    for (let i = 0; i < numSamples; i++) {
        const scenario = {
            radiance: Math.random() < 0.5 ? Math.random() * 2 : Math.random() * 60,
            ndvi: Math.random(),
            clouds: Math.random() * 100,
            pm25: Math.random() * 80,
            temp: Math.random() * 110 - 10,
            illumination: Math.random(),
            publicRating: Math.random() * 5,
            userRating: Math.random() * 5,
            travelTime: Math.random() * 120,
            duration: Math.random() * 6,
            startHour: 18 + (Math.random() * 12)
        };

        const darknessFactor = Math.max(0, 1 - (Math.log10(scenario.radiance + 1) / 2.5));
        const normTravel = Math.max(0, 1 - (scenario.travelTime / 120));
        const normClouds = (100 - scenario.clouds) / 100;
        const normAQI = Math.max(0, (100 - scenario.pm25) / 100);
        const normMoon = Math.pow(1 - scenario.illumination, 2);
        const normTemp = Math.max(0, 1 - (Math.abs(scenario.temp - 68) / 40));
        
        let normNDVI = 0.8; 
        if (scenario.ndvi > 0.8) normNDVI = 0.1;
        else if (scenario.ndvi < 0.1) normNDVI = 0.4;
        else normNDVI = 1.0;

        const inputVector = [
            darknessFactor, normNDVI, normClouds, normAQI, normMoon, 
            normTemp, scenario.publicRating / 5, scenario.userRating / 5, 
            normTravel, scenario.duration / 6, 1 - ((scenario.startHour - 18) / 12)
        ];

        let score = (darknessFactor * 20)
            + (normNDVI * 15)
            + (normClouds * 15) 
            + (normMoon * 10)
            + (normTravel * 10)
            + (normAQI * 5);

        const normalizedOutput = Math.max(0, Math.min(1, score / 60)); 

        trainingData.push({ input: inputVector, output: [normalizedOutput] });
    }
    return trainingData;
}