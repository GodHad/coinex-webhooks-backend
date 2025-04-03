import formData from 'form-data';
import Mailgun from 'mailgun.js';

const mailgun = new Mailgun(formData);
const mg = mailgun.client({
    username: 'api',
    key: process.env.MAILGUN_API_KEY ?? '',
    url: 'https://api.eu.mailgun.net',
    // domain: process.env.MAILGUN_DOMAIN ?? '',
});

export const sendEmail = async (to: string, subject: string, text: string, html: string) => {
    try {
        const data = {
            from: 'SIGNALYZE <no-reply@www.signalyze.net>',
            to,
            subject,
            text,
            html
        };

        const result = await mg.messages.create(process.env.MAILGUN_DOMAIN!, data);

        return { success: true, id: result.id };
    } catch (error) {
        console.error("Error sending email: ", error);
        return { success: false, error };
    }
}