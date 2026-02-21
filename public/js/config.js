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
    if (loggedInUser && loggedInUser.id) {
        try {
            const response = await fetch(``);
            return await response.json();
        } catch (e) {
            console.warn("Could not fetch Mongo prefs, falling back...");
        }
    }

    const saved = localStorage.getItem('stellaview_prefs');
    if (saved) {
        return JSON.parse(saved);
    }

    return DEFAULT_PREFS;
}
