import formData from 'form-data';
import Mailgun from 'mailgun.js';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const mailgun = new Mailgun(formData);
console.log(process.env.MAILGUN_API_KEY)
const mg = mailgun.client({
    username: 'api',
    key: process.env.MAILGUN_API_KEY ?? '',
    url: process.env.MAILGUN_URL ?? '',
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