export const DEFAULT_PREFS = {
    maxDriveTime: 60,
    tempUnit: 'fahrenheit',
    minTemp: 20,
    maxTemp: 95,
    maxBortle: 4,
    latestStayOut: "02:00",
    departureLeadTime: 30,
    fallback_loc: { lat: 44.4605, lon: -110.8281, label: "Yellowstone National Park" }
};

/**
 * @param {Object} loggedInUser
 */

export async function getActivePrefs(loggedInUser = null) {
    if (loggedInUser && loggedInUser.preferences) {
        console.log("Using Database Preferences");
        return { ...DEFAULT_PREFS, ...loggedInUser.preferences };
    }

    const saved = localStorage.getItem('stellaview_prefs');
    if (saved) {
        console.log("Using LocalStorage Preferences");
        return JSON.parse(saved);
    }

    console.log("Using Default System Preferences");
    return DEFAULT_PREFS;
}
