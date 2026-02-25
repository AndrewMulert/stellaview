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
    const profileBtn = document.getElementById('profile_menu');

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
    const form = document.getElementById('register_form');
    const toggleBtn = document.getElementById('toggle_auth_mode');

    try {
        const response = await fetch('/api/user/me');
        if (response.ok) {
            const user = await response.json();
            updateModalView(user);
        } else {
            updateModalView(null);
        }
    } catch (err) {
        updateModalView(null);
    }

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

    if (form) {
        form.addEventListener('submit', handleRegister);
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            window.location.href = '/api/user/logout';
        });
    }
});

async function updateUIForLoggedInUser() {
    const response = await fetch('/api/user/me');
    if (response.ok) {
        const user = await response.json();

        const profileBtn = document.getElementById('profile_menu');
        if (profileBtn) {
            profileBtn.TextContext = user.accountInfo.firstName;
            profileBtn.classList.add('logged-in');
        }
    }
}