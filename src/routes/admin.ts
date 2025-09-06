import express from 'express';
import { adminAuth, jwtAuth } from '../middleware/authorization';
import { JWTRequest } from '../types/JWTRequest';
import AdminHook from '../models/AdminHook';
import { v4 as uuidv4 } from 'uuid';
import User from '../models/User';
import Hook from '../models/Hook';
import AdminData from '../models/AdminData';
import History from '../models/History';
import bcrypt from 'bcryptjs';
import ExchangePartner from '../models/ExchangePartner';
import P2PHook from '../models/P2PHook';
import PositionHistory from '../models/PositionHistory';
import PremiumHook from '../models/PremiumHook';
import mongoose from 'mongoose';

const router = express.Router();

export function isValidEmail(email: string): boolean {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
}

router.get('/hooks', jwtAuth, async (req: JWTRequest, res) => {
    try {
        const user = await User.findById(req.user?.userId);

        if (!user) return res.status(400).json({ message: 'User not found' });

        if (user.isAdmin) {
            const hooks = await AdminHook.find();
            return res.status(200).json(hooks);
        } else {
            const hooks = await AdminHook.find().select('-url');
            return res.status(200).json(hooks);
        }
    } catch (error) {
        console.error("Error during getting hooks:", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.get('/all-hooks', adminAuth, async (req, res) => {
    try {
        const hooks = await Hook.find().populate('creator');
        return res.status(200).json(hooks);
    } catch (error) {
        console.error("Error during get users' hooks", error);
    }
})

router.post('/hooks/create', adminAuth, async (req: JWTRequest, res) => {
    const { name, description, timeframe, riskLevel, imageUrl, color, iconType } = req.body;
    try {
        const userId = req.user?.userId;

        const newHook = new PremiumHook({
            name,
            description,
            timeframe,
            riskLevel,
            creator: userId,
            imageUrl,
            color,
            iconType
        });
        await newHook.save();

        await User.findByIdAndUpdate(
            userId,
            { $set: { updatedAt: new Date() } },
            { new: true }
        );
        return res.status(200).json({
            message: 'Create new hook successful',
            hook: { ...newHook.toObject() }
        })
    } catch (error) {
        console.error("Error during creating hook:", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.put('/hooks/update/:id', adminAuth, async (req: JWTRequest, res) => {
    const { name, description, timeframe, riskLevel, imageUrl, color, iconType } = req.body;
    const id = req.params.id;
    const userId = req.user?.userId

    try {
        const dependingHooks = await Hook.find({ adminHook: id });

        const updatedHook = await PremiumHook.findByIdAndUpdate(id, { name, timeframe, riskLevel, color, imageUrl, iconType, description }, { new: true });
        await User.findByIdAndUpdate(
            userId,
            { $set: { updatedAt: new Date() } },
            { new: true }
        );
        return res.status(200).json({
            message: 'Update hook successful',
            hook: { ...updatedHook?.toObject(), signals: dependingHooks.length },
        });
    } catch (error) {
        console.error("Error during updating hook: ", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.delete('/hooks/:id', adminAuth, async (req: JWTRequest, res) => {
    const id = req.params.id;
    const userId = req.user?.userId

    try {
        await PremiumHook.findByIdAndDelete(id);
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
});

router.post('/create-pair', adminAuth, async (req: JWTRequest, res) => {
    const { premiumHookId, pair } = req.body;
    const { alertName, recommendedLeverage, timeframe, enabled } = pair;
    try {
        const newAdminHook = new AdminHook({
            pair: pair.pair,
            url: uuidv4(),
            alertName,
            recommendedLeverage,
            timeframe,
            enabled,
        });
        await newAdminHook.save();

        const premiumHook = await PremiumHook.findById(premiumHookId);
        if (!premiumHook) {
            return res.status(404).json({ message: 'PremiumHook not found' });
        }

        premiumHook.pairs.push(newAdminHook._id as mongoose.Types.ObjectId);

        await premiumHook.save();

        return res.status(200).json({
            message: 'Create new pair successful',
            pair: newAdminHook,
        });
    } catch (error) {
        console.error("Error during creating pair:", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.put('/update-pair/:pairId', adminAuth, async (req: JWTRequest, res) => {
    const { pairId } = req.params;
    const { pair, alertName, enabled, recommendedLeverage, status, timeframe } = req.body;
    try {
        const adminHook = await AdminHook.findByIdAndUpdate(
            pairId,
            { $set: { pair, alertName, enabled, recommendedLeverage, status, timeframe } },
            { new: true }
        );

        return res.status(200).json({
            message: 'Update pair successful',
            pair: adminHook
        })
    } catch (error) {
        console.error("Error during updating pair:", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.delete('/delete-pair/:pairId', adminAuth, async (req: JWTRequest, res) => {
    const { pairId } = req.params;
    try {
        await AdminHook.findByIdAndDelete(pairId);
        // await Hook.deleteMany({ adminHook: pairId });
        return res.status(200).json({ message: 'Delete successful' });
    } catch (error) {
        console.error("Error during deleting pair", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.get('/overview', adminAuth, async (req: JWTRequest, res) => {
    try {
        const now = new Date();
        const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const previousMonthEnd = new Date(currentMonthStart.getTime() - 1);

        const totalUsers = await User.countDocuments();
        const totalUsersCurrentMonth = await User.countDocuments({
            createdAt: { $gte: currentMonthStart },
        });
        const totalUsersPreviousMonth = await User.countDocuments({
            createdAt: { $gte: previousMonthStart, $lt: previousMonthEnd },
        });

        const totalPremiumUsers = await User.countDocuments({
            subscribed: 2,
            subscribeEndDate: { $gt: now },
        });
        const totalPremiumUsersCurrentMonth = await User.countDocuments({
            subscribed: 2,
            subscribeEndDate: { $gt: now },
            createdAt: { $gte: currentMonthStart },
        });
        const totalPremiumUsersPreviousMonth = await User.countDocuments({
            subscribed: 2,
            subscribeEndDate: { $gt: now },
            createdAt: { $gte: previousMonthStart, $lt: previousMonthEnd },
        });

        const activeWebhooks = await Hook.countDocuments({ status: 0 });
        const activeWebhooksCurrentMonth = await Hook.countDocuments({
            status: 0,
            createdAt: { $gte: currentMonthStart },
        });
        const activeWebhooksPreviousMonth = await Hook.countDocuments({
            status: 0,
            createdAt: { $gte: previousMonthStart, $lt: previousMonthEnd },
        });

        const calculateRate = (current: number, previous: number) => {
            if (previous === 0) return current > 0 ? 100 : 0;
            return ((current - previous) / previous) * 100;
        };

        const histories = await History.find();

        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;

        const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
        const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;

        let currentMonthPnl = 0;
        let lastMonthPnl = 0;

        histories.forEach((history) => {
            if (history.data && history.data.data && history.data.data.realized_pnl !== undefined) {
                const date = new Date(history.createdAt);
                const year = date.getFullYear();
                const month = date.getMonth() + 1;

                if (year === currentYear && month === currentMonth) {
                    currentMonthPnl += parseFloat(history.data.data.realized_pnl);
                } else if (year === lastMonthYear && month === lastMonth) {
                    lastMonthPnl += parseFloat(history.data.data.realized_pnl);
                }
            }
        });

        let pnlRateChange = lastMonthPnl !== 0
            ? ((currentMonthPnl - lastMonthPnl) / Math.abs(lastMonthPnl)) * 100
            : (currentMonthPnl > 0 ? 100 : 0);

        return res.status(200).json({
            totalUsers,
            totalUsersChange: calculateRate(totalUsersCurrentMonth, totalUsersPreviousMonth),
            totalPremiumUsers,
            totalPremiumUsersChange: calculateRate(totalPremiumUsersCurrentMonth, totalPremiumUsersPreviousMonth),
            activeWebhooks,
            activeWebhooksChange: calculateRate(activeWebhooksCurrentMonth, activeWebhooksPreviousMonth),
            currentMonthPnl,
            pnlRateChange,
        });
    } catch (error) {
        console.error("Error while getting overview", error);
        return res.status(500).json({ message: 'Server error' });
    }
})

router.post('/add-user', adminAuth, async (req, res) => {
    const { firstName, lastName, email, password } = req.body;
    if (!isValidEmail(email)) {
        return res.status(400).json({ message: 'Username can only contain lowercase letters and numbers, with no spaces.' });
    }
    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const inviteCode = Math.floor(1000 + Math.random() * 9000).toString();

        const newUser = new User({
            firstName,
            lastName,
            email,
            password: hashedPassword,
            inviteCode
        });

        await newUser.save();


        res.status(201).json({
            message: 'Add user successfully',
            user: newUser
        });
    } catch (error) {
        console.log("Failed to register user: ", error);
        res.status(500).json({ message: 'Server error' });
    }
})

router.get('/admin-data', adminAuth, async (req, res) => {
    try {
        const data = await AdminData.findOne();
        res.status(200).json({
            'message': 'Get Admin Data successful',
            data
        });
    } catch (error) {
        console.error("Error during updating adminData: ", error);
        return res.status(500).json({ message: 'Server error' });
    }
})

router.post('/update-admin-data', adminAuth, async (req, res) => {
    try {
        const {
            twitter,
            instagram,
            discord,
            telegram,
            favicon,
            pageTitle,
            sidebarTitle,
            mainTitle,
            subTitle,
            features,
            siteMaintainanceMode,
            webhooksMaintainanceMode,
            allowSignup,
        } = req.body;
        const data = await AdminData.findOneAndUpdate({}, {
            twitter,
            instagram,
            discord,
            telegram,
            favicon,
            pageTitle,
            sidebarTitle,
            mainTitle,
            subTitle,
            featuredCardTitle: features[0].title,
            featuredCardDescription: features[0].description,
            featuredCardTitle1: features[1].title,
            featuredCardDescription1: features[1].description,
            featuredCardTitle2: features[2].title,
            featuredCardDescription2: features[2].description,
            siteMaintainanceMode,
            webhooksMaintainanceMode,
            allowSignup,
            // inviteCodes
        }, { new: true });
        res.status(200).json({
            message: 'Update Admin Data successful',
            data
        })
    } catch (error) {
        console.error("Error during updating adminData: ", error);
        return res.status(500).json({ message: 'Server error' });
    }
})

router.get('/exchanges', adminAuth, async (req, res) => {
    try {
        const data = await ExchangePartner.find();
        res.status(200).json({
            'message': 'Get Admin Data successful',
            data
        });
    } catch (error) {
        console.error("Error during updating adminData: ", error);
        return res.status(500).json({ message: 'Server error' });
    }
})

router.post('/add-exchange', adminAuth, async (req, res) => {
    try {
        const { name, logo, description, pros, cons, rating, tradingFee, leverage, minDeposit, assets, enabled, affiliateLink } = req.body;

        // Create new ExchangePartner entry
        const newExchange = new ExchangePartner({
            name,
            logo,
            description,
            pros, // Fix: "props" should be "pros"
            cons,
            rating,
            tradingFee,
            leverage,
            minDeposit,
            assets,
            enabled,
            affiliateLink
        });

        // Save to database
        const savedExchange = await newExchange.save();

        res.status(201).json({
            message: 'Exchange Data added successfully',
            data: savedExchange
        });
    } catch (error) {
        console.error("Error during adding Exchange: ", error);
        return res.status(500).json({ message: 'Server error' });
    }
})

router.post('/update-exchange', adminAuth, async (req, res) => {
    try {
        const { _id, name, logo, description, pros, cons, rating, tradingFee, leverage, minDeposit, assets, enabled, affiliateLink } = req.body;

        // Create new ExchangePartner entry
        const data = await ExchangePartner.findOneAndUpdate({ _id }, {
            name,
            logo,
            description,
            pros, // Fix: "props" should be "pros"
            cons,
            rating,
            tradingFee,
            leverage,
            minDeposit,
            assets,
            enabled,
            affiliateLink
        }, { new: true });
        res.status(200).json({
            message: 'Update Admin Data successful',
            data
        })
    } catch (error) {
        console.error("Error during adding Exchange: ", error);
        return res.status(500).json({ message: 'Server error' });
    }
})

router.delete('/delete-exchange/:id', adminAuth, async (req, res) => {
    const _id = req.params.id;
    try {
        await ExchangePartner.findByIdAndDelete(_id);
        return res.status(200).json({ message: 'Delete successful' });
    } catch (error) {
        console.error("Error during deleting hook: ", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/toggle-exchange/:id', adminAuth, async (req, res) => {
    const _id = req.params.id;
    try {
        const exchange = await ExchangePartner.findById(_id);
        if (exchange) {
            exchange.enabled = !exchange.enabled;
            await exchange.save();
            return res.status(200).json({ message: 'Delete successful' });
        }

        return res.status(400).json({ message: 'Can\'t find exchange partner' });
    } catch (error) {
        console.error("Error during deleting hook: ", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.get('/p2p-signals', adminAuth, async (req, res) => {
    try {
        const { status, page } = req.query;

        const filter: { status?: number } = {};

        if (status) filter.status = Number(status);

        const p2pHooks = await P2PHook.find(filter).populate('creator').skip((Number(page) - 1) * 10).limit(10);

        const totalItems = await P2PHook.countDocuments(filter);

        const hookIds = p2pHooks.map(h => h._id);

        const p2pSignals = await Promise.all(p2pHooks.map(async hook => {
            try {
                const histories = await PositionHistory.find({ hook: { $in: hookIds } });
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

                return {
                    ...hook.toObject(),
                    tags: hook.tags.split(','),
                    stats: {
                        winRate,
                        avgPnl,
                    }
                };
            } catch (error: any) {
                console.error("Error getting history info in p2p signals: ", hook._id, error);
                return { ...hook.toObject(), tags: hook.tags.split(',') };
            }
        }))

        return res.status(200).json({
            success: true,
            signals: p2pSignals,
            pagination: {
                currentPage: Number(page) <= Math.ceil(totalItems / 10) ? Number(page) : 1,
                perPage: 10,
                totalPages: Math.ceil(totalItems / 10),
                totalItems,
            }
        })
    } catch (error) {
        console.error("Error during getting p2p hook: ", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.put('/p2p-signals/update-status/:id', adminAuth, async (req, res) => {
    try {
        const id = req.params.id;
        const { status } = req.body;
        const p2pHook = await P2PHook.findByIdAndUpdate(id, { status });
        if (!p2pHook) {
            return res.status(400).json({
                message: 'P2P strategy not found',
            });
        }

        return res.status(200).json({
            signal: { ...p2pHook.toObject(), tags: p2pHook.tags.split(',') },
            message: 'Update P2P strategy successfully',
        });
    } catch (error: any) {
        console.error("Error during updating p2p hook: ", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

const uniqHooksForUser = async (userId: string) => {
    const hooks = await Hook.find({ creator: userId }).lean();
    const uniq = new Map<string, any>();
    for (const h of hooks) {
        const key = `${h.coinExApiKey}::${h.coinExApiSecret}`;
        if (!uniq.has(key)) uniq.set(key, h);
    }
    return Array.from(uniq.values()).map(h => h._id);
};

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
    currentPrice: (h: any) => Number(h?.data?.settle_price ?? h?.data?.mark_price ?? NaN),
    liqPrice: (h: any) => Number(h?.data?.liq_price ?? NaN),
    marginRate: (h: any) => Number(h?.data?.margin_rate ?? h?.data?.marginRate ?? NaN),
    positionMargin: (h: any) => Number(h?.data?.position_margin_rate ?? NaN),
    closeMs: (h: any) => Number(h?.data?.close_time) || (h?.updatedAt ? new Date(h.updatedAt).getTime() : NaN),
};

const mapClosed = (h: any) => {
    const entry = Number.isFinite(get.entry(h)) ? get.entry(h) : 0;
    const exit = Number.isFinite(get.exit(h)) ? get.exit(h) : 0;
    const amount = Number.isFinite(get.amount(h)) ? get.amount(h) : 0;
    const pnl = Number.isFinite(get.realizedPnl(h)) ? get.realizedPnl(h) : 0;
    const invested = entry > 0 && amount > 0 ? entry * amount : 0;
    const roi = invested > 0 ? (pnl / invested) * 100 : 0;

    const closeTimeMs = Number.isFinite(get.closeMs(h)) ? (get.closeMs(h) as number)
        : (h?.updatedAt ? new Date(h.updatedAt).getTime() : Date.now());
    const d = new Date(closeTimeMs);

    return {
        id: String(h.position_id || h._id),
        position_id: h?.data?.position_id || h._id,
        market: get.market(h),
        side: get.side(h) === 'short' ? 'short' : 'long',
        pnl,
        entryPrice: entry,
        exitPrice: exit,
        amount,
        leverage: Number.isFinite(get.leverage(h)) ? get.leverage(h) : 0,
        roi,
        date: d.toISOString(),
    };
};

const mapOpen = (p: any) => ({
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
});

const getRealizedPnl = (h: any) => {
    const d = h?.data || {};
    const v = d.realized_pnl ?? d.close_pnl ?? d.pnl_usdt ?? 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

const getClosedMs = (h: any) => {
    const d = h?.data || {};
    const v = d.created_at ?? d.close_time ?? (h.updatedAt ? new Date(h.updatedAt).getTime() : undefined);
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
};

router.get('/trading/users', adminAuth, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? '20'), 10) || 20));

        const [users, total] = await Promise.all([
            User.find({}, { password: 0 }).sort({ updatedAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
            User.countDocuments({}),
        ]);

        const now = new Date();
        const startOfTodayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

        const items = await Promise.all(
            users.map(async (u) => {
                const hooks = await Hook.find({ creator: u._id }).lean();
                const uniq = new Map<string, any>();
                for (const h of hooks) {
                    const k = `${h.coinExApiKey}::${h.coinExApiSecret}`;
                    if (!uniq.has(k)) uniq.set(k, h);
                }
                const hookIds = Array.from(uniq.values()).map((h) => h._id);

                const [finished, active] = await Promise.all([
                    PositionHistory.find({ hook: { $in: hookIds }, finished: true }).lean(),
                    PositionHistory.find({ hook: { $in: hookIds }, finished: false }).lean(),
                ]);

                const todaysPnl = finished
                    .filter((h) => {
                        const ms = getClosedMs(h);
                        return ms != null && ms >= startOfTodayUTC;
                    })
                    .reduce((s, h) => s + getRealizedPnl(h), 0);

                const cumulativePnl = finished.reduce((s, h) => s + getRealizedPnl(h), 0);

                const recent = finished.slice(-50);
                const totalTrades = recent.length;
                const wins = recent.filter((h) => getRealizedPnl(h) > 0).length;
                const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

                const activePositions = active.length;
                const pendingOrders = 0;

                const totalAssets = Number(u?.balance?.total) || 0;

                const dailyIncomeRate = totalAssets > 0 ? (todaysPnl / totalAssets) * 100 : 0;

                const avgLev =
                    active.length > 0
                        ? active.reduce((s, p: any) => s + (Number(p?.data?.leverage) || 0), 0) / active.length
                        : 0;
                let riskLevel: 'low' | 'medium' | 'high' = 'medium';
                if (avgLev >= 10) riskLevel = 'high';
                else if (avgLev <= 3) riskLevel = 'low';

                const lastActive = (u.updatedAt || u.createdAt || new Date()).toISOString();
                const lastUpdatedMs = new Date(lastActive).getTime();
                const fifteenMinAgo = Date.now() - 15 * 60 * 1000;
                let apiStatus: 'connected' | 'error' | 'syncing' = 'syncing';
                if (hookIds.length === 0) apiStatus = 'error';
                else if (lastUpdatedMs >= fifteenMinAgo) apiStatus = 'connected';

                const out = {
                    userId: String(u._id),
                    email: u.email || '',
                    totalAssets: Number(totalAssets.toFixed(6)),
                    todaysPnl: Number(todaysPnl.toFixed(6)),
                    cumulativePnl: Number(cumulativePnl.toFixed(6)),
                    dailyIncomeRate: Number(dailyIncomeRate.toFixed(4)),
                    activePositions,
                    pendingOrders,
                    totalTrades,
                    winRate: Number(winRate.toFixed(6)),
                    lastActive,
                    riskLevel,
                    apiStatus,
                };

                return out;
            })
        );

        return res.status(200).json({
            items,
            page,
            pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
            hasPrev: page > 1,
            hasNext: page * pageSize < total,
        });
    } catch (err) {
        console.error('GET /api/admin/trading/users failed:', err);
        return res.status(500).json({ error: 'Failed to load admin user trading data.' });
    }
});

router.get('/trading/users/:userId', adminAuth, async (req, res) => {
    try {
        const userId = String(req.params.userId);
        const hookIds = await uniqHooksForUser(userId);

        const [user, closed, open] = await Promise.all([
            User.findById(userId, { email: 1, username: 1, balance: 1, updatedAt: 1 }).lean(),
            PositionHistory.find({ hook: { $in: hookIds }, finished: true })
                .sort({ 'data.updated_at': -1, updatedAt: -1 })
                .limit(500)
                .lean(),
            PositionHistory.find({ hook: { $in: hookIds }, finished: false }).lean(),
        ]);

        const finished = await PositionHistory.find({ hook: { $in: hookIds }, finished: true }).lean();

        const now = new Date();
        const startOfTodayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        const todaysPnl = finished
            .filter((h) => {
                const ms = getClosedMs(h);
                return ms != null && ms >= startOfTodayUTC;
            })
            .reduce((s, h) => s + getRealizedPnl(h), 0);

        const trades = closed.map(mapClosed); 
        const positions = open.map(mapOpen);

        const pnlTotal = trades.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
        const wins = trades.filter(t => Number(t.pnl) > 0).length;
        const totalTrades = trades.length;
        const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;

        const startUTC = new Date();
        startUTC.setUTCHours(0, 0, 0, 0);

        return res.status(200).json({
            user: {
                userId,
                email: user?.email,
                firstName: user?.firstName,
                lastName: user?.lastName,
                lastActive: user?.updatedAt,
            },
            summary: {
                totalTrades,
                winRate,
                pnlTotal,
                todaysPnl,
                openPositions: positions.length,
                totalAssets: user?.balance?.total ?? 0,
            },
            positions,
            tradesSample: trades.slice(0, 5),
        });
    } catch (err) {
        console.error('GET /admin/trading/users/:userId failed', err);
        return res.status(500).json({ error: 'Failed to load user trading details.' });
    }
});


router.get('/trading/users/:userId/trades', adminAuth, async (req, res) => {
    try {
        const userId = String(req.params.userId);
        const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
        const pageSize = Math.min(100, parseInt(String(req.query.pageSize ?? '25'), 10) || 25);
        const skip = (page - 1) * pageSize;

        const hookIds = await uniqHooksForUser(userId);
        const [total, rows] = await Promise.all([
            PositionHistory.countDocuments({ hook: { $in: hookIds }, finished: true }),
            PositionHistory.find({ hook: { $in: hookIds }, finished: true })
                .sort({ 'data.close_time': -1, updatedAt: -1 })
                .skip(skip).limit(pageSize).lean(),
        ]);

        const items = rows.map(mapClosed);
        return res.status(200).json({
            items,
            page,
            pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
        });
    } catch (err) {
        console.error('GET /admin/trading/users/:userId/trades failed', err);
        return res.status(500).json({ error: 'Failed to load user trades.' });
    }
});

router.get('/trading/users/:userId/positions', adminAuth, async (req, res) => {
    try {
        const userId = String(req.params.userId);
        const hookIds = await uniqHooksForUser(userId);
        const active = await PositionHistory.find({ hook: { $in: hookIds }, finished: false })
            .sort({ updatedAt: -1 })
            .lean();

        return res.status(200).json(active.map(mapOpen));
    } catch (err) {
        console.error('GET /admin/trading/users/:userId/positions failed', err);
        return res.status(500).json({ error: 'Failed to load open positions.' });
    }
});

export default router;
