import axios from "axios";
import crypto from 'crypto';
import History, { IHistory } from "../models/History";
import { IHook } from "../models/Hook";

const commonURL = 'https://api.coinex.com';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function createAuthorization(method: string, request_path: string, body_json: string, timestamp: string, SECRET_KEY: string) {
    var text = method + request_path + body_json + timestamp;
    return crypto
        .createHmac("sha256", SECRET_KEY)
        .update(text)
        .digest("hex")
        .toLowerCase();
}

const getTimestamp = async () => {
    const response = await axios.get('https://api.coinex.com/v2/time');
    const timestamp = response.data.data.timestamp.toString();
    return timestamp;
}

export const checkOrderExisting = async (symbol: string, action: string, coinExApiKey: string, coinExApiSecret: string) => {
    const timestamp = await getTimestamp();
    const data = {
        market: symbol,
        market_type: 'FUTURES',
    };

    const queryString = (Object.keys(data) as (keyof typeof data)[])
        .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
        .join('&');
    const requestPath = "/v2/futures/pending-position" + "?" + queryString;
    const res = await axios.get(commonURL + requestPath, {
        headers: {
            "X-COINEX-KEY": coinExApiKey,
            "X-COINEX-SIGN": createAuthorization("GET", requestPath, "", timestamp, coinExApiSecret),
            "X-COINEX-TIMESTAMP": timestamp,
        }
    });
    const pendingOrders = res.data.code === 0 ? res.data.data : [];
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
    const timestamp = await getTimestamp();

    if (isClosing) {
        const pendingOrders = await checkOrderExisting(symbol, action, coinExApiKey, coinExApiSecret);
        const side = action === 'buy' ? 'short' : 'long';
        console.log(pendingOrders, side, action)
        if (pendingOrders.filter((o: any) => o.side === side).length === 0) {
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
    const timestamp = await getTimestamp();

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
    webhook: IHook,
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
            await delay(100);

            if (data && data.code !== 0) {
                await handleTrade(webhook, newHistory.symbol, newHistory.action, newHistory.amount, newHistory);
            }

            if (success && data.code === 0) {
                if (isClosing) {
                    webhook.positionState = 'neutral';
                    webhook.stopLossPrice = '';
                    webhook.takeProfitPrice = '';
                    await webhook.save();
                } else if (tradeAction === 'buy') {
                    webhook.positionState = 'long';
                } else if (tradeAction === 'sell') {
                    webhook.positionState = 'short';
                }
            }
        }

        await webhook.save();
        await delay(200);
    }

    const result = await getPositionData(ticker, webhook.coinExApiKey, webhook.coinExApiSecret);

    if (result.success) {
        const data = result.data;
        if (data.code === 0) {
            const position = data.data[0];
            if (position) {
                webhook.leverage = position.leverage;
                webhook.entryPrice = position.avg_entry_price;
                webhook.stopLossPrice = position.stop_loss_price;
                webhook.takeProfitPrice = position.take_profit_price;
                webhook.currentPrice = position.settle_price;
            }
        }
    }

    // if (webhook.adminHook) {
    //     if (webhook.takeProfitPrice) await handleSetTP(webhook.takeProfitPrice, ticker, webhook.coinExApiKey, webhook.coinExApiSecret);
    //     if (webhook.stopLossPrice) await handleSetSL(webhook.stopLossPrice, ticker, webhook.coinExApiKey, webhook.coinExApiSecret);
    // }

    return { success: true, message: 'Order placed successfully' };
};

export const handleSetTP = async (
    takeProfitPrice: string,
    symbol: string,
    coinExApiKey: string,
    coinExApiSecret: string,
): Promise<{ success: boolean; message?: string; }> => {
    const timestamp = await getTimestamp();

    const data = JSON.stringify({
        market: symbol,
        market_type: 'FUTURES',
        take_profit_type: 'mark_price',
        take_profit_price: takeProfitPrice,
    });

    try {
        const result = await axios.post(commonURL + '/v2/futures/set-position-take-profit', data, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                Accept: 'application/json',
                "X-COINEX-KEY": coinExApiKey,
                "X-COINEX-SIGN": createAuthorization("POST", "/v2/futures/set-position-take-profit", data, timestamp, coinExApiSecret),
                "X-COINEX-TIMESTAMP": timestamp,
            },
        });

        if (result.data.code === 0) {
            return {
                success: true,
                message: 'Set TP successfully',
            };
        }

        console.error(' CoinEx API Request Failed:', result.data);

        return {
            success: false,
            message: result.data.message,
        }
    } catch (error: any) {
        console.error('CoinEx API Request Failed:', error.response?.data || error.message);
        return {
            success: false,
            message: 'Failed to set TP',
        };
    }
}

