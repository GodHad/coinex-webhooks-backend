import express from 'express';
import { adminAuth, jwtAuth } from '../middleware/authorization';
import { JWTRequest } from '../types/JWTRequest';
import User from '../models/User';
import Hook from '../models/Hook';
import PositionHistory from '../models/PositionHistory';
import { handleAdjustLeverage, handleClosePosition, handleSetSL, handleSetTP } from '../utils/coinexUtils';

const router = express.Router();

router.get('/card-info', jwtAuth, async (req: JWTRequest, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });

        const user = await User.findById(userId);

        const hooks = await Hook.find({ creator: userId });
        const uniqueHooksMap = new Map<string, typeof hooks[number]>();
        hooks.forEach(h => {
            const key = `${h.coinExApiKey}::${h.coinExApiSecret}`;
            if (!uniqueHooksMap.has(key)) uniqueHooksMap.set(key, h);
        });
        const uniqueHooks = Array.from(uniqueHooksMap.values());

        const positionHistories = await PositionHistory.find({
            hook: { $in: uniqueHooks.map(h => h._id) }
        }).lean();

        const getRealizedPnl = (h: any) => {
            const d = h?.data || {};
            const v =
                d.realized_pnl ??
                d.close_pnl ??
                d.pnl_usdt ??
                0;
            const n = Number(v);
            return Number.isFinite(n) ? n : 0;
        };

        const getClosedMs = (h: any) => {
            const d = h?.data || {};
            const v =
                d.created_at ??
                d.close_time ??
                (h.updatedAt ? new Date(h.updatedAt).getTime() : undefined);
            const n = Number(v);
            return Number.isFinite(n) ? n : undefined;
        };

        const now = new Date();
        const startOfTodayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

        const isToday = (ms?: number) => ms != null && ms >= startOfTodayUTC;

        const todaysPnlUSDT = positionHistories
            .filter(h => !!h.finished)
            .filter(h => isToday(getClosedMs(h)))
            .reduce((s, h) => s + getRealizedPnl(h), 0);

        const cumulativePnlUSDT = positionHistories
            .filter(h => !!h.finished)
            .reduce((s, h) => s + getRealizedPnl(h), 0);

        const totalAssetsUSDT = user?.balance?.total ?? 0;

        const dailyIncomeRate = totalAssetsUSDT ? (todaysPnlUSDT / totalAssetsUSDT) * 100 : 0;

        return res.status(200).json({
            cumulativePnl: Number(cumulativePnlUSDT),
            todaysPnl: Number(todaysPnlUSDT),
            totalAssets: totalAssetsUSDT != null ? Number(totalAssetsUSDT) : 0,
            dailyIncomeRate: dailyIncomeRate != null ? Number(dailyIncomeRate) : 0,
            currency: 'USDT'
        });

    } catch (error) {
        console.error("Error in get-overview:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});

router.get('/performance-overview', jwtAuth, async (req: JWTRequest, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const parseTimeframe = (tf?: string) => {
            const now = new Date();
            const endUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999);
            const end = new Date(endUTC);
            const map: Record<string, number> = { '7D': 7, '14D': 14, '30D': 30, '60D': 60, '90D': 90, '1Y': 365, 'ALL': 36500 };
            const days = map[(tf || '7D').toUpperCase()] ?? 7;
            const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
            const startUTC = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 0, 0, 0, 0);
            return { start: new Date(startUTC), end };
        };
        const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const labelUTC = (d: number | Date) => {
            const x = typeof d === 'number' ? new Date(d) : d;
            return `${month[x.getUTCMonth()]} ${x.getUTCDate()}`;
        };

        const timeframe = String(req.query.timeframe || '7D').toUpperCase();
        const { start, end } = parseTimeframe(timeframe);

        const hooks = await Hook.find({ creator: userId }).lean();
        const uniq = new Map<string, any>();
        for (const h of hooks) {
            const key = `${h.coinExApiKey}::${h.coinExApiSecret}`;
            if (!uniq.has(key)) uniq.set(key, h);
        }
        const hookIds = Array.from(uniq.values()).map(h => h._id);

        const getClosedMs = (h: any) =>
            Number(h?.data?.close_time ?? h?.data?.created_at ?? (h?.updatedAt ? new Date(h.updatedAt).getTime() : NaN));
        const get = {
            market: (h: any) => h?.data?.market || '',
            side: (h: any) => (h?.data?.side || '').toString().toLowerCase(), // long|short
            entry: (h: any) => Number(h?.data?.avg_entry_price ?? NaN),
            exit: (h: any) => {
                const entry = Number(h?.data?.avg_entry_price);
                const pnl = Number(h?.data?.realized_pnl);
                const qty = Number(h?.data?.max_position_value);
                const side = String(h?.data?.side || '').toLowerCase();

                if ([entry, pnl, qty].every(Number.isFinite) && qty > 0) {
                    const delta = pnl / qty;
                    return side === 'short' ? entry - delta : entry + delta;
                }
                return NaN;
            },
            pnl: (h: any) => Number(h?.data?.realized_pnl ?? 0),
        };

        const finishedRange = await PositionHistory.find({
            hook: { $in: hookIds }, finished: true, updatedAt: { $gte: start, $lte: end }
        }).sort({ updatedAt: 1 }).lean();

        type DayBucket = { pnl: number; trade?: { id: string; market: string; side: 'long' | 'short'; pnl: number; entry: number; exit: number }; lastCloseMs?: number; };
        const daily: Record<string, DayBucket> = {};

        for (const h of finishedRange) {
            const closeMs = getClosedMs(h) || new Date(h.updatedAt).getTime();
            const label = labelUTC(closeMs);

            if (!daily[label]) daily[label] = { pnl: 0 };
            daily[label].pnl += get.pnl(h) || 0;

            if (!daily[label].lastCloseMs || closeMs >= (daily[label].lastCloseMs as number)) {
                daily[label].lastCloseMs = closeMs;
                daily[label].trade = {
                    id: String(h.data.position_id || h._id),
                    market: get.market(h),
                    side: get.side(h) === 'short' ? 'short' as const : 'long' as const,
                    pnl: get.pnl(h) || 0,
                    entry: Number.isFinite(get.entry(h)) ? Number(get.entry(h)) : 0,
                    exit: Number.isFinite(get.exit(h)) ? Number(get.exit(h)) : 0,
                };
            }
        }

        const DAY = 24 * 60 * 60 * 1000;
        const points: Array<{ date: string; value: number; trade: null | DayBucket['trade'] }> = [];
        let cumulative = 0;

        for (let t = start.getTime(); t <= end.getTime(); t += DAY) {
            const lbl = labelUTC(t);
            const b = daily[lbl];
            if (b) cumulative += b.pnl;
            points.push({ date: lbl, value: Number(cumulative.toFixed(6)), trade: b?.trade ?? null });
        }

        return res.status(200).json(points);
    } catch (err: any) {
        console.error('GET /performance-overview failed:', err?.message || err);
        return res.status(500).json({ error: 'Failed to build performance data.' });
    }
});

