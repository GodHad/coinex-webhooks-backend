import express from 'express';
import Hook from '../models/Hook';
import History from '../models/History';
import crypto from 'crypto';
import axios from 'axios';
import User, { IUser } from '../models/User';
import AdminHook from '../models/AdminHook';
import { jwtAuth } from '../middleware/authorization';

const router = express.Router();
const url = 'https://api.coinex.com/v2/futures/order';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

const getPositionData = async (
    symbol: string,
    coinExApiKey: string,
    coinExApiSecret: string
): Promise<{ success: boolean; data?: any; error?: any }> => {
    const response = await axios.get('https://api.coinex.com/v2/time');
    const timestamp = response.data.data.timestamp.toStrin

    const url = `/v2/futures/pending-position?market=${symbol}&market_type=FUTURES&page=1&limit=1`

    try {
        const result = await axios.get('https://api.coinex.com' + url, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                Accept: 'application/json',
                "X-COINEX-KEY": coinExApiKey,
                "X-COINEX-SIGN": createAuthorization("GET", url, "", timestamp, coinExApiSecret),
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

const handleTradeSignal = (action: string, tradeDirection: string, positionState: string) => {
    let requiredActions: { action: string; isClosing: boolean }[] = [];

    switch (tradeDirection) {
        case "BOTH":
            if (action === "buy") {
                if (positionState === "short") {
                    requiredActions.push({ action: "buy", isClosing: true });
                    requiredActions.push({ action: "buy", isClosing: false });
                } else if (positionState === "neutral" || positionState === "long") {
                    requiredActions.push({ action: "buy", isClosing: false });
                }
            } else if (action === "sell") {
                if (positionState === "long") {
                    requiredActions.push({ action: "sell", isClosing: true });
                    requiredActions.push({ action: "sell", isClosing: false });
                } else if (positionState === "neutral" || positionState === "short") {
                    requiredActions.push({ action: "sell", isClosing: false });
                }
            }
            break;

        case "SHORT_ONLY":
            if (action === "sell" && positionState === "neutral") {
                requiredActions.push({ action: "sell", isClosing: false });
            } else if (action === "buy" && positionState === "short") {
                requiredActions.push({ action: "buy", isClosing: true });
            }
            break;

        case "LONG_ONLY":
            if (action === "buy" && positionState === "neutral") {
                requiredActions.push({ action: "buy", isClosing: false });
            } else if (action === "sell" && positionState === "long") {
                requiredActions.push({ action: "sell", isClosing: true });
            }
            break;

        default:
            console.error("Invalid trade direction");
    }

    return requiredActions;
};

const handleTrade = async (
    webhook: any,
    ticker: string,
    action: string,
    amount: string
): Promise<{ success: boolean; message?: string }> => {
    const requiredActions = handleTradeSignal(action, webhook.tradeDirection, webhook.positionState);

    for (const { action: tradeAction, isClosing } of requiredActions) {
        const { success, data, error } = await placeOrderOnCoinEx(
            ticker,
            tradeAction,
            amount,
            webhook.coinExApiKey,
            webhook.coinExApiSecret
        );

        if (!success) {
            return { success: false, message: 'Order placement failed' };
        }

        const newHistory = new History({
            hook: webhook._id,
            symbol: ticker,
            action: tradeAction,
            amount,
            status: success,
            error: error || null,
            data: data || null,
            positionState: webhook.positionState,
            tradeDirection: webhook.tradeDirection
        });
        await newHistory.save();

        const result = await getPositionData(ticker, webhook.coinExApiKey, webhook.coinExApiSecret);

        if (result.success) {
            const data = result.data;
            if (data.code === 0) {
                const position = data.data[0];
                webhook.leverage = position.leverage;
                webhook.entryPrice = position.avg_entry_price;
                webhook.stopLossPrice = position.stop_loss_price;
                webhook.takeProfitPrice = position.take_profit_price;
                webhook.currentPrice = position.settle_price;
            }
        }

        if (isClosing) {
            webhook.positionState = 'neutral';
        } else if (tradeAction === 'buy') {
            webhook.positionState = 'long';
        } else if (tradeAction === 'sell') {
            webhook.positionState = 'short';
        }

        await webhook.save();
        await delay(60000);
    }

    return { success: true, message: 'Order placed successfully' };
};

router.post('/:webhookUrl', async (req, res) => {
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

        const result = await handleTrade(webhook, ticker, action, amount);
        if (!result.success) {
            return res.status(500).json({ message: result.message });
        }

        return res.status(200).json({ message: result.message });
    } catch (error) {
        console.error('Error during webhook handling:', error);
        return res.status(500).json({ message: 'Server error' });
    }
});


router.post('/:username/:webhookUrl', async (req, res) => {
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

        const result = await handleTrade(webhook, ticker, action, amount);
        if (!result.success) {
            return res.status(500).json({ message: result.message });
        }

        return res.status(200).json({ message: result.message });
    } catch (error) {
        console.error('Error during webhook handling:', error);
        return res.status(500).json({ message: 'Server error' });
    }
});


router.get('/resend/:id', jwtAuth, async (req, res) => {
    const id = req.params.id;

    try {
        const history = await History.findById(id);
        const webhook = await Hook.findById(history?.hook);

        if (history && webhook) {
            const result = await handleTrade(webhook, history.symbol, history.action, history.amount);
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
})

export default router;
