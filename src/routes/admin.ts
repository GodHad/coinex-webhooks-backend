import express from 'express';
import { adminAuth, jwtAuth } from '../middleware/authorization';
import { JWTRequest } from '../types/JWTRequest';
import AdminHook from '../models/AdminHook';
import { v4 as uuidv4 } from 'uuid';
import User from '../models/User';

const router = express.Router();

router.get('/hooks', jwtAuth, async (req: JWTRequest, res) => {
    try {
        const user = await User.findById(req.user?.userId);

        if (!user) return res.status(400).json({message: 'User not found'});

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

router.post('/hooks/create', adminAuth, async (req: JWTRequest, res) => {
    const { name, pair } = req.body;
    try {
        const userId = req.user?.userId;

        const url = uuidv4();

        const newHook = new AdminHook({
            name,
            pair,
            url,
            creator: userId,
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

router.put('/hooks/update/:id', adminAuth, async (req, res) => {
    const { name, pair } = req.body;
    const id = req.params.id;

    try {
        const updatedHook = await AdminHook.findByIdAndUpdate(id, { name, pair }, { new: true });
        return res.status(200).json({
            message: 'Update hook successful',
            hook: updatedHook
        });
    } catch (error) {
        console.error("Error during updating hook: ", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.delete('/hooks/:id', adminAuth, async (req, res) => {
    const id = req.params.id;

    try {
        await AdminHook.findByIdAndDelete(id);
        return res.status(200).json({ message: 'Delete successful' });
    } catch (error) {
        console.error("Error during deleting hook: ", error);
        return res.status(500).json({ message: 'Server error' });
    }
})

export default router;
