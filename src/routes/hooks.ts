import express from 'express';
import { jwtAuth } from '../middleware/authorization';
import { JWTRequest } from '../types/JWTRequest';
import Hook from '../models/Hook';
import User from '../models/User';
import { v4 as uuidv4 } from 'uuid';
import AdminHook from '../models/AdminHook';
import History from '../models/History';
import siteMaintenanceMiddleware from '../middleware/siteMaintainance';
import PositionHistory from '../models/PositionHistory';
import PremiumHook from '../models/PremiumHook';
import { Types } from 'mongoose';

const router = express.Router();

/** ---------- Helpers ---------- */
const asNumber = (v: any, fallback?: number) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return Number.isFinite(n) ? (n as number) : (fallback as number | undefined);
};

const clamp = (n: number | undefined, min: number, max: number, fallback: number) => {
    if (!Number.isFinite(n as number)) return fallback;
    return Math.max(min, Math.min(max, n as number));
};

const mapTradeDirection = (dir?: string) => {
    const s = String(dir ?? 'BOTH').toUpperCase();
    if (s === 'BOTH') return 'BOTH';
    if (s === 'LONG' || s === 'LONG_ONLY') return 'LONG_ONLY';
    if (s === 'SHORT' || s === 'SHORT_ONLY') return 'SHORT_ONLY';
    return 'BOTH';
};

const sanitizeSettings = (body: any) => {
    const trailing = body.trailingConfig || {};
    const defaultLeverage = clamp(asNumber(body.defaultLeverage, 2), 1, 100, 2);
    const defaultPositionType = [1, 2].includes(asNumber(body.defaultPositionType, 1)!)
        ? (asNumber(body.defaultPositionType, 1) as 1 | 2)
        : 1;

    return {
        // New UI fields
        defaultLeverage,
        defaultPositionType,
        autoApplySettings: Boolean(body.autoApplySettings ?? true),
        enableAutoTrailing: Boolean(body.enableAutoTrailing ?? false),
        trailingConfig: {
            minProfitThreshold: asNumber(trailing.minProfitThreshold, 2.0),
            trailDistance: asNumber(trailing.trailDistance, 1.5),
            trailType: trailing.trailType || 'percentage',
        },
    };
};

/** ---------- Routes ---------- */

