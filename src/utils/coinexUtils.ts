import axios from "axios";
import crypto from 'crypto';
import History, { IHistory } from "../models/History";
import Hook, { IHook } from "../models/Hook";
import { sendEmail } from "./sendMail";
import User from "../models/User";
import dotenv from 'dotenv';

dotenv.config();

const commonURL = process.env.COINEX_API_URL;

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
    const response = await axios.get(commonURL + '/v2/time');
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

async function fetchFuturesAvailableBalance(
    quote: string,
    coinExApiKey: string,
    coinExApiSecret: string
): Promise<number | undefined> {
    const timestamp = await getTimestamp();
    // v2 balance endpoint – according to the documentation, the account_type
    // parameter distinguishes futures from spot or margin accounts.  See
    // https://docs.coinex.com/api/v2/assets/balance/http/get-futures-balance
    const path = `/v2/assets/futures/balance`;
    const res = await axios.get(commonURL + path, {
        headers: {
            'X-COINEX-KEY': coinExApiKey,
            'X-COINEX-SIGN': createAuthorization('GET', path, '', timestamp, coinExApiSecret),
            'X-COINEX-TIMESTAMP': timestamp,
        },
    });
    if (res.data && res.data.code === 0) {
        // The v2 response may return an array of assets or a keyed object.
        const data = res.data.data;
        if (Array.isArray(data)) {
            // Search for the quote currency in array form
            for (const item of data) {
                if (item && (item.ccy === quote)) {
                    const availableStr = item.available;
                    const available = availableStr !== undefined ? parseFloat(availableStr) : NaN;
                    if (!isNaN(available)) return available;
                }
            }
        } else if (data && typeof data === 'object') {
            // Keyed by currency code (similar to v1 format)
            const entry = data[quote];
            if (entry && entry.available !== undefined) {
                const available = parseFloat(entry.available);
                if (!isNaN(available)) return available;
            }
        }
    }
    return undefined;
}

async function fetchTickerPriceV2(
    symbol: string,
    coinExApiKey: string,
    coinExApiSecret: string
): Promise<number | undefined> {
    const timestamp = await getTimestamp();
    const path = `/v2/futures/ticker?market=${encodeURIComponent(symbol)}`;
    const res = await axios.get(commonURL + path, {
        headers: {
            'X-COINEX-KEY': coinExApiKey,
            'X-COINEX-SIGN': createAuthorization('GET', path, '', timestamp, coinExApiSecret),
            'X-COINEX-TIMESTAMP': timestamp,
        }
    });

    if (res.data?.code !== 0) return undefined;

    const arr = res.data?.data;
    if (!Array.isArray(arr) || arr.length === 0) return undefined;

    const row =
        arr.find((x: any) => String(x?.market).toUpperCase() === symbol.toUpperCase()) ?? arr[0];

    const price = Number(row?.last ?? row?.mark_price);
    return Number.isFinite(price) && price > 0 ? price : undefined;
}

async function fetchLeverageFromPendingPosition(
    symbol: string,
    coinExApiKey: string,
    coinExApiSecret: string
): Promise<number | undefined> {
    const timestamp = await getTimestamp();
    const path = `/v2/futures/pending-position?market=${encodeURIComponent(symbol)}&market_type=FUTURES&page=1&limit=1`;
    const res = await axios.get(commonURL + path, {
        headers: {
            'X-COINEX-KEY': coinExApiKey,
            'X-COINEX-SIGN': createAuthorization('GET', path, '', timestamp, coinExApiSecret),
            'X-COINEX-TIMESTAMP': timestamp,
        },
    });
    if (res.data?.code === 0 && Array.isArray(res.data.data) && res.data.data[0]?.leverage) {
        const lev = Number(res.data.data[0].leverage);
        if (Number.isFinite(lev) && lev > 0) return lev;
    }
    return undefined;
}

async function fetchLeverageFromLastFinishedPosition(
    symbol: string,
    coinExApiKey: string,
    coinExApiSecret: string
): Promise<number | undefined> {
    const timestamp = await getTimestamp();
    const path = `/v2/futures/finished-position?market=${encodeURIComponent(symbol)}&market_type=FUTURES&page=1&limit=1`;

    const res = await axios.get(commonURL + path, {
        headers: {
            'X-COINEX-KEY': coinExApiKey,
            'X-COINEX-SIGN': createAuthorization('GET', path, '', timestamp, coinExApiSecret),
            'X-COINEX-TIMESTAMP': timestamp,
        },
    });

    if (res.data?.code === 0 && Array.isArray(res.data?.data) && res.data.data.length) {
        const row = res.data.data[0];
        const lev = Number(row?.leverage ?? row?.position?.leverage);
        if (Number.isFinite(lev) && lev > 0) return lev;
    }
    return undefined;
}

