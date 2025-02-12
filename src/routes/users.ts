import express from 'express';
import { adminAuth, jwtAuth } from '../middleware/authorization';
import User from '../models/User';
import Hook from '../models/Hook';
import History from '../models/History';
import { JWTRequest } from '../types/JWTRequest';
import AdminData from '../models/AdminData';

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
            return res.status(400).json({ message: 'User not found' });
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
        return res.status(200).json({ user, message: 'Update Subscription Successfully' })
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

router.get('/get-overview', jwtAuth, async (req: JWTRequest, res) => {
    try {
        const userId = req.user?.userId; // Extract user ID from JWT
        if (!userId) return res.status(401).json({ error: "Unauthorized" });

        const hooks = await Hook.find({ creator: userId });

        const activePositions = hooks.filter(hook => hook.status === 0).length;

        const histories = await History.find({ hook: { $in: hooks.map(h => h._id) } });

        const totalPnl = histories.reduce((sum, history) => {
            if (history.data.data && history.data.data.realized_pnl !== undefined) {
                return sum + parseFloat(history.data.data.realized_pnl);
            }
            return sum;
        }, 0);

        const totalRisk = hooks.reduce((sum, hook) => {
            if (hook.leverage && hook.entryPrice) {
                return sum + (parseFloat(hook.leverage) * parseFloat(hook.entryPrice));
            }
            return sum;
        }, 0);

        return res.status(200).json({
            totalPnl,
            activePositions,
            totalRisk,
            totalPositions: hooks.length
        });

    } catch (error) {
        console.error("Error in get-overview:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});

router.get('/homepage', async (req, res) => {
    try {
        const adminData = await AdminData.findOne({}, 'mainTitle subTitle featuredCardTitle featuredCardDescription featuredCardTitle1 featuredCardDescription1 featuredCardTitle2 featuredCardDescription2');
        console.log("homepage", adminData)
        return res.status(200).json({
            data: adminData,
            message: 'Get Homepage data successful',
        })
    } catch (error) {
        console.error("Error updating subscribe", error);
        return res.status(500).json({ message: 'Server Error' });
    }
});

router.get('/social-links', async (req, res) => {
    try {
        const adminData = await AdminData.findOne({}, 'twitter telegram discord instagram');
        console.log("social-links", adminData)
        return res.status(200).json({
            data: adminData,
            message: 'Get social links successful',
        })
    } catch (error) {
        console.error("Error updating subscribe", error);
        return res.status(500).json({ message: 'Server Error' });
    }
})

router.get('/get-sidebar-title', async (req, res) => {
    try {
        const adminData = await AdminData.findOne({}, 'sidebarTitle');
        console.log(adminData)
        return res.status(200).json({
            sidebarTitle: adminData ? adminData.sidebarTitle : 'Webhook Manager',
            message: 'Get sidebar title successful',
        })
    } catch (error) {
        console.error("Error updating subscribe", error);
        return res.status(500).json({ message: 'Server Error' });
    }
})

router.get('/get-page-data', async (req, res) => {
    try {
        const adminData = await AdminData.findOne({}, 'favicon pageTitle');
        return res.status(200).json({
            data: adminData,
            message: 'Get page data successful',
        })
    } catch (error) {
        console.error("Error updating subscribe", error);
        return res.status(500).json({ message: 'Server Error' });
    }
})

export default router;
