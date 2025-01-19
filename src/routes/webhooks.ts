import express from 'express';
import Hook from '../models/Hook';
import History from '../models/History';
import crypto from 'crypto';
import axios from 'axios';

const router = express.Router();
const url = 'https://api.coinex.com/v2/futures/order';

function createAuthorization(method: string, request_path: string, body_json: string, timestamp: string, SECRET_KEY: string) {
    var text = method + request_path + body_json + timestamp;
    console.log(text);
    return crypto
        .createHmac("sha256", SECRET_KEY)
        .update(text)
        .digest("hex")
        .toLowerCase();
}

const placeOrderOnCoinEx = async (
    symbol: string,
    action: string,
    amount: string,
    coinExApiKey: string,
    coinExApiSecret: string
): Promise<{ success: boolean; data?: any; error?: any }> => {
    const response = await axios.get('https://api.coinex.com/v2/time');
    const timestamp = response.data.data.timestamp.toString();
    console.log(timestamp, typeof timestamp)

    const data = JSON.stringify({
        market: symbol,
        market_type: 'FUTURES',
        side: action,
        type: 'market',
        amount: amount,
    });

    try {
        const result = await axios.post(url, data, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                Accept: 'application/json',
                "X-COINEX-KEY": coinExApiKey,
                "X-COINEX-SIGN": createAuthorization("POST", "/v2/futures/order", data, timestamp, coinExApiSecret),
                "X-COINEX-TIMESTAMP": timestamp,
            },
        });

        return {
            success: true,
            data: result.data,
        };
    } catch (error: any) {
        console.error('CoinEx API Request Failed:', error.response?.data || error.message);
        return {
            success: false,
            error: error.response?.data || error.message,
        };
    }
};

router.post('/:webhookUrl', async (req, res) => {
    try {
        const { webhookUrl } = req.params;
        const webhook = await Hook.findOne({ url: webhookUrl });
        const { ticker, action, amount, exchange } = req.body;

        if (!webhook || webhook.status === 1) {
            return res.status(400).json({ message: 'Webhook URL is not available or disabled' });
        }

        if (!ticker || !action || !amount || (action !== 'buy' && action !== 'sell') || exchange !== 'CoinEx') {
            return res.status(400).json({ message: 'Invalid request payload' });
        }

        const { success, data, error } = await placeOrderOnCoinEx(
            ticker,
            action,
            amount,
            webhook.coinExApiKey,
            webhook.coinExApiSecret
        );

        const newHistory = new History({
            hook: webhook._id,
            symbol: ticker,
            action,
            amount,
            status: success,
            error: error || null,
            data: data || null
        });

        await newHistory.save();

        webhook.totalCalls = (webhook.totalCalls || 0) + 1;
        await webhook.save();

        if (success) {
            return res.status(200).json({ message: 'Order placed successfully', data });
        } else {
            return res.status(500).json({ message: 'Order placement failed', error });
        }
    } catch (error) {
        console.error('Error during webhook handling:', error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;