const get = {
    market: (h: any) => h?.data?.market || h?.symbol || '',
    side: (h: any) => (h?.data?.side || h?.positionState || '').toString().toLowerCase(),
    entry: (h: any) => Number(h?.data?.avg_entry_price ?? h?.data?.entry_price ?? h?.data?.open_avg_price ?? NaN),
    exit: (h: any) => {
        const entry = Number(h?.data?.avg_entry_price);
        const pnl = Number(h?.data?.realized_pnl);
        const qty = Number(h?.data?.max_position_value);
        const side = String(h?.data?.side || '').toLowerCase();

        if ([entry, pnl, qty].every(Number.isFinite) && qty > 0) {
            const delta = pnl / qty;
            return side === 'short' ? entry - delta : entry + delta;
        }
        return NaN;
    },
    amount: (h: any) => Number(h?.data?.ath_position_amount ?? h?.data?.close_avbl ?? h?.data?.amount ?? 0),
    realizedPnl: (h: any) => Number(h?.data?.realized_pnl ?? 0),
    leverage: (h: any) => Number(h?.data?.leverage ?? 0),
    unrealizedPnl: (h: any) => Number(h?.data?.unrealized_pnl ?? h?.data?.u_pnl ?? 0),
    marginRate: (h: any) => Number(h?.data?.margin_rate ?? h?.data?.marginRate ?? NaN),
    marginMode: (h: any) => h?.data?.margin_mode,
    currentPrice: (h: any) => Number(h?.data?.settle_price ?? h?.data?.mark_price ?? NaN),
    takeProfitPrice: (h: any) => Number(h?.data?.take_profit_price ?? NaN),
    stopLossPrice: (h: any) => Number(h?.data?.stop_loss_price ?? NaN),
    liqPrice: (h: any) => Number(h?.data?.liq_price ?? NaN),
    positionMargin: (h: any) => Number(h?.data?.position_margin_rate ?? NaN),
    closeMs: (h: any) => Number(h?.data?.updated_at) || (h?.updatedAt ? new Date(h.updatedAt).getTime() : NaN),
};

