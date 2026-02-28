import { DEFAULT_PREFS } from './config.js';

async function handleRegister(event) {
    event.preventDefault();

    const fName = document.getElementById('first_name')?.value;
    const lName = document.getElementById('last_name')?.value;
    const email = document.getElementById('email_input')?.value;
    const pass = document.getElementById('password_input')?.value;
    
    const userData = {
        id: crypto.randomUUID(),

        accountInfo: {
            firstName: fName,
            lastName: lName,
            email: email,
            password: pass,
        },
        preferences: {
            ...DEFAULT_PREFS,
            homeLocation: {
                lat: window.currentLat || 44.4605,
                lon: window.currentLon || -110.8281,
                label: "Yellowstone National Park, Wyoming"
            }
        }
    };

    console.log("Sending to server:", userData);

    const response = await fetch('/api/user/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
    });

    if (response.ok) {
        alert("Account Created!");
    } else {
        const errData = await response.json();
        console.error("Server yelled at us:", errData);
    }
}

function updateModalView(user) {
    const loggedOutView = document.getElementById('logged_out_view');
    const loggedInView = document.getElementById('logged_in_view');
    const welcomeUser = document.getElementById('welcome_user');

    if (user) {
        if (loggedOutView) loggedOutView.classList.add('hidden');
        if (loggedInView) loggedInView.classList.remove('hidden');
        if (welcomeUser) welcomeUser.textContent = `Welcome, ${user.accountInfo.firstName}`;
    } else {
        if (loggedOutView) loggedOutView.classList.remove('hidden');
        if (loggedInView) loggedInView.classList.add('hidden');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const modal = document.getElementById('auth_modal');
    const profileBtn = document.getElementById('profile_menu');
    const closeBtn = document.getElementById('close_modal');
    const registerForm = document.getElementById('register_form');
    const settingsBtn = document.getElementById('settings_btn');
    const settingsModal = document.getElementById('settings_modal');
    const closeSettings = document.getElementById('close_settings');
    const settingsForm = document.getElementById('settings_form');
    const logoutBtn = document.getElementById('logout_btn');

    let initialPrefs = {};

    if (document.cookie.includes('session')) {
        try {
            const response = await fetch('/api/user/me');
            window.currentUser - response.ok ? await response.json() : null;
            updateModalView(window.currentUser);
        } catch (err) {
            updateModalView(null);
        }
    } else {
        window.currentUser = null;
        updateModalView(null);
    }

    const sliderMappings = [
        { id: 'pref_max_drive', valId: 'val_max_drive' },
        { id: 'pref_max_bortle', valId: 'val_max_bortle' },
        { id: 'pref_min_temp', valId: 'val_min_temp' },
        { id: 'pref_max_temp', valId: 'val_max_temp' },
        { id: 'pref_lead_time', valId: 'val_lead_time' },
    ];

    sliderMappings.forEach(mapping => {
        const slider = document.getElementById(mapping.id);
        const display = document.getElementById(mapping.valId);
        if (slider && display) {
            slider.addEventListener('input', (e) => {
                display.textContent = e.target.value;
            });
        }
    });

    settingsBtn?.addEventListener('click', async () => {
            if(!window.currentUser) {
                alert("Please create an account or log in to customize your stargazing preferences!");
                return;
            }

            const currentActive = await getActivePrefs(window.currentUser);

            const formateTimeForInput = (time) => {
                if (!time) return "02:00";
                let t = time.toString();
                if (!t.includes(':')) {
                    return `${t.padStart(2, '0')}:00`;
                }
                const [h, m] = t.spllit(':');
                return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
            };

            initialPrefs = {
                maxDriveTime: currentActive.maxDriveTime,
                maxBortle: currentActive.maxBortle,
                minTemp: currentActive.minTemp,
                maxTemp: currentActive.maxTemp,
                latestStayOut: currentActive.latestStayOut,
                leadTime: currentActive.leadTime,
                homeLocationLabel: currentActive.homeLocationLabel || ""
            };

            const uiMapping = {
                'pref_max_drive': initialPrefs.maxDriveTime,
                'pref_max_bortle': initialPrefs.maxBortle,
                'pref_min_temp': initialPrefs.minTemp,
                'pref_max_temp': initialPrefs.maxTemp,
                'pref_latest_stay': formateTimeForInput(initialPrefs.latestStayOut),
                'pref_lead_time': initialPrefs.leadTime,
                'pref_fallback_loc': initialPrefs.homeLocationLabel
            };

            Object.entries(uiMapping).forEach(([id, val]) => {
                const input = document.getElementById(id);

                if (input) {
                    input.value = val;

                    const spanId = id.replace('pref_', 'val_');
                    const display = document.getElementById(spanId);
                    if (display) display.textContent = val;
                }
            });

            modal.classList.add('hidden');
            settingsModal.classList.remove('hidden');
    });

    closeSettings?.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });

    settingsForm?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const updatedPrefs = {
            maxDriveTime: parseInt(document.getElementById('pref_max_drive').value),
            maxBortle: parseInt(document.getElementById('pref_max_bortle').value),
            minTemp: parseInt(document.getElementById('pref_min_temp').value),
            maxTemp: parseInt(document.getElementById('pref_max_temp').value),
            latestStayOut: document.getElementById('pref_latest_stay').value,
            leadTime: parseInt(document.getElementById('pref_lead_time').value),
            homeLocationLabel: document.getElementById('pref_fallback_loc').value
        };

        if (JSON.stringify(updatedPrefs) === JSON.stringify(initialPrefs)) {
            console.log("No changes detected. Skipping update.");
            settingsModal.classList.add('hidden');
            return;
        }

        const response = await fetch('/api/user/update-prefs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preferences: updatedPrefs })
        });

        if (response.ok){ 
            alert("Preferences Saved!");
            settingsModal.classList.add('hidden');
            location.reload();
        }
    });

    if (profileBtn && modal) {
        profileBtn.addEventListener('click', (e) => {
            e.preventDefault();
            modal.classList.remove('hidden');
        });
    }

    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });
    }

    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await fetch('/api/user/logout', { method: 'POST' });
                window.location.reload();
            } catch (err){
                window.location.href = '/';
            }
        });
    }
});

async function updateUIForLoggedInUser() {
    const response = await fetch('/api/user/me');
    if (response.ok) {
        const user = await response.json();

        const profileBtn = document.getElementById('profile_menu');
        if (profileBtn) {
            profileBtn.textContext = user.accountInfo.firstName;
            profileBtn.classList.add('logged-in');
        }
    }
};

async function saveHomeLocation(addressString) {
    const geoData = await geocode(addressString);
    if (geoData) {
        currentUser.preferences.fallback_loc = {
            lat: geoData.lat,
            lon: geoData.lon,
            label: geoData.label
        };

        await api.updateUserPreferences(currentUser.preferences);
        alert("Home location updated to " + geoData.label);
    } else {
        alert("Could not find that location.");
    }
}