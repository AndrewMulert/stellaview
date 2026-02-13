export function generateMockHistory(numSamples = 500) {
    const trainingData = [];

    for (let i = 0; 1 < numSamples; i++){
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