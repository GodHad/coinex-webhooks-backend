import express from 'express';
import Hook from '../models/Hook';
import History from '../models/History';
import crypto from 'crypto';
import axios from 'axios';
import User, { IUser } from '../models/User';
import AdminHook from '../models/AdminHook';
import { jwtAuth } from '../middleware/authorization';
import webhooksMaintenanceMiddleware from '../middleware/webhooksMaintenance';
import ArtemHistory from '../models/Artem';
import { getTimestamp, sign, preHash } from '../utils/bitgetUtils';
import { checkOrderExisting, handleTrade } from '../utils/coinexUtils';

require("dotenv").config("../.env");

const router = express.Router();

router.post('/:webhookUrl', webhooksMaintenanceMiddleware, async (req, res) => {
    try {
        const { webhookUrl } = req.params;
        const { ticker, action, amount, exchange } = req.body;

        if (!ticker || !action || !amount || (action !== 'buy' && action !== 'sell') || exchange !== 'CoinEx') {
            return res.status(400).json({ message: 'Invalid request payload' });
        }

        const adminHook = await AdminHook.findOne({ url: webhookUrl });
        if (adminHook) {
            const webhooks = await Hook.find({ adminHook: adminHook._id }).populate<{ creator: IUser }>('creator');

            if (!webhooks.length) {
                return res.status(404).json({ message: 'No webhooks associated with this adminHook' });
            }

            const results = [];
            for (let i = 0; i < webhooks.length; i++) {
                const webhook = webhooks[i];
                if (!webhook || webhook.status === 1) {
                    results.push({
                        webhookId: webhook?._id || 'Unknown',
                        success: false,
                        message: 'Webhook is disabled or not available',
                    });
                    continue;
                }

                const isSubscribed = webhook.creator.subscribed === 1 && webhook.creator.subscribeEndDate && new Date(webhook.creator.subscribeEndDate).getTime() > Date.now();

                if (!isSubscribed) {
                    results.push({
                        webhookId: webhook._id,
                        success: false,
                        message: 'Subscription ended'
                    })
                    continue;
                }

                const result = await handleTrade(webhook, ticker, action, webhook.amount || amount);
                
                results.push({
                    webhookId: webhook._id,
                    success: result.success,
                    message: result.success
                        ? `Trade handled successfully for webhook ${webhook._id}`
                        : `Trade failed for webhook ${webhook._id}: ${result.message}`,
                });
            }

            return res.status(200).json({
                message: 'AdminHook webhooks processed',
                results,
            });
        }

        const webhook = await Hook.findOne({ url: webhookUrl, isSubscribed: true });
        if (!webhook || webhook.status === 1) {
            return res.status(400).json({ message: 'Webhook URL is not available or disabled' });
        }

        const result = await handleTrade(webhook, ticker, action, webhook.amount || amount);
        if (!result.success) {
            return res.status(500).json({ message: result.message });
        }

        return res.status(200).json({ message: result.message });
    } catch (error) {
        console.error('Error during webhook handling:', error);
        return res.status(500).json({ message: 'Server error' });
    }
});

const apiKey = process.env.API_KEY;
const apiPass = process.env.API_PASS;
const apiSecret = process.env.API_SECRET;


// curl "https://api.bitget.com/api/v2/mix/account/account?symbol=btcusdt&productType=USDT-FUTURES&marginCoin=usdt" \
//    -H "ACCESS-KEY:*******" \
//    -H "ACCESS-SIGN:*" \
//    -H "ACCESS-PASSPHRASE:*" \
//    -H "ACCESS-TIMESTAMP:1659076670000" \
//    -H "locale:en-US" \
//    -H "Content-Type: application/json" 

let apiCount = 0, tradeDir = 'plus', isClosed = false;

