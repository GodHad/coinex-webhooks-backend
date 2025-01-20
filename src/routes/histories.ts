import express from 'express';
import History from '../models/History';
import { jwtAuth } from '../middleware/authorization';
import { JWTRequest } from '../types/JWTRequest';
import Hook from '../models/Hook';

const router = express.Router();

router.get('/', jwtAuth, async (req: JWTRequest, res) => {
    const userId = req.user?.userId; 
    try {
        const { perPage = 10, currentPage = 1, searchTerm = '' } = req.query;

        const userHooks = await Hook.find({ creator: userId }).select('_id');
        const userHookIds = userHooks.map((hook) => hook._id);

        const filter = {
            hook: { $in: userHookIds },
            ...(searchTerm ? { name: { $regex: searchTerm, $options: 'i' } } : {}),
        };

        const skip = (Number(currentPage) - 1) * Number(perPage);
        const limit = Number(perPage);

        const histories = await History.find(filter).populate('hook').skip(skip).limit(limit);
        const totalHistory = await History.countDocuments(filter);

        return res.status(200).send({
            success: true,
            histories,
            pagination: {
                currentPage: Number(currentPage),
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
