import express from 'express';
import { adminAuth, jwtAuth } from '../middleware/authorization';
import { JWTRequest } from '../types/JWTRequest';
import AdminHook from '../models/AdminHook';
import { v4 as uuidv4 } from 'uuid';
import User from '../models/User';
import Hook from '../models/Hook';
import History from '../models/History';

const router = express.Router();

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
    const { name, pair, timeframe } = req.body;
    try {
        const userId = req.user?.userId;

        const url = uuidv4();

        const newHook = new AdminHook({
            name,
            pair,
            url,
            timeframe,
            creator: userId,
        });
        await newHook.save();

        await User.findByIdAndUpdate(
            userId,
            { $set: { updatedAt: new Date() } },
            { new: true }
        );
        return res.status(200).json({
            message: 'Create new hook successful',
            hook: newHook
        })
    } catch (error) {
        console.error("Error during creating hook:", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.put('/hooks/update/:id', adminAuth, async (req: JWTRequest, res) => {
    const { name, pair, timeframe } = req.body;
    const id = req.params.id;
    const userId = req.user?.userId


    try {
        const updatedHook = await AdminHook.findByIdAndUpdate(id, { name, pair, timeframe }, { new: true });
        await User.findByIdAndUpdate(
            userId,
            { $set: { updatedAt: new Date() } },
            { new: true }
        );
        return res.status(200).json({
            message: 'Update hook successful',
            hook: updatedHook
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
        await AdminHook.findByIdAndDelete(id);
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
            subscribed: 1,
            subscribeEndDate: { $gt: now },
        });
        const totalPremiumUsersCurrentMonth = await User.countDocuments({
            subscribed: 1,
            subscribeEndDate: { $gt: now },
            createdAt: { $gte: currentMonthStart },
        });
        const totalPremiumUsersPreviousMonth = await User.countDocuments({
            subscribed: 1,
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
        const currentMonth = now.getMonth() + 1; // JS months are 0-based, so add 1

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

export default router;