router.post('/artem/bitget', async (req, res) => {
    try {
        const { coinpair, action, size } = req.body;

        let requestPath = "/api/v2/mix/order/place-order";
        const timestamp = await getTimestamp();
        const lastHistory = await ArtemHistory.findOne().sort({ createdAt: -1 });

        if (lastHistory && lastHistory?.action !== action) {
            if (apiCount === 0) tradeDir = 'plus';
            else tradeDir = 'minus';
        }

        if (tradeDir === 'minus') {
            const oppositeAction = action === 'buy' ? 'sell' : 'buy';
            // const latestHistory = await ArtemHistory.findOne({ action }).sort({ createdAt: - 1 });

            // const latestTime = latestHistory ? latestHistory.createdAt.getTime() : Date.now();
            const historySinceLatest = await ArtemHistory.find({
                action: oppositeAction,
                // createdAt: { $gte: new Date(latestTime), $lte: new Date()} 
            }).limit(apiCount);


            if (isClosed) return res.status(200).json({ message: 'success', closed: true });

            const totalSize = historySinceLatest.reduce((sum, record) => sum + Number(record.size), 0);
            console.log(apiCount, historySinceLatest, totalSize)

            const postParams = {
                symbol: 'SBTCSUSDT',
                productType: 'susdt-futures',
                marginMode: 'isolated',
                marginCoin: 'SUSDT',
                size: totalSize,
                side: oppositeAction,
                tradeSide: 'close',
                orderType: 'market',
                clientOid: timestamp,
            }

            const postBody = JSON.stringify(postParams);
            const postSign = sign(preHash(timestamp, "POST", requestPath, postBody), apiSecret || '');

            const result = await axios.post(`https:/api.bitget.com${requestPath}`, postParams, {
                headers: {
                    'ACCESS-KEY': apiKey,
                    'ACCESS-PASSPHRASE': apiPass,
                    'ACCESS-SIGN': postSign,
                    'ACCESS-TIMESTAMP': timestamp
                }
            })
            const newHistory = new ArtemHistory({
                coinpair: 'SBTCSUSDT',
                action,
                size,
                data: result.data
            })
            await newHistory.save();
        } else {
            const postParams = {
                symbol: 'SBTCSUSDT',
                productType: 'susdt-futures',
                marginMode: 'isolated',
                marginCoin: 'SUSDT',
                size,
                side: action,
                tradeSide: 'open',
                orderType: 'market',
                clientOid: timestamp,
            }
            const postBody = JSON.stringify(postParams);
            const postSign = sign(preHash(timestamp, "POST", requestPath, postBody), apiSecret || '');

            const result = await axios.post(`https:/api.bitget.com${requestPath}`, postParams, {
                headers: {
                    'ACCESS-KEY': apiKey,
                    'ACCESS-PASSPHRASE': apiPass,
                    'ACCESS-SIGN': postSign,
                    'ACCESS-TIMESTAMP': timestamp
                }
            })
            const newHistory = new ArtemHistory({
                coinpair,
                action,
                size,
                data: result.data
            })
            await newHistory.save();
        }

        if (tradeDir === 'plus') apiCount++;
        else apiCount--;

        // const result = await axios.get("https://api.bitget.com/api/v2/mix/market/tickers?productType=SUSDT-FUTURES");
        return res.status(200).json({ message: 'success' });
    } catch (error: any) {
        console.error('Error during webhook handling:', error);
        return res.status(500).json({ message: 'Server error' });
    }
})

router.post('/:username/:webhookUrl', webhooksMaintenanceMiddleware, async (req, res) => {
    try {
        const { username, webhookUrl } = req.params;
        const { ticker, action, amount, exchange } = req.body;

        const user = await User.findOne({ email: username });
        const webhook = await Hook.findOne({ url: webhookUrl, creator: user?._id });
        if (!webhook || webhook.status === 1) {
            return res.status(400).json({ message: 'Webhook URL is not available or disabled' });
        }

        if (!ticker || !action || !amount || (action !== 'buy' && action !== 'sell') || exchange !== 'CoinEx') {
            return res.status(400).json({ message: 'Invalid request payload' });
        }

        const result = await handleTrade(webhook, ticker, action, webhook.amount || amount);
        if (!result.success) {
            return res.status(500).json({ message: result.message });
        }

        return res.status(200).json({ message: result.message });
    } catch (error) {
        console.error('Error during webhook handling:', error);
        return res.status(500).json({ message: 'Server error' });
    }
});


router.get('/resend/:id', jwtAuth, webhooksMaintenanceMiddleware, async (req, res) => {
    const id = req.params.id;

    try {
        const history = await History.findById(id);
        const webhook = await Hook.findById(history?.hook);

        if (history && webhook) {
            const result = await handleTrade(webhook, history.symbol, history.action, history.amount, history);
            if (!result.success) {
                return res.status(500).json({ message: result.message });
            }

            return res.status(200).json({ message: 'Resend successful' });
        } else {
            return res.status(400).json({ message: 'Not found' });
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// router.get('/test', async (req, res) => {
//     const result = await checkOrderExisting('SOLUSDT', 'sell', '842797C7FFFE4C3789F895B4259D7C88', '14D24FB43E72A33E947B765918CEF6F00A2A18260959AC64');
//     return res.status(200).json({ result })
// })

export default router;