router.get('/recent-activity', jwtAuth, async (req: JWTRequest, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const hooks = await Hook.find({ creator: userId }).lean();
        const uniq = new Map<string, any>();
        for (const h of hooks) {
            const k = `${h.coinExApiKey}::${h.coinExApiSecret}`;
            if (!uniq.has(k)) uniq.set(k, h);
        }
        const hookIds = Array.from(uniq.values()).map(h => h._id);

        const positionsLimit = Math.min(parseInt(String(req.query.positionsLimit ?? '5'), 10) || 5, 50);
        const tradesLimit = Math.min(parseInt(String(req.query.tradesLimit ?? '10'), 10) || 10, 50);

        const [activePositions, closedPH] = await Promise.all([
            PositionHistory.find({ hook: { $in: hookIds }, finished: false })
                .sort({ updatedAt: -1 })
                .limit(positionsLimit)
                .lean(),
            PositionHistory.find({ hook: { $in: hookIds }, finished: true })
                .sort({ updatedAt: -1 })
                .limit(tradesLimit)
                .lean(),
        ]);

        const positionsAndOrders = activePositions.map((p: any) => ({
            type: 'position' as const,
            id: String(p._id),
            position_id: p.data.position_id || p._id,
            market: get.market(p),
            side: get.side(p),
            amount: get.amount(p),
            entryPrice: Number.isFinite(get.entry(p)) ? get.entry(p) : 0,
            currentPrice: Number.isFinite(get.currentPrice(p)) ? get.currentPrice(p) : 0,
            unrealizedPnl: Number.isFinite(get.unrealizedPnl(p)) ? get.unrealizedPnl(p) : 0,
            marginRate: Number.isFinite(get.marginRate(p)) ? get.marginRate(p) : 0,
            leverage: Number.isFinite(get.leverage(p)) ? get.leverage(p) : 0,
        }));

        const trades = closedPH.map((h: any) => {
            const entry = Number.isFinite(get.entry(h)) ? get.entry(h) : 0;
            const exit = Number.isFinite(get.exit(h)) ? get.exit(h) : 0;
            const amount = get.amount(h);
            const pnl = get.realizedPnl(h);
            const invested = entry > 0 && amount > 0 ? entry * amount : 0;
            const roi = invested > 0 ? (pnl / invested) * 100 : 0;

            const closeTimeMs = get.closeMs(h);
            const d = Number.isFinite(closeTimeMs) ? new Date(closeTimeMs) : new Date();

            return {
                id: String(h.position_id || h._id),
                market: get.market(h),
                side: get.side(h) === 'short' ? 'short' : 'long',
                pnl,
                entryPrice: entry,
                exitPrice: exit,
                amount,
                roi,
                date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                closingTime: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            };
        });

        await User.findByIdAndUpdate(userId, { $set: { updatedAt: new Date() } }, { new: true });

        return res.status(200).json({ positionsAndOrders, trades });
    } catch (err) {
        console.error('GET /recent-activity failed:', err);
        return res.status(500).json({ error: 'Failed to fetch recent activity.' });
    }
});

