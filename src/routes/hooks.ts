import express from 'express';
import { jwtAuth } from '../middleware/authorization';
import { JWTRequest } from '../types/JWTRequest';
import Hook from '../models/Hook';
import User from '../models/User';
import { v4 as uuidv4 } from 'uuid';
import AdminHook from '../models/AdminHook';
import History from '../models/History';

const router = express.Router();

router.get('/', jwtAuth, async (req: JWTRequest, res) => {
    try {
        const userId = req.user?.userId;
        const hooks = await Hook.find({ creator: userId }).populate('adminHook');
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

router.post('/create', jwtAuth, async (req: JWTRequest, res) => {
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


router.put('/update/:id', jwtAuth, async (req: JWTRequest, res) => {
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

router.delete('/:id', jwtAuth, async (req: JWTRequest, res) => {
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

router.get('/admin-hooks', jwtAuth, async (req: JWTRequest, res) => {
    try {
        const user = await User.findById(req.user?.userId);
        console.log(user)
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

                console.log(dependingHooks)
                const histories = await History.find({ hook: { $in: dependingHooks.map(h => h._id) } });
        
                let totalWins = 0;
                let totalPnl = 0;
        
                if (histories.length > 0) {
                    totalPnl = histories.reduce((sum, history) => {
                        if (history.data.data && history.data.data.realized_pnl !== undefined) {
                            if (Number(history.data.data.realized_pnl) >= 0) totalWins++;
                            return sum + parseFloat(history.data.data.realized_pnl);
                        }
                        return sum;
                    }, 0);
        
                    const winRate = (totalWins / histories.length) * 100;
                    const avgPnl = totalPnl / histories.length;
        
                    console.log("Total Wins:", totalWins, "Avg PNL:", avgPnl);
        
                    const total24 = await History.countDocuments({
                        hook: { $in: dependingHooks.map(h => h._id) },
                        createdAt: {
                            $gt: new Date(Date.now() - 24 * 60 * 60 * 1000),  // 24 hours ago
                            $lt: new Date()  // Now
                        }
                    });                    

                    return {
                        ...hook.toObject(),
                        apiConfigured: true,
                        hook: userHook,
                        winRate,
                        avgPnl,
                        signals: dependingHooks.length,
                        total24,
                    };
                } else {
                    console.log("No histories found for hook:", hook._id);
                    return {
                        ...hook.toObject(),
                        apiConfigured: true,
                        hook: userHook,
                        winRate: 0,
                        avgPnl: 0,
                        signals: dependingHooks.length,
                        total24: 0
                    };
                }
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