async function resolveLeverage(
    symbol: string,
    coinExApiKey: string,
    coinExApiSecret: string
): Promise<number> {
    const fromPending = await fetchLeverageFromPendingPosition(symbol, coinExApiKey, coinExApiSecret);
    if (fromPending && fromPending > 0) return fromPending;

    const fromFinished = await fetchLeverageFromLastFinishedPosition(symbol, coinExApiKey, coinExApiSecret);
    if (fromFinished && fromFinished > 0) return fromFinished;

    return 3;
}


/**
 * Helper to compute the trade amount when a percentage based order is
 * requested. When the unit is '%', the `amount` argument is interpreted as
 * a percentage of the available balance in the futures account (denominated
 * in the quote currency of the trading pair).  The helper fetches the
 * available balance via the Asset API (`/perpetual/v1/asset/query`) and the
 * latest market price via the Market API (`/perpetual/v1/market/ticker`).
 * It converts the percentage of available funds into an asset quantity by
 * dividing by the current price.  If any of the API calls fail, or the
 * inputs are invalid, the original `amountStr` is returned unchanged.
 *
 * @param unit  Unit indicator (only '%' triggers percentage logic)
 * @param amountStr  The requested amount or percentage as a string
 * @param symbol  Market symbol (e.g. "BTCUSDT")
 * @param coinExApiKey  API key for CoinEx
 * @param coinExApiSecret API secret for CoinEx
 */
const computePercentageAmount = async (
    unit: string | undefined,
    amountStr: string,
    symbol: string,
    coinExApiKey: string,
    coinExApiSecret: string,
    isClosing: boolean
): Promise<string> => {
    if (unit !== '%') return amountStr;

    const percent = Number(amountStr);
    if (!Number.isFinite(percent) || percent <= 0) return amountStr;

    try {
        const quote = ['USDT', 'USDC', 'USD', 'BUSD', 'TUSD'].find(q => symbol.endsWith(q)) || 'USDT';

        const [availableBalance, lastPrice] = await Promise.all([
            fetchFuturesAvailableBalance(quote, coinExApiKey, coinExApiSecret),
            fetchTickerPriceV2(symbol, coinExApiKey, coinExApiSecret),
        ]);

        if (availableBalance === undefined || availableBalance <= 0 || !lastPrice || !Number.isFinite(lastPrice)) {
            return amountStr;
        }

        const leverage = await resolveLeverage(symbol, coinExApiKey, coinExApiSecret);

        const marginPortion = (availableBalance * percent) / 100;
        const notional = marginPortion * leverage;
        const assetQty = notional / lastPrice;

        return assetQty.toFixed(8);
    } catch {
        return amountStr;
    }
};

