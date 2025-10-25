import { fetchTickerPriceV2, handleSetSL } from '../utils/coinexUtils';
import PositionTrailingState, { TrailingType, TrailingSide } from '../models/PositionTrailingState';

export interface TrailingRuntimeConfig {
    stateId?: string;
    positionId: string;
    hookId: string;
    market: string;
    side: TrailingSide;
    entryPrice: number;
    currentPrice: number;
    minProfitThreshold: number;
    trailDistance: number;
    trailType: TrailingType;
    coinExApiKey: string;
    coinExApiSecret: string;
    highestPrice?: number;
    currentStopLoss?: number;
}

interface InternalTrailingConfig {
    stateId?: string;
    positionId: string;
    hookId: string;
    market: string;
    side: TrailingSide;
    entryPrice: number;
    currentPrice: number;
    minProfitThreshold: number;
    trailDistance: number;
    trailType: TrailingType;
    isActive: boolean;
    highestPrice?: number;
    currentStopLoss?: number;
    lastCheckedAt?: number;
    coinExApiKey: string;
    coinExApiSecret: string;
}

class TrailingStopService {
    private items = new Map<string, InternalTrailingConfig>();
    private readonly intervalMs: number;

    constructor() {
        const envMs = Number(process.env.TRAILING_STOP_CHECK_INTERVAL || 10000);
        const clamped = Number.isFinite(envMs) && envMs > 0 ? envMs : 10000;
        this.intervalMs = Math.max(5000, clamped);
        setInterval(() => this.tick().catch(() => { }), this.intervalMs);
    }

    private joinKey(hookId: string, positionId: string) {
        return `${hookId}::${positionId}`;
    }

    private profitPercent(entry: number, price: number, side: TrailingSide) {
        return side === 'long'
            ? ((price - entry) / entry) * 100
            : ((entry - price) / entry) * 100;
    }

    private calcATR(market: string): number {
        const atrMap: Record<string, number> = {
            BTCUSDT: 800,
            ETHUSDT: 50,
            SOLUSDT: 2.5,
            ADAUSDT: 0.02,
        };
        return atrMap[market] || 1.0;
    }

    private calcVol(market: string): number {
        const volMap: Record<string, number> = {
            BTCUSDT: 0.025,
            ETHUSDT: 0.03,
            SOLUSDT: 0.035,
            ADAUSDT: 0.04,
        };
        return volMap[market] || 0.025;
    }

    private calcStop(price: number, cfg: InternalTrailingConfig): number {
        let distance = 0;
        switch (cfg.trailType) {
            case 'percentage':
                distance = price * (cfg.trailDistance / 100);
                break;
            case 'fixed':
                distance = cfg.trailDistance;
                break;
            case 'atr':
                distance = this.calcATR(cfg.market) * cfg.trailDistance;
                break;
            case 'volatility':
                distance = price * this.calcVol(cfg.market) * cfg.trailDistance;
                break;
            default:
                distance = price * (cfg.trailDistance / 100);
        }
        return cfg.side === 'long' ? price - distance : price + distance;
    }

    enableForPosition(params: TrailingRuntimeConfig) {
        const market = params.market.toUpperCase();
        const key = this.joinKey(params.hookId, params.positionId);
        const existing = this.items.get(key);

        if (existing) {
            existing.stateId = params.stateId;
            existing.market = market;
            existing.side = params.side;
            existing.entryPrice = params.entryPrice;
            existing.currentPrice = params.currentPrice;
            existing.minProfitThreshold = params.minProfitThreshold;
            existing.trailDistance = params.trailDistance;
            existing.trailType = params.trailType;
            existing.coinExApiKey = params.coinExApiKey;
            existing.coinExApiSecret = params.coinExApiSecret;
            existing.isActive = true;

            if (params.highestPrice !== undefined) {
                existing.highestPrice = params.highestPrice;
            } else if (!existing.highestPrice) {
                existing.highestPrice = params.currentPrice;
            }
            if (params.currentStopLoss !== undefined) {
                existing.currentStopLoss = params.currentStopLoss;
            }

            return existing;
        }

        const cfg: InternalTrailingConfig = {
            stateId: params.stateId,
            positionId: params.positionId,
            hookId: params.hookId,
            market,
            side: params.side,
            entryPrice: params.entryPrice,
            currentPrice: params.currentPrice,
            minProfitThreshold: params.minProfitThreshold,
            trailDistance: params.trailDistance,
            trailType: params.trailType,
            isActive: true,
            highestPrice: params.highestPrice ?? params.currentPrice,
            currentStopLoss: params.currentStopLoss,
            coinExApiKey: params.coinExApiKey,
            coinExApiSecret: params.coinExApiSecret,
            lastCheckedAt: Date.now(),
        };

        const profit = this.profitPercent(cfg.entryPrice, cfg.currentPrice, cfg.side);
        if (profit >= cfg.minProfitThreshold) {
            const stop = this.calcStop(cfg.currentPrice, cfg);
            cfg.currentStopLoss = stop;
            handleSetSL(String(stop), 'mark_price', cfg.market, cfg.coinExApiKey, cfg.coinExApiSecret)
                .catch(() => { });
        }

        this.items.set(key, cfg);
        return cfg;
    }

