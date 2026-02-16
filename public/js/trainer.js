export function generateMockHistory(numSamples = 500) {
    const trainingData = [];

    for (let i = 0; i < numSamples; i++){
        const scenario = {
            radiance: Math.random() < 0.5 ? Math.random() * 2 : Math.random() * 60,
            clouds: Math.random() * 100,
            pm25: Math.random() * 80,
            temp: Math.random() * 110 -10,
            illumination: Math.random(),
            publicRating: Math.random() * 5,
            userRating: Math.random() * 5,
            travelTime: Math.random() * 300,
            duration: Math.random() * 6,
            startHour: 18 + (Math.random() * 12)
        };

        const darknessFactor = Math.max(0,  1 - (Math.log10(scenario.radiance + 1) / 2.5 ));
        const normTravel = Math.max(0, 1 - (scenario.travelTime / 300));

        const normDuration = Math.min(scenario.duration / 6, 1);
        const normStart = 1 - ((scenario.startHour - 18) / 12);

        const inputVector = [
            darknessFactor,
            (100 - scenario.clouds) / 100,
            Math.max(0, (50 - scenario.pm25) / 50),
            (1 - scenario.illumination),
            Math.max(0, 1 - (Math.abs(scenario.temp - 68) / 40)),
            scenario.publicRating / 5,
            scenario.userRating / 5,
            normTravel,
            normDuration,
            normStart
        ];

        let score = (darknessFactor * 15) 
            + (normDuration * 12)
            + (normStart * 8)
            - (scenario.clouds / 5) 
            - (scenario.pm25 /10) 
            - (Math.abs(scenario.temp - 68) * 0.1)
            - (scenario.travelTime / 150);
        
        score += (scenario.publicRating * 0.5) + (scenario.userRating * 1.0);

        const normalizedOutput = Math.max(0, Math.min(1, score / 35));

        trainingData.push({ input: inputVector, output: [normalizedOutput] });
    }
    return trainingData;
}