const placeOrderOnCoinEx = async (
    symbol: string,
    action: string,
    amount: string,
    coinExApiKey: string,
    coinExApiSecret: string,
    isClosing: boolean,
    unit?: string,
): Promise<{ success: boolean; data?: any; error?: any }> => {
    const timestamp = await getTimestamp();

    if (isClosing) {
        const pendingOrders = await checkOrderExisting(symbol, action, coinExApiKey, coinExApiSecret);
        const side = action === 'buy' ? 'short' : 'long';

        if (pendingOrders.filter((o: any) => o.side === side).length === 0) {
            return {
                success: false,
                error: 'No pending orders'
            }
        }
    }

    // Determine the final order size. When `unit` is '%', the amount is
    // treated as a percentage of the current open position.
    const finalAmount = await computePercentageAmount(unit, amount, symbol, coinExApiKey, coinExApiSecret, isClosing);

    const data = JSON.stringify({
        market: symbol,
        market_type: 'FUTURES',
        side: action,
        type: 'market',
        amount: finalAmount,
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
        const result = await axios.get(commonURL + url, {
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
    unit?: string,
): Promise<{ success: boolean; message?: string }> => {
    const requiredActions = history ? [{
        action: history.action,
        isClosing: history.positionState !== 'neutral'
    }] : handleTradeSignal(action, webhook.tradeDirection, webhook.positionState);
    const user = await User.findById(webhook.creator._id || webhook.creator);

    for (const { action: tradeAction, isClosing } of requiredActions) {
        const { success, data, error } = await placeOrderOnCoinEx(
            ticker,
            tradeAction,
            amount,
            webhook.coinExApiKey,
            webhook.coinExApiSecret,
            isClosing,
            unit
        );

        if (history) {
            history.isResended = true;
            history.resendStatus = success;
            history.resendResult = data || null;
            history.resendError = error || null;
            if (user && data && data.code !== 0) {
                const { code, msg } = describeError(data);
                await sendEmail(
                    user.email,
                    `Trade Failed (${history.symbol})`,
                    [
                        `Action: ${history.action.toUpperCase()}`,
                        `Symbol: ${history.symbol}`,
                        `Requested amount: ${amount} ${unit === '%' ? `(${amount}% requested)` : ticker.substring(0, -4)}`,
                        `Reason: ${msg} (code ${code})`,
                    ].join('\n'),
                    ''
                );
            }
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
                if (user) {
                    const { code, msg } = describeError(data);
                    await sendEmail(
                        user.email,
                        `Trade Failed (${newHistory.symbol})`,
                        [
                            `Action: ${newHistory.action.toUpperCase()}`,
                            `Symbol: ${newHistory.symbol}`,
                            `Requested amount: ${amount} ${unit === '%' ? `(${amount}% requested)` : ticker.substring(0, -4)}`,
                            `Reason: ${msg} (code ${code})`,
                        ].join('\n'),
                        ''
                    );
                }
                await handleTrade(webhook, newHistory.symbol, newHistory.action, newHistory.amount, newHistory, unit);
            }

            if (success && data && data.code === 0) {
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
        if (data && data.code === 0) {
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
        const result = await axios.get(commonURL + url, {
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

            const result = await axios.get(commonURL + url, {
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

            const result = await axios.get(commonURL + url, {
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

export const CODE_MAP: Record<number, string> = {
    3102: 'Insufficient balance',
    3302: 'Leverage exceeds allowed range',
    3108: 'Amount below minimum',
    3401: 'Position not found',

    3008: 'Service busy, please try again later.',
    3109: 'Insufficient balance, please adjust the order quantity or make another deposit.',
    3127: 'The order quantity is below the minimum requirement. Please adjust the order quantity.',
    3606: 'The price difference between the order price and the latest price is too large. Please adjust the order amount accordingly.',
    3610: 'Order cancellation prohibited during the Call Auction period.',
    3612: 'The est. ask price is lower than the current bottom ask price. Please reduce the amount.',
    3613: 'The est. bid price is higher than the current top bid price. Please reduce the amount.',
    3614: 'The deviation between your est. filled price and the index price. Please reduce the amount.',
    3615: 'The deviation between your order price and the index price is too high. Please adjust your order price and try again.',
    3616: 'The order price exceeds the current top bid price. Please adjust the order price and try again.',
    3617: 'The order price exceeds the current bottom ask price. Please adjust the order price and try again.',
    3618: 'The deviation between your order price and the index price is too high. Please adjust your order price and try again.',
    3619: 'The deviation between your order price and the trigger price is too high. Please adjust your order price and try again.',
    3620: 'Market order submission is temporarily unavailable due to insufficient depth in the current market',
    3621: "This order can't be completely executed and has been canceled.",
    3622: "This order can't be set as Maker Only and has been canceled.",
    3627: 'The current market depth is low, please reduce your order amount and try again.',
    3628: 'The current market depth is low, please reduce your order amount and try again.',
    3629: 'The current market depth is low, please reduce your order amount and try again.',
    3632: 'The order price exceeds the current top bid price. Please adjust the order price and try again.',
    3633: 'The order price exceeds the current bottom ask price. Please adjust the order price and try again.',
    3634: 'The deviation between your est. filled price and the index price is too high. Please reduce the amount and try again.',
    3635: 'The deviation between your est. filled price and the index price is too high. Please reduce the amount and try again.',
    3638: 'Currently in protection period, only Maker Only Limit Orders placement and order cancellations are supported.',
    3639: 'Request parameters incorrect. Please check whether the request complies with the document description.',
    4001: 'Service unavailable, please try again later.',
    4002: 'Service request timed out, please try again later.',
    4003: 'Internal error, please contact customer service for help.',
    4004: 'Parameter error, please check whether the request parameters are abnormal.',
    4005: 'Abnormal access_id, please check whether the value passed by `X-COINEX-KEY` is normal.',
    4006: 'Signature verification failed, please check the signature according to the documentation instructions.',
    4007: 'IP address prohibited, please check whether the whitelist or export IP is normal.',
    4008: 'Abnormal `X-COIN-SIGN` value, please check.',
    4009: 'Abnormal request method, please check.',
    4010: 'Expired request, please try again later.',
    4011: 'User prohibited from accessing, please contact customer service for help.',
    4017: 'Signature expired, please try again later.',
    4018: 'The endpoint has been deprecated. Please use the new version of this endpoint.',
    4115: 'User prohibited from trading, please contact customer service for help.',
    4117: 'Trading prohibited in this market, please try again later.',
    4130: 'Futures trading prohibited, please try again later.',
    4158: 'Trading prohibited, please try again later.',
    4159: 'API trading is unavailable in the current market',
    4213: 'The request is too frequent, please try again later.',
    4512: 'Insufficient sub-account permissions, please check.',

    20001: 'Request parameter error, please check.',
    20002: 'No corresponding method found',
    21001: 'This method requires authentication, please authenticate first.',
    21002: 'Authentication failed',
    23001: 'Request service timeout',
    23002: 'Requests submitted too frequently',
    24001: 'Internal Error',
    24002: 'Service unavailable temporarily',

    30001: 'Request parameter error, please check.',
    30002: 'No corresponding method found',
    31001: 'This method requires authentication, please authenticate first.',
    31002: 'Authentication failed',
    33001: 'Request service timeout',
    33002: 'Requests submitted too frequently',
    34001: 'Internal Error',
    34002: 'Service unavailable temporarily',
};

function describeError(payload: any) {
    const code = Number(payload?.code);
    const msg = payload?.message || CODE_MAP[code] || 'Unknown error';
    return { code, msg };
}