router.get('/current-position', jwtAuth, async (req: JWTRequest, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const hooks = await Hook.find({ creator: userId }).lean();
        const uniq = new Map<string, any>();
        for (const h of hooks) {
            const k = `${h.coinExApiKey}::${h.coinExApiSecret}`;
            if (!uniq.has(k)) uniq.set(k, h);
        }
        const hookIds = Array.from(uniq.values()).map(h => h._id);


        const activePositions = await PositionHistory.find({ hook: { $in: hookIds }, finished: false })
            .sort({ updatedAt: -1 })
            .lean();

        const positions = activePositions.map((p: any) => ({
            type: 'position' as const,
            id: String(p._id),
            position_id: p.data.position_id || p._id,
            market: get.market(p),
            side: get.side(p),
            amount: get.amount(p),
            entryPrice: Number.isFinite(get.entry(p)) ? get.entry(p) : 0,
            currentPrice: Number.isFinite(get.exit(p)) ? get.exit(p) : 0,
            unrealizedPnl: Number.isFinite(get.unrealizedPnl(p)) ? get.unrealizedPnl(p) : 0,
            marginRate: Number.isFinite(get.marginRate(p)) ? get.marginRate(p) : 0,
            marginMode: get.marginMode(p) ?? '',
            leverage: Number.isFinite(get.leverage(p)) ? get.leverage(p) : 0,
            liqPrice: Number.isFinite(get.liqPrice(p)) ? get.liqPrice(p) : 0,
            positionMargin: Number.isFinite(get.positionMargin(p)) ? get.positionMargin(p) : 0,
            takeProfitPrice: Number.isFinite(get.takeProfitPrice(p)) ? get.takeProfitPrice(p) : 0,
            stopLossPrice: Number.isFinite(get.stopLossPrice(p)) ? get.stopLossPrice(p) : 0,
        }));

        await User.findByIdAndUpdate(userId, { $set: { updatedAt: new Date() } }, { new: true });

        return res.status(200).json(positions);
    } catch (err) {
        console.error('GET /recent-activity failed:', err);
        return res.status(500).json({ error: 'Failed to fetch recent activity.' });
    }
});

router.get('/history', jwtAuth, async (req: JWTRequest, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
        const pageSize = Math.min(parseInt(String(req.query.pageSize ?? '25'), 10) || 25, 100);

        const hooks = await Hook.find({ creator: userId }).lean();
        const uniq = new Map<string, any>();
        for (const h of hooks) {
            const k = `${h.coinExApiKey}::${h.coinExApiSecret}`;
            if (!uniq.has(k)) uniq.set(k, h);
        }
        const hookIds = Array.from(uniq.values()).map(h => h._id);

        const filter = { hook: { $in: hookIds }, finished: true };

        const [total, rows] = await Promise.all([
            PositionHistory.countDocuments(filter),
            PositionHistory.find(filter)
                .sort({ 'data.updated_at': -1, updatedAt: -1 })
                .skip((page - 1) * pageSize)
                .limit(pageSize)
                .lean(),
        ]);

        const items = rows.map((h: any) => {
            const entry = Number.isFinite(get.entry(h)) ? get.entry(h) : 0;
            const exit = Number.isFinite(get.exit(h)) ? get.exit(h) : 0;
            const amount = Number.isFinite(get.amount(h)) ? get.amount(h) : 0;
            const pnl = Number.isFinite(get.realizedPnl(h)) ? get.realizedPnl(h) : 0;
            const lev = Number.isFinite(get.leverage(h)) ? get.leverage(h) : 0;

            const invested = entry > 0 && amount > 0 ? entry * amount : 0;
            const roi = invested > 0 ? (pnl / invested) * 100 : 0;

            const closeMs = Number.isFinite(get.closeMs(h)) ? (get.closeMs(h) as number) : (h?.updatedAt ? new Date(h.updatedAt).getTime() : Date.now());
            const d = new Date(closeMs);

            return {
                id: String(h.position_id || h._id),
                market: get.market(h),
                side: get.side(h) === 'short' ? 'short' : 'long',
                amount,
                entryPrice: entry,
                exitPrice: exit,
                leverage: lev,
                pnl,
                roi,
                date: d,
                position_id: h.data.position_id ?? h._id,
            };
        });

        const totalPages = Math.max(1, Math.ceil(total / pageSize));

        await User.findByIdAndUpdate(userId, { $set: { updatedAt: new Date() } }, { new: true });

        return res.status(200).json({
            items,
            page,
            pageSize,
            total,
            totalPages,
            hasPrev: page > 1,
            hasNext: page < totalPages,
        });
    } catch (err) {
        console.error('GET /history failed:', err);
        return res.status(500).json({ error: 'Failed to fetch history.' });
    }
});

