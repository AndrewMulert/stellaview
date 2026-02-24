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

document.addEventListener('DOMContentLoaded', () => {
    const profileBtn = document.getElementById('profile_menu');
    profileBtn.addEventListener('click', (e) => {
        e.preventDefault();
        // Logic to show your popup/modal
        console.log("Show registration popup");
    });
});

document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('auth_modal');
    const profileBtn = document.getElementById('profile_menu');
    const closeBtn = document.getElementById('close_modal');
    const form = document.getElementById('register_form');

    profileBtn.addEventListener('click', (e) => {
        e.preventDefault();
        modal.classList.remove('hidden');
    });

    closeBtn.addEventListener('click', () => modal.classList.add('hidden'));

    form.addEventListener('submit', handleRegister);
})