    async disablePosition(positionId: string, hookId?: string) {
        const key = hookId ? this.joinKey(hookId, positionId) : null;
        if (key) {
            this.items.delete(key);
        } else {
            for (const k of this.items.keys()) {
                const cfg = this.items.get(k);
                if (cfg?.positionId === positionId) {
                    this.items.delete(k);
                }
            }
        }
        try {
            const filter: any = { positionId };
            if (hookId) filter.hook = hookId;
            await PositionTrailingState.updateOne(filter, { $set: { isEnabled: false } }).exec();
        } catch {
            // ignore failures
        }
    }

    syncEnabledStates(states: TrailingRuntimeConfig[]) {
        const next = new Set<string>();
        for (const state of states) {
            const cfg = this.enableForPosition(state);
            next.add(this.joinKey(cfg.hookId, cfg.positionId));
        }

        for (const key of Array.from(this.items.keys())) {
            if (!next.has(key)) {
                this.items.delete(key);
            }
        }
    }

    private async tick() {
        if (this.items.size === 0) return;

        // Group active items by market + API credentials to avoid fetching the same
        // ticker price multiple times for positions that share the same market.
        const activeItems = Array.from(this.items.values()).filter(i => i.isActive);
        const groups = new Map<string, InternalTrailingConfig[]>();

        for (const cfg of activeItems) {
            const groupKey = `${cfg.market}::${cfg.coinExApiKey || ''}::${cfg.coinExApiSecret || ''}`;
            const arr = groups.get(groupKey) || [];
            arr.push(cfg);
            groups.set(groupKey, arr);
        }

        for (const [groupKey, configs] of groups.entries()) {
            const [market, apiKey, apiSecret] = groupKey.split('::');
            try {
                const price = await fetchTickerPriceV2(market, apiKey, apiSecret);
                if (!price || !Number.isFinite(price)) continue;

                const now = Date.now();

                for (const cfg of configs) {
                    try {
                        cfg.currentPrice = price;
                        cfg.lastCheckedAt = now;

                        const persistBase = {
                            currentPrice: price,
                            lastCheckedAt: new Date(cfg.lastCheckedAt),
                        };

                        if (!cfg.currentStopLoss) {
                            const profit = this.profitPercent(cfg.entryPrice, price, cfg.side);
                            if (profit >= cfg.minProfitThreshold) {
                                cfg.highestPrice = price;
                                const stop = this.calcStop(price, cfg);
                                cfg.currentStopLoss = stop;
                                await handleSetSL(String(stop), 'mark_price', cfg.market, cfg.coinExApiKey, cfg.coinExApiSecret);
                                await this.saveState(cfg, {
                                    ...persistBase,
                                    highestPrice: cfg.highestPrice,
                                    currentStopLoss: cfg.currentStopLoss,
                                });
                                continue;
                            }

                            await this.saveState(cfg, persistBase);
                        }

                        const isNewExtreme =
                            cfg.side === 'long'
                                ? price > (cfg.highestPrice || 0)
                                : price < (cfg.highestPrice ?? Number.POSITIVE_INFINITY);

                        if (isNewExtreme) {
                            cfg.highestPrice = price;
                            const nextStop = this.calcStop(price, cfg);
                            const currentReference =
                                cfg.side === 'long'
                                    ? cfg.currentStopLoss || 0
                                    : cfg.currentStopLoss ?? Number.POSITIVE_INFINITY;

                            const better = cfg.side === 'long' ? nextStop > currentReference : nextStop < currentReference;

                            if (better) {
                                cfg.currentStopLoss = nextStop;
                                await handleSetSL(String(nextStop), 'mark_price', cfg.market, cfg.coinExApiKey, cfg.coinExApiSecret);
                                await this.saveState(cfg, {
                                    ...persistBase,
                                    highestPrice: cfg.highestPrice,
                                    currentStopLoss: cfg.currentStopLoss,
                                });
                            } else {
                                await this.saveState(cfg, { ...persistBase, highestPrice: cfg.highestPrice });
                            }
                        } else {
                            await this.saveState(cfg, persistBase);
                        }

                        // if (cfg.currentStopLoss !== undefined && cfg.currentStopLoss !== null) {
                        //     const triggered = cfg.side === 'long' ? price <= cfg.currentStopLoss : price >= cfg.currentStopLoss;
                        //     if (triggered) {
                        //         this.items.delete(this.joinKey(cfg.hookId, cfg.positionId));
                        //         await this.saveState(cfg, {
                        //             ...persistBase,
                        //             highestPrice: cfg.highestPrice,
                        //             currentStopLoss: cfg.currentStopLoss,
                        //             isEnabled: false,
                        //         });
                        //     }
                        // }
                    } catch {
                        // ignore per-position errors
                    }
                }
            } catch {
                // ignore group-level errors
            }
        }
    }

    private async saveState(cfg: InternalTrailingConfig, update: Record<string, any>) {
        try {
            const filter: any = { positionId: cfg.positionId, hook: cfg.hookId };
            if (cfg.stateId) {
                filter._id = cfg.stateId;
            }

            await PositionTrailingState.updateOne(filter, { $set: update }).exec();
        } catch {
            // swallow persistence errors
        }
    }
}

export const trailingStopService = new TrailingStopService();
