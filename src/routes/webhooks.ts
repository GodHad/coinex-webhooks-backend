import express from 'express';
import Hook from '../models/Hook';
import History from '../models/History';
import crypto from 'crypto';
import axios from 'axios';

const router = express.Router();

const generateSignature = (
    secret: string,
    requestPath: string,
    params: {
        market: string;
        market_type: string;
        side: string;
        type: string;
        amount: string;
    },
    timestamp: string
) => {
    const bodyStr = JSON.stringify(params);
    const preparedStr = `POST${requestPath}${bodyStr}${timestamp}`;
    return crypto.createHmac('sha256', secret).update(preparedStr).digest('hex').toLowerCase();
}

const placeOrderOnCoinEx = async (
    symbol: string,
    action: string,
    amount: number,
    coinExApiKey: string,
    coinExApiSecret: string
): Promise<boolean> => {
    const url = 'https://api.coinex.com/v2/futures/order';
    const timestamp = Math.floor(Date.now()).toString();

    const data = {
        market: symbol,
        market_type: 'FURURES',
        side: action,
        type: 'market',
        amount: String(amount)
    }

    const signedStr = generateSignature(coinExApiSecret, '/futures/order', data, timestamp);
    try {
        const result = await axios.post(url, data, {
            headers: {
                "Content-Type": 'application/json; charset=utf-8',
                Accept: 'application/json',
                'X-COINEX-KEY': coinExApiKey,
                'X-COINEX-SIGN': signedStr,
                'X-COINEX-TIMESTAMP': timestamp
            }
        })

        return result.data
    } catch (error) {
        return false
    }
}

router.post('/:webhookUrl', async (req, res) => {
    try {
        const { webhookUrl } = req.params;
        const webhook = await Hook.findOne({ url: webhookUrl });
        const { symbol, action, amount } = req.body;

        if (!webhook || webhook.status === 1 || (action !== 'buy' && action !== 'sell')) {
            return res.status(400).json({ message: 'URL is not availalbe' });
        }

        const status = await placeOrderOnCoinEx(symbol, action, amount, webhook.coinExApiKey, webhook.coinExApiSecret);

        const newHistory = new History({
            hook: webhook._id,
            symbol,
            action,
            amount,
            status: !!status
        });

        await newHistory.save();
        webhook.totalCalls = webhook.totalCalls + 1;
        await webhook.save();

        return res.status(200).json({ message: 'Great' })
    } catch (error) {
        console.error("Error during creating hook:", error);
        return res.status(500).json({ message: 'Server error' });
    }
});


export default router;
