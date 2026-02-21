async function handleRegister(event) {
    event.preventDefault();
    
    const userData = {
        firstName: document.getElementById('first_name').value,
        lastName: document.getElementById('last_name').value,
        email: document.getElementById('email_input').value,
        password: document.getElementById('password_input').value,
        homeLocation: {
            lat: window.currentLat || 44.4605,
            lon: window.currentLon || -110.8281,
            label: "Twin Falls, ID"
        }
    };

    const response = await fetch('/api/user/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
    });

    if (response.ok) {
        alert("Account Created!");
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