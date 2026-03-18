import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export const sendVerificationEmail = async (email, firstName, token) => {
    const url = `${process.env.BASE_URL}/api/user/verify?token=${token}`;

    if (!resend || !process.env.RESEND_API_KEY) {
        console.log("--- DEV MODE: EMAIL NOT SENT ---");
        console.log(`To: ${email}`);
        console.log(`Verification Link: ${url}`);
        console.log("-------------------------------");
        return { success: true, isDev: true };
    }

    try {
        const data = await resend.emails.send({
            from: 'StellaView <onboarding@resend.dev>',
            to: [email],
            subject: 'Confirm your StellaView Account',
            html: `
                <h1>Welcome to StellaView, ${firstName}!</h1>
                <p>You're one step away from finding the perfect dark skies.</p>
                <p>Please click the link below to verify your email address:</p>
                <a href="${url}" style="padding: 10px 20px; background-color: #00464D; color: white; text-decoration: none; border-radius: 5px;">Verify Email</a>
                <p>If the button doesn't work, copy and past this link: ${url}</p>
            `,
        });
        return { success: true, data };
    } catch (error) {
        console.error("Resend Error:", error);
        return { success: false, error };
    }
};