import express from 'express';
import History from '../models/History';
import { jwtAuth } from '../middleware/authorization';
import { JWTRequest } from '../types/JWTRequest';
import Hook from '../models/Hook';
import User from '../models/User';
import { Types } from 'mongoose';
import maintenanceMiddleware from '../middleware/maintainance';

const router = express.Router();

router.get('/', jwtAuth, maintenanceMiddleware, async (req: JWTRequest, res) => {
    const userId = req.user?.userId;
    try {
        const user = await User.findById(userId);

        if (!user) return res.status(404).json({ message: 'User not found' });
        const isSubscribed =
            user.subscribed === 1 &&
            user.subscribeEndDate &&
            new Date(user.subscribeEndDate).getTime() > Date.now();

        const { perPage = 10, currentPage = 1, searchTerm = '', filter = 'all', source = 'all' } = req.query;

        const userHooks = await Hook.find({ creator: userId }).select('_id adminHook');
        const userHookIds = userHooks.map((hook) => hook._id);
        const adminHookIds = userHooks.filter(hook => hook.adminHook).map(hook => hook._id);

        const _filter: any = {
            hook: { $in: userHookIds },
            ...(searchTerm ? { name: { $regex: searchTerm, $options: 'i' } } : {}),
        };

        if (!isSubscribed) {
            const oneDayAgo = new Date();
            oneDayAgo.setDate(oneDayAgo.getDate() - 1);
            _filter.createdAt = { $gte: oneDayAgo };
        }

        if (filter === 'success') {
            _filter['data.code'] = 0;
        } else if (filter === 'error') {
            _filter['data.code'] = { $ne: 0 };
        } else if (filter === 'warning') {
            return res.status(200).send({
                success: true,
                histories: [],
                pagination: {
                    currentPage: 1,
                    perPage: Number(perPage),
                    totalPages: 0,
                    totalItems: 0,
                },
            });
        }

        if (source === 'standard') {
            _filter['hook'] = { $in: userHookIds.filter(hook => !adminHookIds.includes(hook)) };
        } else if (source === 'premium') {
            _filter['hook'] = { $in: adminHookIds };
        } else if (source === 'p2p') {
            return res.status(200).send({
                success: true,
                histories: [],
                pagination: {
                    currentPage: 1,
                    perPage: Number(perPage),
                    totalPages: 0,
                    totalItems: 0,
                },
            });
        }

        const skip = (Number(currentPage) - 1) * Number(perPage);
        const limit = Number(perPage);

        const histories = await History.find(_filter).populate('hook').skip(skip).limit(limit).sort({ createdAt: -1 });
        const totalHistory = await History.countDocuments(_filter);

        const enrichedHistories = histories.map(history => {
            const hook = history.hook as { _id: Types.ObjectId; adminHook?: Types.ObjectId };
            const isAdminHook = hook?.adminHook ? true : false;

            return {
                ...history.toObject(),
                source: isAdminHook ? 'premium' : 'standard'
            };
        });


        return res.status(200).send({
            success: true,
            histories: enrichedHistories,
            pagination: {
                currentPage: Number(currentPage) <= Math.ceil(totalHistory / Number(perPage)) ? Number(currentPage) : 1,
                perPage: Number(perPage),
                totalPages: Math.ceil(totalHistory / Number(perPage)),
                totalItems: totalHistory,
            },
        });
    } catch (error) {
        console.error('Error fetching histories: ', error);
        return res.status(500).json({ success: false, message: 'Server Error' });
    }
});

export default router;
