import axios from "axios";
import crypto from 'crypto';
import History, { IHistory } from "../models/History";

const commonURL = 'https://api.coinex.com';

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

export const checkOrderExisting = async (symbol: string, action: string, coinExApiKey: string, coinExApiSecret: string) => {
    const response = await axios.get('https://api.coinex.com/v2/time');
    const timestamp = response.data.data.timestamp.toString();
    const data = {
        market: symbol, 
        market_type: 'FUTURES',
        side: action === 'buy' ? 'sell' : 'buy',
    };

    const queryString = (Object.keys(data) as (keyof typeof data)[])
        .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
        .join('&');
    const requestPath = "/v2/spot/pending-order" + "?" + queryString;
    const res = await axios.get(commonURL + requestPath, {
        headers: {
            "X-COINEX-KEY": coinExApiKey,
            "X-COINEX-SIGN": createAuthorization("GET", requestPath, "", timestamp, coinExApiSecret),
            "X-COINEX-TIMESTAMP": timestamp,
        }
    });
    const pendingOrders = res.data.code === 0 ? res.data.data : [];
    console.log("pending orders:\n", JSON.stringify(res.data, null, 2));
    return pendingOrders;
}

const placeOrderOnCoinEx = async (
    symbol: string,
    action: string,
    amount: string,
    coinExApiKey: string,
    coinExApiSecret: string,
    isClosing: boolean,
): Promise<{ success: boolean; data?: any; error?: any }> => {
    const response = await axios.get('https://api.coinex.com/v2/time');
    const timestamp = response.data.data.timestamp.toString();

    if (isClosing) {
        const pendingOrders = await checkOrderExisting(symbol, action, coinExApiKey, coinExApiSecret);
        if (pendingOrders.length === 0) {
            return {
                success: false,
                error: 'No pending orders'
            }
        }
    }

    const data = JSON.stringify({
        market: symbol,
        market_type: 'FUTURES',
        side: action,
        type: 'market',
        amount: amount,
    });

    try {
        const result = await axios.post(commonURL + '/v2/futures/order', data, {
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

export const handleTrade = async (
    webhook: any,
    ticker: string,
    action: string,
    amount: string,
    history?: IHistory,
): Promise<{ success: boolean; message?: string }> => {
    const requiredActions = history ? [{
        action: history.action,
        isClosing: history.positionState !== 'neutral'
    }] : handleTradeSignal(action, webhook.tradeDirection, webhook.positionState);

    for (const { action: tradeAction, isClosing } of requiredActions) {
        const { success, data, error } = await placeOrderOnCoinEx(
            ticker,
            tradeAction,
            amount,
            webhook.coinExApiKey,
            webhook.coinExApiSecret,
            isClosing
        );

        if (!success) {
            return { success: false, message: 'Order placement failed' };
        }

        if (history) {
            history.isResended = true;
            history.resendStatus = success;
            history.resendResult = data || null;
            history.resendError = error || null;
            await history.save();
        } else {
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
            await delay(60000);
            if (data.code !== 0) {
                await handleTrade(webhook, newHistory.symbol, newHistory.action, newHistory.amount, newHistory);
            }
            if (isClosing) {
                webhook.positionState = 'neutral';
            } else if (tradeAction === 'buy') {
                webhook.positionState = 'long';
            } else if (tradeAction === 'sell') {
                webhook.positionState = 'short';
            }
        }

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

        await webhook.save();
        await delay(60000);
    }

    return { success: true, message: 'Order placed successfully' };
};