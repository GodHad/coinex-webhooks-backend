import express from 'express';
import { jwtAuth } from '../middleware/authorization';
import { JWTRequest } from '../types/JWTRequest';
import Hook from '../models/Hook';

const router = express.Router();

router.get('/', jwtAuth, async (req: JWTRequest, res) => {
    try {
        const userId = req.user?.userId;
        const hooks = await Hook.find({ creator: userId });
        return res.status(200).json(hooks);
    } catch (error) {
        console.error("Error during getting hooks:", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/create', jwtAuth, async (req: JWTRequest, res) => {
    const { url, coinExApiKey, coinExApiSecret, name, tradeDirection } = req.body;
    try {
        const userId = req.user?.userId;

        const newHook = new Hook({
            name,
            creator: userId,
            url,
            coinExApiKey,
            coinExApiSecret, 
            tradeDirection
        });
        await newHook.save();

        return res.status(200).json({
            message: 'Create new hook successful',
            hook: newHook
        })
    } catch (error) {
        console.error("Error during creating hook:", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.put('/update/:id', jwtAuth, async (req, res) => {
    const { url, coinExApiKey, coinExApiSecret, name, status, tradeDirection } = req.body;
    const id = req.params.id;

    try {
        const updatedHook = await Hook.findByIdAndUpdate(id, { 
            url, 
            coinExApiKey, 
            coinExApiSecret, 
            name, 
            tradeDirection,
            status 
        }, { new: true });
        return res.status(200).json({
            message: 'Update hook successful',
            hook: updatedHook
        });
    } catch (error) {
        console.error("Error during updating hook: ", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.delete('/:id', jwtAuth, async (req, res) => {
    const id = req.params.id;

    try {
        await Hook.findByIdAndDelete(id);
        return res.status(200).json({ message: 'Delete successful' });
    } catch (error) {
        console.error("Error during deleting hook: ", error);
        return res.status(500).json({ message: 'Server error' });
    }
})

export default router;
