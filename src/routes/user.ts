import express from 'express';
import { adminAuth } from '../middleware/authorization';
import User from '../models/User';

const router = express.Router();

router.get('/', adminAuth, async (req, res) => {
    try {
        const users = await User.find();
        return res.status(200).json(users);
    } catch (error) {
        console.error('Error fetching histories: ', error);
        return res.status(500).json({ success: false, message: 'Server Error' });
    }
});

router.put('/update-subscribe/:id', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const user = await User.findById(id);
        if (!user) {
            return res.status(400).json({message: 'User not found'});
        }

        const subscribed = user.subscribed;
        if (subscribed === 0 || subscribed === 3) {
            user.subscribed = 1;
            const currentDate = new Date();
            currentDate.setFullYear(currentDate.getFullYear() + 1);

            user.subscribeEndDate = currentDate;
        } else {
            user.subscribed = 3 - subscribed;
        }

        await user.save();
        return res.status(200).json({user, message: 'Update Subscription Successfully'})
    } catch (error) {
        console.error("Error updating subscribe", error);
        return res.status(500).json({ message: 'Server Error' });
    }
})

router.delete('/delete/:id', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        await User.findByIdAndDelete(id);
        return res.status(200).json({ message: 'Delete successful' });
    } catch (error) {
        console.error("Error deleting user: ", error);
        return res.status(500).json({ success: false, message: 'Server Error' });
    }
})

export default router;
