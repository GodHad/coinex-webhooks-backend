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

export const createCoinPaymentsInvoice = async (currency: string, amount: number, paymentCurrency: string, refundEmail: string) => {
    const method = 'POST';
    const url = 'https://api.coinpayments.com/api/v2/merchant/invoices';
    const isoDate = new Date().toISOString().split('.')[0];

    const dataPayload = {
        currency,
        items: [
            {
                name: `Subscription for ${amount % 49 === 0 ? 'Premium' : 'Standard'} with ${currency}`,
                quantity: { value: 1, type: 1 },
                amount: `${amount}`
            }
        ],
        amount: {
            breakdown: {
                subtotal: `${amount}`
            },
            total: `${amount}`
        },
        payment: {
            paymentCurrency, 
            refundEmail
        }
    };
    const payloadMessage = JSON.stringify(dataPayload);

    const request = generateReqeust(method, url, isoDate, payloadMessage)

    try {
        console.log(request)
        const response = await axios(request);
        return { success: true, data: response.data };
    } catch (error: any) {
        const status = error.response.status || 'Unknown';
        console.error(`Request filaed with status: ${status}`);
        console.error(error);
        return { success: false, message: error.response?.data || error.message };
    }
}

export const getInvoiceByPaymentMethod = async (id: string, symbol: 'BTC' | 'ETH') => {
    const ids = {
        BTC: 1,
        ETH: 4,
        SOL: 12,
        LTCT: 1002, 
    };
    const method = 'GET';
    const url = `https://api.coinpayments.com/api/v1/invoices/${id}/payment-currencies/${ids[symbol]}`;
    const isoDate = new Date().toISOString().split('.')[0];

    const request = generateReqeust(method, url, isoDate);

    try {
        const response = await axios(request);
        return { success: true, data: response.data };
    } catch (error: any) {
        const status = error.response?.status || 'Unknown';
        console.error(`Request failed with status: ${status}`);
        console.error(error.response?.data || error.message);
        return { success: false, message: error.response?.data || error.message };
    }
}