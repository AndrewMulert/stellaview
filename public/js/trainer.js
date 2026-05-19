import { normalizeTempContextual } from './utils.js';

export function generateMockHistory(numSamples = 1000, prefs = null) {
    const trainingData = [];

    const maxDrive = prefs?.maxDriveTime || 120;
    const minTemp = prefs?.minTemp ?? 32;
    const maxTemp = prefs?.maxTemp ?? 80;

    for (let i = 0; i < numSamples; i++) {
        const sMean = 30 + Math.random() * 50;
        const actualTemp = sMean + (Math.random() * 50 - 25);
        const travel = Math.random() * (maxDrive * 1.2);

        const mockPublicRating = Math.random() < 0.7 ? 3.0 : Math.random() * 5;
        const mockUserRating = Math.random() < 0.7 ? 3.0 : Math.random() * 5;

        let radiance = 0.01;
        const randRoll = Math.random();

        if (randRoll < 0.15) {
            radiance = 0.1 + Math.random() * 12;
        } else if (randRoll < 0.50) {
            radiance = 12 + Math.random() * 30;
        } else if (randRoll < 0.85) {
            radiance = 42 + Math.random() * 50;
        } else {
            radiance = 92 + Math.random() * 150;
        }

        const scenario = {
            radiance: radiance,
            ndvi: Math.random(),
            clouds: Math.random() * 100,
            pm25: Math.random() * 80,
            temp: actualTemp,
            seasonalMean: sMean,
            illumination: Math.random(),
            isMoonUp: Math.random() > 0.5 ? 1 : 0,
            publicRating: mockPublicRating,
            userRating: mockUserRating,
            travelTime: travel,
            duration: Math.random() * 8,
            startHour: 18 + (Math.random() * 10),
            trustFactor: Math.random() < 0.3 ? 0.5 : 1.0
        };

        const darknessFactor = Math.max(0, 1 - (Math.log10(scenario.radiance + 1) / 2.1));
        const travelRatio = scenario.travelTime / maxDrive;
        const normTravel = Math.max(0, Math.pow(1 - Math.min(1, travelRatio), 0.35));
        const normClouds = Math.max(0, (100 - scenario.clouds) / 100);
        const normAQI = Math.max(0, (100 - scenario.pm25) / 100);
        
        const normMoon = scenario.isMoonUp === 1 ? Math.pow(1 - scenario.illumination, 2) : 1.0;
        const normDuration = scenario.duration / 8;
        const normStartHour = Math.max(0, 1 - ((scenario.startHour - 18) / 12));
        const normTemp = normalizeTempContextual(scenario.temp, minTemp, maxTemp, scenario.seasonalMean);
        const normNDVI = Math.max(0.1, 1.0 - Math.abs(scenario.ndvi - 0.4) * 2);

        const scaledSeasonalMean = Math.max(0, Math.min(1, scenario.seasonalMean / 120));
        const clampedDeviation = Math.max(-1, Math.min(1, (scenario.temp - scenario.seasonalMean) / 30));

        const inputVector = [
            darknessFactor, 
            normNDVI, 
            normClouds, 
            normAQI, 
            normMoon, 
            normTemp, 
            scenario.trustFactor, 
            scenario.publicRating / 5, 
            scenario.userRating / 5, 
            normTravel, 
            normDuration, 
            normStartHour, 
            Number(scenario.isMoonUp), 
            scaledSeasonalMean,
            clampedDeviation
        ];

        const maxPossibleRatingPoints = 2.0;
        const currentRatingPoints = (scenario.publicRating / 5) + (scenario.userRating / 5);

        let score = (darknessFactor * 30)
            + (scenario.trustFactor * 20)
            + (normClouds * 30)
            + (normMoon * 20)
            + (normTemp * 20)
            + (normDuration * 10)
            + (normStartHour * 10)
            + (normNDVI * 1)
            + (normTravel * 10)
            + (normAQI * 5)
            + currentRatingPoints;

        let moonPenalty = 1.0;
        if (scenario.isMoonUp === 1) {
           moonPenalty = Math.max(0.1, 1.0 - Math.pow(scenario.illumination, 2));
    
            if (scenario.illumination > 0.7) {
                moonPenalty *= 0.5;
            }
        }

        score *= moonPenalty;

        if (scenario.isMoonUp === 1 && scenario.illumination > 0.85) score *= 0.2;
        if (scenario.temp < minTemp) score *= 0.85;

        if (scenario.clouds > 80 || scenario.pm25 > 120) {
            score = 0;
        } else if (scenario.clouds > 30) {
            score *= 0.5;
        }

        if (scenario.trustFactor < 0.6 ) score *= 0.85;
        if (scenario.travelTime > maxDrive) score *= 0.8;

        const baseScore = score / 159;
        const normalizedOutput = Math.max(0, Math.min(1, baseScore *1.15) + (Math.random() - 0.5) * 0.02); 

        if (i === 0) {
            console.log("🏋️ Trainer.js Sample Input Vector Structure:", inputVector);
        }

        trainingData.push({ input: inputVector, output: [normalizedOutput] });
    }
    return trainingData;
}