import { normalizeTempContextual } from './utils.js';

export function generateMockHistory(numSamples = 1000, prefs = null) {
    const trainingData = [];

    const minTemp = prefs?.minTemp ?? 20;
    const maxTemp = prefs?.maxTemp ?? 95;
    const maxDrive = prefs?.maxDriveTime ?? 60;

    for (let i = 0; i < numSamples; i++) {
        const sMean = 30 + Math.random() * 50;
        const actualTemp = sMean + (Math.random() * 20 - 10);
        const travel = Math.random() * 180;

        const scenario = {
            radiance: Math.random() < 0.5 ? Math.random() * 2 : Math.random() * 60,
            ndvi: Math.random(),
            clouds: Math.random() * 100,
            pm25: Math.random() * 80,
            temp: actualTemp,
            seasonalMean: sMean,
            illumination: Math.random(),
            isMoonUp: Math.random() > 0.5 ? 1 : 0,
            publicRating: Math.random() * 5,
            userRating: Math.random() * 5,
            travelTime: travel,
            duration: Math.random() * 8,
            startHour: 18 + (Math.random() * 10),
            trustFactor: Math.random() < 0.3 ? 0.5 : 1.0
        };

        const darknessFactor = Math.max(0, 1 - (Math.log10(scenario.radiance + 1) / 2.5));
        const normTravel = Math.max(0, 1 - (scenario.travelTime / maxDrive));
        const normClouds = (100 - scenario.clouds) / 100;
        const normAQI = Math.max(0, (100 - scenario.pm25) / 100);
        const normMoon = scenario.isMoonUp === 1 ? Math.pow(1 - scenario.illumination, 2) : 1.0;
        const normDuration = scenario.duration / 8;
        const normStartHour = 1 - ((scenario.startHour - 18) / 10);
        const normTemp = normalizeTempContextual(scenario.temp, minTemp, maxTemp, scenario.seasonalMean);
        const tempDeviation = (scenario.temp - scenario.seasonalMean) / 30;
        const mockUserDarknessLimit = Math.random() * 0.7 + 0.3;
        
        let moonPenaltyFactor = 1.0;
        if (scenario.isMoonUp === 1) {
           moonPenaltyFactor = Math.pow(1 - scenario.illumination, 3);
        }


        let normNDVI = Math.max(0.1, 1.0 - Math.abs(scenario.ndvi - 0.4) * 2); 
        normNDVI = Math.max(0.1, normNDVI);

        const inputVector = [
            darknessFactor, normNDVI, normClouds, normAQI, normMoon, 
            normTemp, scenario.trustFactor, scenario.publicRating / 5, scenario.userRating / 5, 
            normTravel, normDuration, normStartHour, scenario.isMoonUp, scenario.seasonalMean / 100,
            tempDeviation
        ];

        let score = (darknessFactor * 30)
            + (normClouds * 15) 
            + (normMoon * 15)
            + (normTemp * 15)
            + (normDuration * 10)
            + (normStartHour * 10)
            + (normNDVI * 15)
            + (normTravel * 10)
            + (scenario.trustFactor * 15)
            + (normAQI * 5);

        score *= moonPenaltyFactor;

        if (scenario.isMoonUp === 1 && scenario.illumination > 0.4) score *=0.1;
        if (scenario.temp < minTemp) score *= 0.1;
        if (scenario.clouds > 30) score *=0.2;
        if (scenario.clouds > 70 || scenario.pm25 > 100) score = 0;
        if (scenario.trustFactor < 0.6 ) score *= 0.4;

        if (scenario.travelTime > maxDrive) {
            const overageRatio = scenario.travelTime / maxDrive;
            score *= Math.max(0, 1.2 - overageRatio);
        }

        if (darknessFactor < mockUserDarknessLimit) {
            score *= 0.3;
        }

        const noise = (Math.random() - 0.5) * 0.05;
        const normalizedOutput = Math.max(0, Math.min(1, (score / 100) + noise)); 

        trainingData.push({ input: inputVector, output: [normalizedOutput] });
    }
    return trainingData;
}