router.get('/analytics', jwtAuth, async (req: JWTRequest, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const positionsLimit = Math.min(parseInt(String(req.query.positionsLimit ?? '10'), 10) || 10, 50);
        const tradesLimit = Math.min(parseInt(String(req.query.tradesLimit ?? '100'), 10) || 100, 500);
        const lookback = Math.min(parseInt(String(req.query.lookback ?? '20'), 10) || 20, tradesLimit);

        const hooks = await Hook.find({ creator: userId }).lean();
        const uniq = new Map<string, any>();
        for (const h of hooks) {
            const k = `${h.coinExApiKey}::${h.coinExApiSecret}`;
            if (!uniq.has(k)) uniq.set(k, h);
        }
        const hookIds = Array.from(uniq.values()).map(h => h._id);

        const [activePositions, closedPH] = await Promise.all([
            PositionHistory.find({ hook: { $in: hookIds }, finished: false })
                .sort({ updatedAt: -1 })
                .limit(positionsLimit)
                .lean(),
            PositionHistory.find({ hook: { $in: hookIds }, finished: true })
                .sort({ 'data.close_time': -1, updatedAt: -1 })
                .limit(tradesLimit)
                .lean(),
        ]);

        const positions = activePositions.map((p: any) => ({
            type: 'position' as const,
            id: String(p._id),
            position_id: p?.data?.position_id || p._id,
            market: get.market(p),
            side: get.side(p),
            amount: Number.isFinite(get.amount(p)) ? get.amount(p) : 0,
            entryPrice: Number.isFinite(get.entry(p)) ? get.entry(p) : 0,
            currentPrice: Number.isFinite(get.currentPrice(p)) ? get.currentPrice(p) : 0,
            unrealizedPnl: Number.isFinite(get.unrealizedPnl(p)) ? get.unrealizedPnl(p) : 0,
            marginRate: Number.isFinite(get.marginRate(p)) ? get.marginRate(p) : 0,
            leverage: Number.isFinite(get.leverage(p)) ? get.leverage(p) : 0,
            liqPrice: Number.isFinite(get.liqPrice(p)) ? get.liqPrice(p) : 0,
            positionMargin: Number.isFinite(get.positionMargin(p)) ? get.positionMargin(p) : 0,
        }));

        const trades = closedPH.map((h: any) => {
            const entry = Number.isFinite(get.entry(h)) ? get.entry(h) : 0;
            const exit = Number.isFinite(get.exit(h)) ? get.exit(h) : 0;
            const amount = Number.isFinite(get.amount(h)) ? get.amount(h) : 0;
            const pnl = Number.isFinite(get.realizedPnl(h)) ? get.realizedPnl(h) : 0;

            const invested = entry > 0 && amount > 0 ? entry * amount : 0;
            const roi = invested > 0 ? (pnl / invested) * 100 : 0;

            const closeMs = Number.isFinite(get.closeMs(h))
                ? (get.closeMs(h) as number)
                : (h?.updatedAt ? new Date(h.updatedAt).getTime() : Date.now());
            const d = new Date(closeMs);

            return {
                id: String(h.position_id || h._id),
                market: get.market(h),
                side: get.side(h) === 'short' ? 'short' : 'long',
                pnl,
                entryPrice: entry,
                exitPrice: exit,
                amount,
                roi,
                date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                closingTime: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
                closedAtMs: closeMs,
            };
        });

        const sample = trades.slice(0, lookback);
        const totalTrades = sample.length;
        const winningTrades = sample.filter(t => t.pnl > 0).length;
        const losingTrades = totalTrades - winningTrades;
        const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
        const grossProfit = sample.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
        const grossLossAbs = Math.abs(sample.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
        const profitFactor = grossLossAbs === 0 ? (grossProfit > 0 ? 999 : 1) : grossProfit / grossLossAbs;

        const classify = (wr: number, pf: number) => {
            if (wr >= 65 && pf >= 1.8) return 'Strong Bull';
            if (wr >= 55 && pf >= 1.3) return 'Bull';
            if (wr <= 35 || pf < 0.7) return 'Strong Bear';
            if (wr < 45 || pf < 0.9) return 'Bear';
            return 'Neutral';
        };

        const sentiment = classify(winRate, profitFactor);
        const styleMap: Record<string, { icon: string; color: string; bg: string }> = {
            'Strong Bull': { icon: '🚀', color: 'text-green-600', bg: 'bg-green-50' },
            'Bull': { icon: '📈', color: 'text-green-600', bg: 'bg-green-50' },
            'Neutral': { icon: '⚖️', color: 'text-gray-700', bg: 'bg-gray-50' },
            'Bear': { icon: '⚠️', color: 'text-red-600', bg: 'bg-red-50' },
            'Strong Bear': { icon: '🚨', color: 'text-red-700', bg: 'bg-red-50' },
        };
        const styles = styleMap[sentiment];

        const marketSentiment = {
            sentiment,
            sentimentIcon: styles.icon,
            sentimentColor: styles.color,
            sentimentBg: styles.bg,
            winRate: Number(winRate.toFixed(1)),
            profitFactor: Number((profitFactor === 999 ? 3.0 : profitFactor).toFixed(2)),
            totalTrades,
            winningTrades,
            losingTrades,
        };

        const now = Date.now();
        const windows = [
            { period: '30M', ms: 30 * 60 * 1000 },
            { period: '1H', ms: 60 * 60 * 1000 },
            { period: '4H', ms: 4 * 60 * 60 * 1000 },
            { period: '1D', ms: 24 * 60 * 60 * 1000 },
        ];

        const clamp01 = (x: number) => Math.max(0, Math.min(100, x));
        const toSentiment = (pct: number) => (pct >= 60 ? 'Bullish' : pct <= 40 ? 'Bearish' : 'Neutral');

        const outlook = windows.map(w => {
            const since = now - w.ms;
            const windowSample = trades.filter(
                t => Number.isFinite(t.closedAtMs) && (t.closedAtMs as number) >= since
            );
            const sampleForWindow = windowSample.length ? windowSample : trades;

            if (!sampleForWindow.length) {
                return { period: w.period, percentage: 50, sentiment: 'Neutral' };
            }

            const wins = sampleForWindow.filter(t => Number(t.pnl) > 0).length;
            const winRatePct = (wins / sampleForWindow.length) * 100;
            const percentage = Math.round(clamp01(winRatePct));
            return { period: w.period, percentage, sentiment: toSentiment(percentage) };
        });

        await User.findByIdAndUpdate(userId, { $set: { updatedAt: new Date() } }, { new: true });

        return res.status(200).json({ positions, trades, marketSentiment, outlook });
    } catch (err) {
        console.error('GET /analytics failed:', err);
        return res.status(500).json({ error: 'Failed to fetch analytics.' });
    }
});