// Get user hooks (non-admin)
router.get('/', jwtAuth, siteMaintenanceMiddleware, async (req: JWTRequest, res) => {
    try {
        const userId = req.user?.userId;
        const hooks = await Hook.find({ creator: userId, adminHook: null });

        const hooksWithHistories = await Promise.all(
            hooks.map(async (hook) => {
                const histories = await History.find({ hook: hook._id })
                    .sort({ createdAt: -1 })
                    .limit(10);
                return {
                    ...hook.toObject(),
                    histories,
                };
            })
        );

        return res.status(200).json(hooksWithHistories);
    } catch (error) {
        console.error('Error during getting hooks:', error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Create hook
router.post('/create', jwtAuth, siteMaintenanceMiddleware, async (req: JWTRequest, res) => {
    const {
        coinExApiKey,
        coinExApiSecret,
        name,
        tradeDirection,
        unit,
        takeProfitPrice,
        stopLossPrice,
        isUsingAdminHook,
    } = req.body;

    try {
        const userId = req.user?.userId;
        const user = await User.findById(userId);
        if (!user) return res.status(400).json({ message: 'User not found' });

        const isSubscribed =
            (user.subscribed === 2 &&
                user.subscribeEndDate &&
                new Date(user.subscribeEndDate).getTime() > Date.now()) ||
            user.isAdmin;

        const existing = await Hook.find({ creator: userId });
        if (!isSubscribed && existing.length >= 1) {
            return res
                .status(403)
                .json({ message: 'You hit the limit of hooks. Please upgrade your subscription.' });
        }

        if (isUsingAdminHook && !isSubscribed) {
            return res.status(403).json({ message: 'You are not allowed this action' });
        }

        // Validate admin hook if used
        if (isUsingAdminHook) {
            const existingHook = await AdminHook.findById(req.body.adminHook);
            if (!existingHook) return res.status(404).json({ message: 'Hook not found' });
        }

        // Build base payload
        const amount = asNumber(req.body.amount ?? req.body.tradeAmount, 0) || 0;

        const payload: any = {
            name,
            creator: userId,
            coinExApiKey,
            coinExApiSecret,
            tradeDirection: mapTradeDirection(tradeDirection),
            unit,
            takeProfitPrice,
            stopLossPrice,
            isSubscribed,
            amount,
            ...sanitizeSettings(req.body),
        };

        // URL vs adminHook mode
        if (isUsingAdminHook) {
            payload.adminHook = req.body.adminHook ? new Types.ObjectId(req.body.adminHook) : undefined;
            payload.url = undefined;
        } else {
            payload.adminHook = undefined;
            // For subscribed users, you can auto-generate if not provided
            payload.url = isSubscribed ? req.body.url || uuidv4() : req.body.url;
        }

        await User.findByIdAndUpdate(userId, { $set: { updatedAt: new Date() } }, { new: true });

        const newHook = await Hook.create(payload);
        await newHook.populate('adminHook');

        return res.status(200).json({
            message: 'Create new hook successful',
            hook: newHook,
        });
    } catch (error) {
        console.error('Error during creating hook:', error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Update hook
router.put('/update/:id', jwtAuth, siteMaintenanceMiddleware, async (req: JWTRequest, res) => {
    const {
        coinExApiKey,
        coinExApiSecret,
        name,
        status,
        tradeDirection,
        unit,
        isUsingAdminHook,
    } = req.body;
    const { id } = req.params;

    try {
        const userId = req.user?.userId;
        const user = await User.findById(userId);
        if (!user) return res.status(400).json({ message: 'User not found' });

        const isSubscribed =
            (user.subscribed === 2 &&
                user.subscribeEndDate &&
                new Date(user.subscribeEndDate).getTime() > Date.now()) ||
            user.isAdmin;

        if (isUsingAdminHook && !isSubscribed) {
            return res.status(403).json({ message: 'You are not allowed this action' });
        }

        const existingHook = await Hook.findById(id);
        if (!existingHook) return res.status(404).json({ message: 'Hook not found' });

        // Base fields
        const updatePayload: any = {
            coinExApiKey,
            coinExApiSecret,
            name,
            tradeDirection: mapTradeDirection(tradeDirection ?? existingHook.tradeDirection),
            unit,
            status,
            ...sanitizeSettings(req.body),
        };

        // URL vs adminHook mode
        if (!isUsingAdminHook) {
            // personal webhook mode
            updatePayload.adminHook = undefined;
            updatePayload.amount = asNumber(req.body.amount ?? req.body.tradeAmount, existingHook.amount || 0);
            updatePayload.url = isSubscribed ? req.body.url || existingHook.url || uuidv4() : req.body.url;
            updatePayload.$unset = { adminHook: '' };
        } else {
            // admin strategy mode
            if (!req.body.adminHook) {
                return res
                    .status(400)
                    .json({ message: 'Admin hook must be provided when using adminHook.' });
            }
            const existingAdminHook = await AdminHook.findById(req.body.adminHook);
            if (!existingAdminHook) {
                return res.status(404).json({ message: 'Hook not found' });
            }

            updatePayload.adminHook = new Types.ObjectId(req.body.adminHook);
            updatePayload.amount =
                asNumber(req.body.amount ?? req.body.tradeAmount, existingHook.amount || 0) || 0;
            updatePayload.$unset = { url: '' };
            updatePayload.url = undefined;
        }

        await User.findByIdAndUpdate(userId, { $set: { updatedAt: new Date() } }, { new: true });

        const updatedHook = await Hook.findByIdAndUpdate(id, updatePayload, {
            new: true,
        }).populate('adminHook');

        return res.status(200).json({
            message: 'Update hook successful',
            hook: updatedHook,
        });
    } catch (error) {
        console.error('Error during updating hook: ', error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete hook
router.delete('/:id', jwtAuth, siteMaintenanceMiddleware, async (req: JWTRequest, res) => {
    const id = req.params.id;
    const userId = req.user?.userId;

    try {
        await Hook.findByIdAndDelete(id);
        await History.deleteMany({ hook: id });
        await PositionHistory.deleteMany({ hook: id });
        await User.findByIdAndUpdate(userId, { $set: { updatedAt: new Date() } }, { new: true });

        return res.status(200).json({ message: 'Delete successful' });
    } catch (error) {
        console.error('Error during deleting hook: ', error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Admin hooks + stats for premium page
router.get('/admin-hooks', jwtAuth, siteMaintenanceMiddleware, async (req: JWTRequest, res) => {
    try {
        const user = await User.findById(req.user?.userId);
        const enabled = req.query.enabled === 'true';

        if (!user) return res.status(400).json({ message: 'User not found' });

        const hooks = await PremiumHook.find()
            .populate({
                path: 'pairs',
                select: `${enabled ? '-url' : '-__v'}`,
                match: enabled ? { enabled: true } : {},
            })
            .select('-__v');

        const adminHookswithHook = await Promise.all(
            hooks.map(async (premium) => {
                const perAdminStats = await Promise.all(
                    premium.pairs.map(async (hook) => {
                        try {
                            const userHook = await Hook.findOne({ adminHook: hook._id, creator: user._id });

                            const dependingHooks = await Hook.find({ adminHook: hook._id });
                            const userHistories = await PositionHistory.find({ hook: userHook?._id });

                            let userTotalPnl = 0,
                                userTotalInvest = 0,
                                userTotalWins = 0,
                                totalTrades = userHistories.length;

                            const now = Date.now();
                            const last24hStart = now - 24 * 60 * 60 * 1000;
                            const last7dStart = now - 7 * 24 * 60 * 60 * 1000;

                            if (totalTrades > 0) {
                                userHistories.forEach((history) => {
                                    if (history.data?.realized_pnl) {
                                        const pnl = parseFloat(history.data.realized_pnl);
                                        if (pnl >= 0) userTotalWins++;
                                        userTotalPnl += pnl;
                                        userTotalInvest +=
                                            Number(history.data.avg_entry_price) *
                                            Number(history.data.ath_position_amount);
                                    }
                                });
                            }

                            const pnlPercent = (userTotalPnl / (userTotalInvest || 1)) * 100;
                            const userWinRate = totalTrades > 0 ? (userTotalWins / totalTrades) * 100 : 0;

                            const personalStats = {
                                invested: userHook?.balance?.inPosition || 0,
                                currentValue: userHook?.balance?.total || 0,
                                pnl: userTotalPnl,
                                pnlPercent,
                                trades: totalTrades,
                                winRate: userWinRate,
                            };

                            // 7d chart
                            const userHistories7d = await PositionHistory.find({
                                hook: userHook?._id,
                                'data.created_at': {
                                    $gt: last7dStart,
                                    $lt: now,
                                },
                            });

                            const dailyPnl: Record<string, number> = {};
                            const dailyInvest: Record<string, number> = {};

                            userHistories7d.forEach((history) => {
                                if (history.data?.realized_pnl) {
                                    const dateKey = new Date(parseInt(history.data.created_at)).toISOString().split('T')[0];
                                    const pnl = parseFloat(history.data.realized_pnl);
                                    dailyPnl[dateKey] = (dailyPnl[dateKey] || 0) + pnl;
                                    dailyInvest[dateKey] =
                                        (dailyInvest[dateKey] || 0) +
                                        Number(history.data.avg_entry_price) * Number(history.data.ath_position_amount);
                                }
                            });

                            const labels: string[] = [];
                            const values: number[] = [];
                            for (let i = 6; i >= 0; i--) {
                                const date = new Date(now - i * 24 * 60 * 60 * 1000);
                                const dateKey = date.toISOString().split('T')[0];
                                labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
                                const pnl = dailyPnl[dateKey] || 0;
                                const invest = dailyInvest[dateKey] || 1;
                                values.push(parseFloat(((pnl / invest) * 100).toFixed(2)));
                            }

                            const performanceData = { labels, values };

                            const communityStats = {
                                activeUsers: dependingHooks.filter((h) => !h.status).length,
                                totalUsers: dependingHooks.length,
                                last24h: { trades: 0, winRate: 0, pnl: 0 },
                                last7d: { trades: 0, winRate: 0, pnl: 0 },
                                total: { trades: 0 },
                            };

                            const hookIds = dependingHooks.map((h) => h._id);

                            const [histories, total24Histories, total7dHistories, last24Trades, last7dTrades, recentTrades] =
                                await Promise.all([
                                    PositionHistory.find({ hook: { $in: hookIds } }),
                                    PositionHistory.find({
                                        hook: { $in: hookIds },
                                        'data.created_at': { $gt: last24hStart, $lt: now },
                                    }),
                                    PositionHistory.find({
                                        hook: { $in: hookIds },
                                        'data.created_at': { $gt: last7dStart, $lt: now },
                                    }),
                                    History.countDocuments({
                                        hook: { $in: hookIds },
                                        'data.created_at': { $gt: last24hStart, $lt: now },
                                    }),
                                    History.countDocuments({
                                        hook: { $in: hookIds },
                                        'data.created_at': { $gt: last7dStart, $lt: now },
                                    }),
                                    History.find({
                                        hook: userHook?._id,
                                        'data.code': 0,
                                    })
                                        .sort({ createdAt: -1 })
                                        .limit(5),
                                ]);

                            let totalPnl = 0,
                                totalWins = 0;
                            histories.forEach((history) => {
                                if (history.data?.realized_pnl) {
                                    const pnl = parseFloat(history.data.realized_pnl);
                                    if (pnl >= 0) totalWins++;
                                    totalPnl += pnl;
                                }
                            });

                            const winRate = histories.length ? (totalWins / histories.length) * 100 : 0;
                            const avgPnl = histories.length ? totalPnl / histories.length : 0;

                            let total24Wins = 0,
                                total24Pnl = 0;
                            total24Histories.forEach((history) => {
                                if (history.data?.realized_pnl) {
                                    const pnl = parseFloat(history.data.realized_pnl);
                                    if (pnl >= 0) total24Wins++;
                                    total24Pnl += pnl;
                                }
                            });
                            const winRate24h = total24Histories.length ? (total24Wins / total24Histories.length) * 100 : 0;

                            let total7dWins = 0,
                                total7dPnl = 0;
                            total7dHistories.forEach((history) => {
                                if (history.data?.realized_pnl) {
                                    const pnl = parseFloat(history.data.realized_pnl);
                                    if (pnl >= 0) total7dWins++;
                                    total7dPnl += pnl;
                                }
                            });
                            const winRate7d = total7dHistories.length ? (total7dWins / total7dHistories.length) * 100 : 0;

                            communityStats.last24h = { trades: last24Trades, pnl: total24Pnl, winRate: winRate24h };
                            communityStats.last7d = { trades: last7dTrades, pnl: total7dPnl, winRate: winRate7d };
                            communityStats.total = { trades: histories.length };

                            return {
                                ...hook.toObject(),
                                apiConfigured: Boolean(userHook),
                                hook: userHook,
                                winRate,
                                avgPnl,
                                signals: dependingHooks.length,
                                personalStats,
                                communityStats,
                                recentTrades,
                                performanceData,
                            };
                        } catch (error) {
                            console.error('Error processing hook:', hook._id, error);
                            return { ...hook.toObject() };
                        }
                    })
                );

                return {
                    ...premium.toObject(),
                    pairs: perAdminStats,
                };
            })
        );

        const userId = req.user?.userId;
        await User.findByIdAndUpdate(userId, { $set: { updatedAt: new Date() } }, { new: true });

        return res.status(200).json(adminHookswithHook);
    } catch (error) {
        console.error('Error during getting hooks:', error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;