export const handleSetSL = async (
    stopLossPrice: string,
    symbol: string,
    coinExApiKey: string,
    coinExApiSecret: string,
): Promise<{ success: boolean; message?: string; }> => {
    const timestamp = await getTimestamp();

    const data = JSON.stringify({
        market: symbol,
        market_type: 'FUTURES',
        stop_loss_type: 'mark_price',
        stop_loss_price: stopLossPrice,
    });

    try {
        const result = await axios.post(commonURL + '/v2/futures/set-position-stop-loss', data, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                Accept: 'application/json',
                "X-COINEX-KEY": coinExApiKey,
                "X-COINEX-SIGN": createAuthorization("POST", "/v2/futures/set-position-stop-loss", data, timestamp, coinExApiSecret),
                "X-COINEX-TIMESTAMP": timestamp,
            },
        });

        if (result.data.code === 0) {
            return {
                success: true,
                message: 'Set SL successfully',
            };
        }

        console.error(' CoinEx API Request Failed:', result.data);

        return {
            success: false,
            message: result.data.message,
        }
    } catch (error: any) {
        console.error('CoinEx API Request Failed:', error.response?.data || error.message);
        return {
            success: false,
            message: 'Failed to set SL',
        };
    }
}

export const handleGetDataFromCoinex = async (
    coinExApiKey: string,
    coinExApiSecret: string,
    url: string,
): Promise<{ success: boolean, data?: any; error?: any }> => {
    const timestamp = await getTimestamp();
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
}

export const handleGetHistoryDataFromCoinex = async (
    coinExApiKey: string,
    coinExApiSecret: string,
    startTime: number,
): Promise<{ success: boolean; data?: any; error?: any, lastTimestamp?: number }> => {
    let page = 1;
    let hasNext = true;
    let allData: { position: any; finished: boolean; }[] = [];

    try {
        while (hasNext) {
            const timestamp = await getTimestamp();
            const url = `/v2/futures/pending-position?market_type=FUTURES&page=${page}&limit=100`;

            const result = await axios.get('https://api.coinex.com' + url, {
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    Accept: 'application/json',
                    "X-COINEX-KEY": coinExApiKey,
                    "X-COINEX-SIGN": createAuthorization("GET", url, "", timestamp, coinExApiSecret),
                    "X-COINEX-TIMESTAMP": timestamp,
                },
            });

            const responseData = result.data;
            if (responseData.code !== 0) {
                return {
                    success: false,
                    error: responseData.message,
                };
            }

            if (responseData.data && responseData.data.length > 0) {
                allData = allData.concat(responseData.data.map((p: any) => ({ position: p, finished: false })));
            }

            hasNext = responseData.pagination?.has_next || false;
            page++;
            await delay(500);
        }

        page = 1, hasNext = true;
        let lastTimestamp = 0;
        while (hasNext) {
            const timestamp = await getTimestamp();
            let url = `/v2/futures/finished-position?market_type=FUTURES&page=${page}&limit=100`;
            if (startTime) url += `&start_time=${startTime}`

            const result = await axios.get('https://api.coinex.com' + url, {
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    Accept: 'application/json',
                    "X-COINEX-KEY": coinExApiKey,
                    "X-COINEX-SIGN": createAuthorization("GET", url, "", timestamp, coinExApiSecret),
                    "X-COINEX-TIMESTAMP": timestamp,
                },
            });

            const responseData = result.data;
            if (responseData.code !== 0) {
                return {
                    success: false,
                    error: responseData.message,
                };
            }

            if (responseData.data && responseData.data.length > 0) {
                allData = allData.concat(responseData.data.map((p: any) => ({ position: p, finished: true })));
            }

            hasNext = responseData.pagination?.has_next || false;
            page++;
            lastTimestamp = timestamp;
            await delay(500);
        }

        return {
            success: true,
            data: allData,
            lastTimestamp,
        };
    } catch (error: any) {
        return {
            success: false,
            error: error.response?.data || error.message,
        };
    }
};