async function findUserPosition(userId: string, posId: string) {
    const hooks = await Hook.find({ creator: userId }).lean();
    const uniq = new Map<string, any>();
    for (const h of hooks) uniq.set(`${h.coinExApiKey}::${h.coinExApiSecret}`, h);
    const hookIds = Array.from(uniq.values()).map(h => h._id);

    const position = await PositionHistory.findOne({
        hook: { $in: hookIds },
        finished: false,
        $or: [{ _id: posId }, { 'data.position_id': posId }],
    }).lean();

    if (!position) return { position: null, hook: null };

    const hook = hooks.find(h => String(h._id) === String(position.hook));
    return { position, hook };
}

router.post('/positions/:id/tp', jwtAuth, async (req: JWTRequest, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const { id } = req.params;
        const { takeProfitPrice, takeProfitType } = req.body || {};

        if (!takeProfitPrice) return res.status(400).json({ error: 'takeProfitPrice is required' });

        const { position, hook } = await findUserPosition(userId, id);
        if (!position) return res.status(404).json({ error: 'Position not found' });
        if (!hook?.coinExApiKey || !hook?.coinExApiSecret) return res.status(400).json({ error: 'API key missing' });

        const market = position?.data?.market;
        const result = await handleSetTP(
            String(takeProfitPrice),
            takeProfitType,
            market,
            hook.coinExApiKey,
            hook.coinExApiSecret
        );

        return res.status(result.success ? 200 : 400).json(result);
    } catch (err: any) {
        console.error('POST /positions/:id/tp failed:', err?.message || err);
        return res.status(500).json({ error: 'Failed to set TP' });
    }
});

