import axios from "axios";
import crypto from 'crypto';
import History from "../models/History";

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

export const handleTrade = async (
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