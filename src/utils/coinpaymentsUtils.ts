import { createHmac } from 'node:crypto';
import axios, { AxiosRequestConfig } from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const integration = {
    clientId: process.env.COINPAYMENTS_CLIENT_ID || '',
    clientSecret: process.env.COINPAYMENTS_CLIENT_SECRET || ''
};

if (!integration.clientId || !integration.clientSecret) {
    throw new Error('Missing CoinPayments integration credentials.');
}

const createAuthorization = (message: string) => {
    return createHmac('sha256', integration.clientSecret)
        .update(message)
        .digest('base64');
}

const generateReqeust = (method: string, url: string, isoDate: string, payloadMessage?: string): AxiosRequestConfig => {
    const message = `\ufeff${method}${url}${integration.clientId}${isoDate}${payloadMessage}`;

    const request: AxiosRequestConfig = {
        method,
        url,
        data: JSON.parse(payloadMessage || '{}'),
        headers: {
            'Content-Type': 'application/json',
            'X-CoinPayments-Client': integration.clientId,
            'X-CoinPayments-Timestamp': isoDate,
            'X-CoinPayments-Signature': createAuthorization(message),
        }
    };

    return request;
}

export const createCoinPaymentsInvoice = async (symbol: string, amount: number) => {
    const method = 'POST';
    const url = 'https://api.coinpayments.com/api/v2/merchant/invoices';
    const isoDate = new Date().toISOString().split('.')[0];
    
    const dataPayload = {
        currency: symbol,
        items: [
            {
                name: `Subscription for ${amount > 40 ? 'Premium' : 'Standard'} with ${symbol}`,
                quantity: { value: 1, type: 1 },
                amount: `${amount}`
            }
        ],
        amount: {
            breakdown: {
                subtotal: `${amount}`
            },
            total: `${amount}`
        }
    };
    const payloadMessage = JSON.stringify(dataPayload);

    const request = generateReqeust(method, url, isoDate, payloadMessage)

    try {
        const response = await axios(request);
        return response.data;
    } catch (error: any) {
        const status = error.response.status || 'Unknown';
        console.error(`Request filaed with status: ${status}`);
        console.error(error.response?.data || error.message);
        return false;
    }
}