router.post('/positions/:id/sl', jwtAuth, async (req: JWTRequest, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const { id } = req.params;
        const { stopLossPrice, stopLossType } = req.body || {}; // stopLossType optional

        if (!stopLossPrice) return res.status(400).json({ error: 'stopLossPrice is required' });

        const { position, hook } = await findUserPosition(userId, id);
        if (!position) return res.status(404).json({ error: 'Position not found' });
        if (!hook?.coinExApiKey || !hook?.coinExApiSecret) return res.status(400).json({ error: 'API key missing' });

        const market = position?.data?.market;
        const result = await handleSetSL(
            String(stopLossPrice),
            stopLossType,
            market,
            hook.coinExApiKey,
            hook.coinExApiSecret
        );

        return res.status(result.success ? 200 : 400).json(result);
    } catch (err: any) {
        console.error('POST /positions/:id/sl failed:', err?.message || err);
        return res.status(500).json({ error: 'Failed to set SL' });
    }
});

router.post('/positions/:id/leverage', jwtAuth, async (req: JWTRequest, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const { id } = req.params;
        const { leverage, marginMode } = req.body || {};
        const levNum = Number(leverage);

        if (!Number.isFinite(levNum) || levNum <= 0) return res.status(400).json({ error: 'Invalid leverage' });

        const { position, hook } = await findUserPosition(userId, id);
        if (!position) return res.status(404).json({ error: 'Position not found' });
        if (!hook?.coinExApiKey || !hook?.coinExApiSecret) return res.status(400).json({ error: 'API key missing' });

        const market = position?.data?.market;
        const mode: 'cross' | 'isolated' =
            (marginMode as any) ||
            (String(position?.data?.margin_mode || 'cross').toLowerCase() as 'cross' | 'isolated');

        const result = await handleAdjustLeverage(
            levNum,
            mode,
            market,
            hook.coinExApiKey,
            hook.coinExApiSecret
        );

        return res.status(result.success ? 200 : 400).json(result);
    } catch (err: any) {
        console.error('POST /positions/:id/leverage failed:', err?.message || err);
        return res.status(500).json({ error: 'Failed to adjust leverage' });
    }
});

router.post('/position/close', jwtAuth, async (req: JWTRequest, res) => {
    try {
        const userId = req.user?.userId!;
        const { symbol, orderType, amount, price, id } = req.body || {};
        if (!symbol || !orderType) return res.status(400).json({ error: 'symbol and orderType required' });
        if (orderType === 'limit' && (price === undefined || price === null || price === '')) {
            return res.status(400).json({ error: 'price required for limit close' });
        }
        const { position, hook } = await findUserPosition(userId, id);
        if (!position) return res.status(404).json({ error: 'Position not found' });
        if (!hook?.coinExApiKey || !hook?.coinExApiSecret) return res.status(400).json({ error: 'API key missing' });

        const r = await handleClosePosition(
            { symbol: String(symbol), orderType, amount, price },
            hook.coinExApiKey,
            hook.coinExApiSecret
        );
        return res.status(r.success ? 200 : 400).json(r);
    } catch (e) {
        console.error('POST /position/close failed:', e);
        return res.status(500).json({ error: 'Failed to close position' });
    }
});

export default router;