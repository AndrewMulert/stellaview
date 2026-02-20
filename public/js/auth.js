async function handleRegister(event) {
    event.preventDefault();
    
    const userData = {
        firstName: document.getElementById('first_name').value,
        lastName: document.getElementById('last_name').value,
        email: document.getElementById('email_input').value,
        password: document.getElementById('password_input').value
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