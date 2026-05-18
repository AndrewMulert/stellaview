import { normalizeTempContextual } from './utils.js';

export function generateMockHistory(numSamples = 1000, prefs = null) {
    const trainingData = [];

        const maxDrive = prefs?.maxDriveTime || 120;
    const minTemp = prefs?.minTemp ?? 32;
    const maxTemp = prefs?.maxTemp ?? 80;

    for (let i = 0; i < numSamples; i++) {
        const sMean = 30 + Math.random() * 50;
        const actualTemp = sMean + (Math.random() * 20 - 10);
        const travel = Math.random() * (maxDrive * 1.2);

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
        const travelRatio = scenario.travelTime / maxDrive;
        const normTravel = Math.max(0, Math.sqrt(1 - Math.min(1, travelRatio)));
        const normClouds = (100 - scenario.clouds) / 100;
        const normAQI = Math.max(0, (100 - scenario.pm25) / 100);
        
        const normMoon = scenario.isMoonUp === 1 ? Math.pow(1 - scenario.illumination, 2) : 1.0;
        const normDuration = scenario.duration / 8;
        const normStartHour = 1 - ((scenario.startHour - 18) / 10);
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
            scenario.isMoonUp, 
            scaledSeasonalMean,
            clampedDeviation
        ];

        let score = (darknessFactor * 30)
            + (scenario.trustFactor * 20)
            + (normClouds * 30)
            + (normMoon * 20)
            + (normTemp * 20)
            + (normDuration * 10)
            + (normStartHour * 10)
            + (normNDVI * 1)
            + (normTravel * 10)
            + (normAQI * 5);

        let moonPenalty = 1.0;
        if (scenario.isMoonUp === 1) {
           moonPenalty = Math.max(0.1, 1.0 - Math.pow(scenario.illumination, 2));
    
            if (scenario.illumination > 0.7) {
                moonPenalty *= 0.5;
            }
        } else {
            moonPenalty = 1.0
        }

        score *= moonPenalty;

        if (scenario.isMoonUp === 1 && scenario.illumination > 0.85) score *= 0.2;
        if (scenario.temp < minTemp) score *= 0.7;

        if (scenario.clouds > 80 || scenario.pm25 > 120) {
            score = 0;
        } else if (scenario.clouds > 30) {
            score *= 0.5;
        }

        if (scenario.trustFactor < 0.6 ) score *= 0.4;
        if (scenario.travelTime > maxDrive) score *= 0.7;

        const noise = (Math.random() - 0.5) * 0.05;
        const baseScore = score / 156;
        const normalizedOutput = Math.max(0, Math.min(1, baseScore + noise)); 

        if (i === 0) {
            console.log("🏋️ Trainer.js Sample Input Vector Structure:");
            console.log([
                "0: darknessFactor", "1: normNDVI", "2: normClouds", "3: normAQI", "4: normMoon",
                "5: normTemp", "6: trustFactor", "7: publicRating", "8: userRating", "9: normTravel",
                "10: normDuration", "11: normStartHour", "12: isMoonUp", "13: scaledSeasonalMean", "14: clampedDeviation"
            ]);
            console.log("Sample Vector Values:", inputVector);

            const rawSum = (darknessFactor * 30) + (scenario.trustFactor * 20) + (normClouds * 30) 
                           + (normMoon * 20) + (normTemp * 20) + (normDuration * 10) 
                           + (normStartHour * 10) + (normNDVI * 1) + (normTravel * 10) + (normAQI * 5);

            console.group("📊 FIRST SAMPLE SCORING METRICS");
            console.log(`1. Raw Unpenalized Sum (Max 156): ${rawSum.toFixed(2)}`);
            console.log(`2. Moon Penalty Multiplier Applied: ${moonPenalty.toFixed(2)}`);
            console.log(`3. Is Extreme Moon Penalty (>0.85) Active?: ${scenario.isMoonUp === 1 && scenario.illumination > 0.85 ? "YES (x0.2)" : "NO"}`);
            console.log(`4. Temperature Cutoff (< minTemp) Active?: ${scenario.temp < minTemp ? "YES (x0.7)" : "NO"}`);
            console.log(`5. Distance Over-Limit (> maxDrive) Active?: ${scenario.travelTime > maxDrive ? "YES (x0.7)" : "NO"}`);
            console.log(`6. Cloud Coverage Value: ${scenario.clouds.toFixed(1)}% (Multiplier: ${scenario.clouds > 80 ? "0.0" : scenario.clouds > 30 ? "0.5" : "1.0"})`);
            console.log(`🎯 Final Composite Target Score (0-1 Scale): ${normalizedOutput.toFixed(3)}`);
            console.groupEnd();
        }

        trainingData.push({ input: inputVector, output: [normalizedOutput] });
    }
    return trainingData;
}