import mailgun from 'mailgun-js';

const mg = mailgun({
    apiKey: process.env.MAILGUN_API_KEY ?? '',
    domain: process.env.MALIGUN_DOMAIN ?? ''
});

export const sendEmail = async (to: string, subject: string, text: string, html: string) => {
    try {
        const data = {
            from: 'SIGNALIZE <no-reply@www.signalyze.com',
            to,
            subject,
            text,
            html
        };

        const result = await mg.messages().send(data);
        return { success: true, id: result.id };
    } catch (error) {
        console.error("Error sending email: ", error);
        return { success: false, error };
    }
}