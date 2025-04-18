import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

import siteMaintenanceMiddleware from '../middleware/siteMaintainance';
import { jwtAuth } from '../middleware/authorization';
import { JWTRequest } from '../types/JWTRequest';
import P2PHook from '../models/P2PHook';

const router = express.Router();

const storage = multer.diskStorage({
    destination: function (req, file, callback) {
        const uploadPath = path.join(__dirname, '../../../coinex-new-frontend/public/uploads');
        if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath);
        callback(null, uploadPath)
    },
    filename: function (req, file, callback) {
        const ext = path.extname(file.originalname);
        callback(null, `${Date.now()}${ext}`);
    }
});

const upload = multer({ storage });

router.get('/get-p2p-signals', jwtAuth, siteMaintenanceMiddleware, async (req: JWTRequest, res) => {
    try {
        const { orderBy, timeframeFilter, pairFilter, typeFilter, riskFilter, q } = req.query;
        const filter: { [key: string]: any; timeframe?: string; pair?: string; type?: string; riskLevel?: string; status: number; } = { status: 1 };

        if (timeframeFilter && timeframeFilter !== 'all') {
            filter.timeframe = timeframeFilter as string;
        }

        if (pairFilter && pairFilter !== '') {
            filter.pair = pairFilter as string;
        }

        if (typeFilter && typeFilter !== 'all') {
            filter.type = typeFilter as string;
        }

        if (riskFilter && riskFilter !== 'all') {
            filter.riskLevel = riskFilter as string;
        }

        if (q && q.toString().trim() !== '') {
            filter.$or = [
                { name: { $regex: new RegExp(q.toString(), 'i') } },
                { description: { $regex: new RegExp(q.toString(), 'i') } },
                { tags: { $regex: new RegExp(q.toString(), 'i') } },
            ];
        }

        let sort = {};

        switch (orderBy) {
            case 'newest':
                sort = { createdAt: -1 };
                break;
            case 'oldest':
                sort = { createdAt: 1 };
                break;
            case 'fee':
                sort = { subscriptionFee: -1 };
                break;
            default:
                sort = { createdAt: -1 };
        }

        const p2pHooks = await P2PHook.find(filter).select('-url').populate('creator').sort(sort).limit(100);

        return res.status(200).json({
            messsage: 'P2P signals fetched successfully',
            hooks: p2pHooks.map(h => ({ ...h.toObject(), tags: h.tags.split(','), stats: { winRate: 67, avgProfit: 2.1, totalTrades: 100, monthlyReturn: 5 } })),
        });
    } catch (error) {
        console.error('Error in get-p2p-signals:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/get-user-p2p-signals', jwtAuth, siteMaintenanceMiddleware, async (req: JWTRequest, res) => {
    try {
        const userId = req.user?.userId;

        const { orderBy, q } = req.query;
        const filter: { [key: string]: any; } = { creator: userId, status: 0 };

        if (q && q.toString().trim() !== '') {
            filter.$or = [
                { name: { $regex: new RegExp(q.toString(), 'i') } },
                { description: { $regex: new RegExp(q.toString(), 'i') } },
                { tags: { $regex: new RegExp(q.toString(), 'i') } },
            ];
        }

        let sort = {};

        switch (orderBy) {
            case 'newest':
                sort = { createdAt: -1 };
                break;
            case 'oldest':
                sort = { createdAt: 1 };
                break;
            case 'fee':
                sort = { subscriptionFee: -1 };
                break;
            default:
                sort = { createdAt: -1 };
        }

        const p2pHooks = await P2PHook.find(filter).populate('creator').sort(sort).limit(100);

        return res.status(200).json({
            messsage: 'P2P signals fetched successfully',
            hooks: p2pHooks.map(h => ({ ...h.toObject(), tags: h.tags.split(','), stats: { winRate: 67, avgProfit: 2.1, totalTrades: 100, monthlyReturn: 5 } })),
        });
    } catch (error) {
        console.error('Error in get-p2p-user-signals:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/', jwtAuth, siteMaintenanceMiddleware, upload.single('imageUrl'), async (req: JWTRequest, res) => {
    try {
        const userId = req.user?.userId;
        const { name, description, pair, timeframe, type, riskLevel, url, subscriptionFee, tags, imageInputType } = req.body;
        let imagePath = '';
        if (imageInputType === 'upload' && req.file) {
            imagePath = `/uploads/${req.file.filename}`;
        } else if (imageInputType === 'url' && req.body.imageUrl) {
            imagePath = req.body.imageUrl;
        }

        const existingHooks = await P2PHook.findOne({ url });
        if (existingHooks) {
            return res.status(400).json({ message: 'This url is already used for other strategy. Please use other one.' })
        }

        const newP2PHook = new P2PHook({
            creator: userId,
            name,
            description,
            pair,
            timeframe,
            type,
            riskLevel,
            url,
            subscriptionFee,
            tags,
            imageUrl: imagePath,
        });

        await newP2PHook.save();

        return res.status(200).json({
            message: 'Create P2P Strategy Successfully',
            hook: {...newP2PHook.toObject(), tags: newP2PHook.tags.split(',')}

        });
    } catch (error) {

    }
});

router.put('/:id', jwtAuth, siteMaintenanceMiddleware, upload.single('imageUrl'), async (req: JWTRequest, res) => {
    const id = req.params.id;
    const userId = req.user?.userId;

    try {
        const p2pHook = await P2PHook.findById(id);
        if (!p2pHook) {
            return res.status(400).json({ message: 'No strategy found' });
        }

        if (p2pHook.status === 1) return res.status(403).json({ message: 'This strategy is already approved.'});

        if (p2pHook.creator.toString() !== userId) {
            return res.status(401).json({ message: "You can't update this strategy" });
        }

        const {
            name,
            description,
            pair,
            timeframe,
            type,
            riskLevel,
            url,
            subscriptionFee,
            tags,
            imageInputType
        } = req.body;

        let imagePath = p2pHook.imageUrl;

        const isUpload = imageInputType === 'upload' && req.file;
        const isUrl = imageInputType === 'url' && req.body.imageUrl;

        if (isUpload) {
            imagePath = `/uploads/${req.file?.filename}`;

            if (p2pHook.imageUrl?.startsWith('/uploads/')) {
                const oldPath = path.join(__dirname, '../../../coinex-new-frontend/public', p2pHook.imageUrl);
                fs.existsSync(oldPath) && fs.unlinkSync(oldPath);
            }
        } else if (isUrl) {
            imagePath = req.body.imageUrl;
        }

        p2pHook.set({
            name,
            description,
            pair,
            timeframe,
            type,
            riskLevel,
            url,
            subscriptionFee,
            tags,
            imageUrl: imagePath,
        });

        await p2pHook.save();

        return res.status(200).json({
            message: 'Strategy updated successfully',
            hook: {...p2pHook.toObject(), tags: p2pHook.tags.split(',')},
        });

    } catch (error) {
        console.error("Error during updating hook:", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.delete('/:id', jwtAuth, siteMaintenanceMiddleware, async (req: JWTRequest, res) => {
    const id = req.params.id;

    try {
        const p2pHook = await P2PHook.findByIdAndDelete(id);
        if (!p2pHook) {
            return res.status(400).json({ message: 'No strategy found' });
        }

        if (p2pHook.status === 1) return res.status(403).json({ message: 'This strategy is already approved.'});

        if (p2pHook.imageUrl?.startsWith('/uploads/')) {
            const oldPath = path.join(__dirname, '..', p2pHook.imageUrl);
            fs.existsSync(oldPath) && fs.unlinkSync(oldPath);
        }
        return res.status(200).json({ message: 'Delete P2P Strategy Successful' });
    } catch (error) {
        console.error("Error during deleting hook: ", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;