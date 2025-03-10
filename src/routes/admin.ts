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
    const { pair, timeframe, riskLevel, imageUrl, recommendedLeverage, description } = req.body;
    try {
        console.log(req.body)
        const userId = req.user?.userId;

        const url = uuidv4();

        const newHook = new AdminHook({
            name: timeframe + ' ' + pair,
            pair,
            url,
            timeframe,
            riskLevel,
            creator: userId,
            enabled: true,
            imageUrl,
            description,
            recommendedLeverage
        });
        await newHook.save();

        await User.findByIdAndUpdate(
            userId,
            { $set: { updatedAt: new Date() } },
            { new: true }
        );
        return res.status(200).json({
            message: 'Create new hook successful',
            hook: { ...newHook.toObject(), signals: 0 }
        })
    } catch (error) {
        console.error("Error during creating hook:", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.put('/hooks/update/:id', adminAuth, async (req: JWTRequest, res) => {
    const { pair, timeframe, riskLevel, enabled, imageUrl, recommendedLeverage, description } = req.body;
    const id = req.params.id;
    const userId = req.user?.userId

    try {
        const dependingHooks = await Hook.find({ adminHook: id });

        const updatedHook = await AdminHook.findByIdAndUpdate(id, { name: timeframe + ' ' + pair, pair, timeframe, riskLevel, enabled, imageUrl, recommendedLeverage, description }, { new: true });
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

        console.log('overview', {
            totalUsers,
            totalUsersChange: calculateRate(totalUsersCurrentMonth, totalUsersPreviousMonth),
            totalPremiumUsers,
            totalPremiumUsersChange: calculateRate(totalPremiumUsersCurrentMonth, totalPremiumUsersPreviousMonth),
            activeWebhooks,
            activeWebhooksChange: calculateRate(activeWebhooksCurrentMonth, activeWebhooksPreviousMonth),
            currentMonthPnl,
            pnlRateChange,
        })
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
        const { twitter, instagram, discord, telegram, favicon, pageTitle, sidebarTitle, mainTitle, subTitle, features, siteMaintainanceMode, webhooksMaintainanceMode, allowSignup } = req.body;
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

        console.log(req.body);

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
        const {_id, name, logo, description, pros, cons, rating, tradingFee, leverage, minDeposit, assets, enabled, affiliateLink } = req.body;

        console.log(req.body);

        // Create new ExchangePartner entry
        const data = await ExchangePartner.findOneAndUpdate({_id}, {
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
})

export default router;
