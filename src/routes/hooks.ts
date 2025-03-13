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

const router = express.Router();

router.get('/', jwtAuth, siteMaintenanceMiddleware, async (req: JWTRequest, res) => {
    try {
        const userId = req.user?.userId;
        const hooks = await Hook.find({ creator: userId, adminHook: null });
        const hooksWithHistories = await Promise.all(hooks.map(async (hook) => {
            const histories = await History.find({ hook: hook._id })
                .sort({ createdAt: -1 })
                .limit(10);
            return {
                ...hook.toObject(),
                histories,
            };
        }));
        return res.status(200).json(hooksWithHistories);
    } catch (error) {
        console.error("Error during getting hooks:", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/create', jwtAuth, siteMaintenanceMiddleware, async (req: JWTRequest, res) => {
    const { coinExApiKey, coinExApiSecret, name, tradeDirection, isUsingAdminHook } = req.body;

    try {
        const userId = req.user?.userId;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(400).json({ message: 'User not found' });
        }

        const isSubscribed =
            user.subscribed === 1 &&
            user.subscribeEndDate &&
            new Date(user.subscribeEndDate).getTime() > Date.now();

        const hooks = await Hook.find({ creator: userId });

        if (!isSubscribed && hooks.length >= 1) {
            return res.status(403).json({ message: "You hit the limit of hooks. Please upgrade your subscription." });
        }

        if (isUsingAdminHook && !isSubscribed) {
            return res.status(403).json({ message: 'You are not allowed this action' });
        }

        const url = !isUsingAdminHook && isSubscribed ? uuidv4() : req.body.url;

        if (isUsingAdminHook) {
            const existingHook = await AdminHook.findById(req.body.adminHook);
            if (!existingHook) {
                return res.status(404).json({ message: 'Hook not found' });
            }
        }

        const newHook = new Hook({
            name,
            creator: userId,
            url: isUsingAdminHook ? undefined : url,
            adminHook: isUsingAdminHook ? req.body.adminHook : undefined,
            coinExApiKey,
            coinExApiSecret,
            tradeDirection,
            isSubscribed,
            amount: req.body.amount || 0
        });

        await User.findByIdAndUpdate(
            userId,
            { $set: { updatedAt: new Date() } },
            { new: true }
        );

        (await newHook.save()).populate('adminHook');

        return res.status(200).json({
            message: 'Create new hook successful',
            hook: newHook,
        });
    } catch (error) {
        console.error('Error during creating hook:', error);
        return res.status(500).json({ message: 'Server error' });
    }
});


router.put('/update/:id', jwtAuth, siteMaintenanceMiddleware, async (req: JWTRequest, res) => {
    const { coinExApiKey, coinExApiSecret, name, status, tradeDirection, isUsingAdminHook } = req.body;
    const { id } = req.params;

    try {
        const userId = req.user?.userId;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(400).json({ message: 'User not found' });
        }

        const isSubscribed = user.subscribed === 1 && user.subscribeEndDate && new Date(user.subscribeEndDate).getTime() > Date.now();

        if (isUsingAdminHook && !isSubscribed) {
            return res.status(403).json({ message: 'You are not allowed this action' });
        }

        const updatePayload: any = {
            coinExApiKey,
            coinExApiSecret,
            name,
            tradeDirection,
            status,
        };

        if (!isUsingAdminHook) {
            if (isSubscribed) {
                updatePayload.url = req.body.url || uuidv4();
            } else {
                updatePayload.url = req.body.url;
            }
            updatePayload.$unset = { adminHook: '' };
        } else if (isUsingAdminHook) {
            if (!req.body.adminHook) {
                return res.status(400).json({ message: 'Admin hook must be provided when using adminHook.' });
            }
            const existingHook = await AdminHook.findById(req.body.adminHook);
            if (!existingHook) {
                return res.status(404).json({ message: 'Hook not found' });
            }
            updatePayload.adminHook = req.body.adminHook;
            updatePayload.amount = req.body.amount || 0;
            updatePayload.$unset = { url: '' };
        }

        await User.findByIdAndUpdate(
            userId,
            { $set: { updatedAt: new Date() } },
            { new: true }
        );

        const updatedHook = await Hook.findByIdAndUpdate(id, updatePayload, { new: true }).populate('adminHook');

        return res.status(200).json({
            message: 'Update hook successful',
            hook: updatedHook,
        });
    } catch (error) {
        console.error("Error during updating hook: ", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.delete('/:id', jwtAuth, siteMaintenanceMiddleware, async (req: JWTRequest, res) => {
    const id = req.params.id;
    const userId = req.user?.userId

    try {
        await Hook.findByIdAndDelete(id);
        await User.findByIdAndUpdate(
            userId,
            { $set: { updatedAt: new Date() } },
            { new: true }
        );
        return res.status(200).json({ message: 'Delete successful' });
    } catch (error) {
        console.error("Error during deleting hook: ", error);
        return res.status(500).json({ message: 'Server error' });
    }
})

router.get('/admin-hooks', jwtAuth, siteMaintenanceMiddleware, async (req: JWTRequest, res) => {
    try {
        const user = await User.findById(req.user?.userId);

        if (!user) return res.status(400).json({ message: 'User not found' });
        let hooks = null;
        if (user.isAdmin) {
            hooks = await AdminHook.find();
        }
        else {
            hooks = await AdminHook.find().select('-url');
        }

        const adminHookswithHook = await Promise.all(hooks.map(async hook => {
            try {
                const userHook = await Hook.findOne({ adminHook: hook._id, creator: user._id });

                const dependingHooks = await Hook.find({ adminHook: hook._id });

                const userHistories = await PositionHistory.find({
                    hook: userHook?._id
                });

                let userTotalPnl = 0, userTotalInvest = 0, userTotalWins = 0, totalTrades = userHistories.length;
                const now = Date.now();
                const last24hStart = now - 24 * 60 * 60 * 100;
                const last7dStart = now - 7 * 24 * 60 * 60 * 1000;

                if (totalTrades > 0) {
                    userHistories.forEach(history => {
                        if (history.data?.realized_pnl) {
                            const pnl = parseFloat(history.data.realized_pnl);
                            if (pnl >= 0) userTotalWins++;
                            userTotalPnl += pnl;
                            userTotalInvest += Number(history.data.avg_entry_price) * Number(history.data.ath_position_amount)
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
                    winRate: userWinRate
                };

                const userHistories7d = await PositionHistory.find({
                    hook: userHook?._id,
                    'data.created_at': { 
                        $gt: last7dStart, 
                        $lt: now
                    }
                });
                
                const dailyPnl: { [key: string]: number } = {}; 
                const dailyInvest: { [key: string]: number } = {}; 
                
                userHistories7d.forEach(history => {
                    if (history.data?.realized_pnl) {
                        const dateKey = new Date(parseInt(history.data.created_at)).toISOString().split('T')[0]; // Extract YYYY-MM-DD
                        const pnl = parseFloat(history.data.realized_pnl);
                        
                        if (!dailyPnl[dateKey]) {
                            dailyPnl[dateKey] = 0;
                        }

                        if (!dailyInvest[dateKey]) {
                            dailyInvest[dateKey] = 0;
                        }
                        
                        dailyPnl[dateKey] += pnl;
                        dailyInvest[dateKey] += Number(history.data.avg_entry_price) * Number(history.data.ath_position_amount);
                    }
                });
                
                const labels = [];
                const values = [];
                for (let i = 6; i >= 0; i--) {
                    const date = new Date(now - i * 24 * 60 * 60 * 1000);
                    const dateKey = date.toISOString().split('T')[0];
                
                    labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
                    
                    const pnl = dailyPnl[dateKey] || 0;
                    const initialInvestment = dailyInvest[dateKey] || 1;
                    const pnlPercent = (pnl / initialInvestment) * 100;
                
                    values.push(parseFloat(pnlPercent.toFixed(2)));
                }
                
                const performanceData = { labels, values };

                const communityStats = {
                    activeUsers: dependingHooks.filter(h => !h.status).length,
                    totalUsers: dependingHooks.length,
                    last24h: {
                        trades: 0,
                        winRate: 0,
                        pnl: 0,
                    },
                    last7d: {
                        trades: 0,
                        winRate: 0,
                        pnl: 0
                    }
                }

                const hookIds = dependingHooks.map(h => h._id);

                const [histories, total24Histories, total7dHistories, last24Trades, last7dTrades, recentTrades] = await Promise.all([
                    PositionHistory.find({ hook: { $in: hookIds } }),
                    PositionHistory.find({
                        hook: { $in: hookIds },
                        'data.created_at': { $gt: last24hStart, $lt: now }
                    }),
                    PositionHistory.find({
                        hook: { $in: hookIds },
                        'data.created_at': { $gt: last7dStart, $lt: now }
                    }),
                    History.countDocuments({
                        hook: { $in: hookIds },
                        'data.created_at': { $gt: last24hStart, $lt: now }
                    }),
                    History.countDocuments({
                        hook: { $in: hookIds },
                        'data.created_at': { $gt: last7dStart, $lt: now }
                    }),
                    History.find({
                        hook: { $in: hookIds },
                        'data.code': 0
                    }).sort({ createdAt: -1 }).limit(5)
                ]);

                let totalPnl = 0, totalWins = 0;
                if (histories.length > 0) {
                    histories.forEach(history => {
                        if (history.data?.realized_pnl) {
                            const pnl = parseFloat(history.data.realized_pnl);
                            if (pnl >= 0) totalWins++;
                            totalPnl += pnl;
                        }
                    });
                }

                const winRate = histories.length ? (totalWins / histories.length) * 100 : 0;
                const avgPnl = histories.length ? totalPnl / histories.length : 0;

                let total24Wins = 0, total24Pnl = 0;
                total24Histories.forEach(history => {
                    if (history.data?.realized_pnl) {
                        const pnl = parseFloat(history.data.realized_pnl);
                        if (pnl >= 0) total24Wins++;
                        total24Pnl += pnl;
                    }
                });
                const winRate24h = total24Histories.length ? (total24Wins / total24Histories.length) * 100 : 0;

                let total7dWins = 0, total7dPnl = 0;
                total7dHistories.forEach(history => {
                    if (history.data?.realized_pnl) {
                        const pnl = parseFloat(history.data.realized_pnl);
                        if (pnl >= 0) total7dWins++;
                        total7dPnl += pnl;
                    }
                });
                const winRate7d = total7dHistories.length ? (total7dWins / total7dHistories.length) * 100 : 0;

                communityStats.last24h = {
                    trades: last24Trades,
                    pnl: total24Pnl,
                    winRate: winRate24h
                };

                communityStats.last7d = {
                    trades: last7dTrades,
                    pnl: total7dPnl,
                    winRate: winRate7d
                };

                return {
                    ...hook.toObject(),
                    apiConfigured: true,
                    hook: userHook,
                    winRate,
                    avgPnl,
                    signals: dependingHooks.length,
                    personalStats,
                    communityStats,
                    recentTrades,
                    performanceData
                };
            } catch (error) {
                console.error("Error processing hook:", hook._id, error);
                return { ...hook.toObject() };
            }
        }));

        const userId = req.user?.userId;
        await User.findByIdAndUpdate(
            userId,
            { $set: { updatedAt: new Date() } },
            { new: true }
        );

        return res.status(200).json(adminHookswithHook);
    } catch (error) {
        console.error("Error during getting hooks:", error);
        return res.status(500).json({ message: 'Server error' });
    }
})

export default router;
