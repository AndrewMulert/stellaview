export const DEFAULT_PREFS = {
    maxDriveTime: 60,
    tempUnit: 'fahrenheit',
    minTemp: 20,
    maxTemp: 95,
    maxBortle: 4,
    latestStayOut: "02:00",
    departureLeadTime: 30,
    homeLocation: { lat: 44.4605, lon: -110.8281, label: "Yellowstone National Park" }
};

let lastSource = null;

/**
 * @param {Object} loggedInUser
 */

export async function getActivePrefs(loggedInUser = null) {
    let prefs;
    let currentSource = "";

    if (loggedInUser && loggedInUser.preferences) {
        currentSource = "database";
        if (lastSource !== currentSource) {
            console.log("🗄️ Using Database Preferences");
            lastSource = currentSource;
        }
        prefs = { 
            ...DEFAULT_PREFS, 
            ...loggedInUser.preferences,
            accessLevel : loggedInUser.accountInfo?.accessLevel ?? 1
        };

        if (!prefs.homeLocation || !prefs.homeLocation.lat || !prefs.homeLocation.lon) {
            console.warn("User has no home location set. Falling back to System Default.");
            prefs.homeLocation = DEFAULT_PREFS.homeLocation;
        }
        return prefs;
    }

    const saved = localStorage.getItem('stellaview_prefs');
    if (saved) {
        currentSource = "localstorage";
        if (lastSource !== currentSource) {
            console.log("💾 Using LocalStorage Preferences");
            lastSource = currentSource;
        }
        return JSON.parse(saved);
    }

    currentSource = "default";
    if (lastSource !== currentSource) {
        console.log("⚙️ Using Default System Preferences");
        lastSource = currentSource;
    }

    return { DEFAULT_PREFS, accessLevel: 0 };
}
