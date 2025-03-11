import express from 'express';
import { adminAuth, jwtAuth } from '../middleware/authorization';
import User from '../models/User';
import Hook from '../models/Hook';
import History from '../models/History';
import { JWTRequest } from '../types/JWTRequest';
import AdminData from '../models/AdminData';
import PositionHistory from '../models/PositionHistory';
import moment from 'moment';

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

        const user = await User.findById(userId);

        const hooks = await Hook.find({ creator: userId });

        const standardHooks = hooks.filter(hook => !hook.adminHook);
        const premiumHooks = hooks.filter(hook => hook.adminHook);

        const positionHistories = await PositionHistory.find({ hook: { $in: hooks.map(h => h._id) } });
        const standardPositionHistories = await PositionHistory.find({ hook: { $in: standardHooks.map(h => h._id) } });
        const premiumPositionHistories = await PositionHistory.find({ hook: { $in: premiumHooks.map(h => h._id) } });

        const totalPnl = positionHistories.reduce((sum, history) => {
            if (history.data && history.data.realized_pnl !== undefined) {
                return sum + parseFloat(history.data.realized_pnl);
            }
            return sum;
        }, 0);

        const standardTotalPnl = standardPositionHistories.reduce((sum, history) => {
            if (history.data && history.data.realized_pnl !== undefined) {
                return sum + parseFloat(history.data.realized_pnl);
            }
            return sum;
        }, 0);

        const premiumTotalPnl = premiumPositionHistories.reduce((sum, history) => {
            if (history.data && history.data.realized_pnl !== undefined) {
                return sum + parseFloat(history.data.realized_pnl);
            }
            return sum;
        }, 0);

        const now = new Date();
        const todayStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

        const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay())); // Sunday of this week
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1); // First day of this month
        
        const today = new Date().toISOString().split('T')[0];

        const todayPnl = positionHistories.reduce((sum, history) => {
            if (history.data && history.data.realized_pnl !== undefined) {
                const historyDate = new Date(history.createdAt).toISOString().split('T')[0];

                if (historyDate === today) {
                    return sum + parseFloat(history.data.realized_pnl);
                }
            }
            return sum;
        }, 0);

        const pnlStats = positionHistories.reduce((acc, history) => {
            if (history.data && history.data.realized_pnl !== undefined) {
                const historyDate = new Date(history.createdAt);
                const historyDateStr = historyDate.toISOString().split('T')[0];

                const pnl = parseFloat(history.data.realized_pnl);

                if (historyDateStr === todayStr) {
                    acc.daily += pnl;
                }

                if (historyDate >= startOfWeek) {
                    acc.weekly += pnl;
                }

                if (historyDate >= startOfMonth) {
                    acc.monthly += pnl;
                }

                acc.allTime += pnl;
            }
            return acc;
        }, { daily: 0, weekly: 0, monthly: 0, allTime: 0 });

        const totalRisk = hooks.reduce((sum, hook) => {
            if (hook.leverage && hook.entryPrice) {
                return sum + (parseFloat(hook.leverage) * parseFloat(hook.entryPrice));
            }
            return sum;
        }, 0);

        const standardTotalRisk = standardHooks.reduce((sum, hook) => {
            if (hook.leverage && hook.entryPrice) {
                return sum + (parseFloat(hook.leverage) * parseFloat(hook.entryPrice));
            }
            return sum;
        }, 0);

        const premiumTotalRisk = premiumHooks.reduce((sum, hook) => {
            if (hook.leverage && hook.entryPrice) {
                return sum + (parseFloat(hook.leverage) * parseFloat(hook.entryPrice));
            }
            return sum;
        }, 0);

        return res.status(200).json({
            totalPnl,
            totalRisk,
            totalPositions: positionHistories.length,
            activePositions: positionHistories.filter(history => !history.finished).length,
            standard: {
                totalPnl: standardTotalPnl,
                totalPositions: standardPositionHistories.length,
                activePositions: standardPositionHistories.filter(h => !h.finished).length,
                totalRisk: standardTotalRisk
            },
            premium: {
                totalPnl: premiumTotalPnl,
                totalPositions: premiumPositionHistories.length,
                activePositions: premiumPositionHistories.filter(h => !h.finished).length,
                totalRisk: premiumTotalRisk
            },
            pnlStats,
            todayPnl,
            lastUpdated: user?.updatedAt
        });

    } catch (error) {
        console.error("Error in get-overview:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});

router.get('/get-pnl-last-30-days', jwtAuth, async (req: JWTRequest, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });

        // Get the last 30 days date range
        const end = new Date(); // Today
        const start = new Date();
        start.setDate(end.getDate() - 30); // 30 days ago

        const hooks = await Hook.find({ creator: userId });
        const positionHistories = await PositionHistory.find({
            hook: { $in: hooks.map(h => h._id) },
            createdAt: { $gte: start, $lte: end }
        });

        // Separate Standard & Premium hooks
        const standardHooks = hooks.filter(hook => !hook.adminHook);
        const premiumHooks = hooks.filter(hook => hook.adminHook);

        // Initialize data structure with all past 30 days
        const initialData = Array.from({ length: 30 }, (_, i) => {
            const dateKey = moment().subtract(i, 'days').format('MMM D'); // "Feb 10"
            return { [dateKey]: 0 };
        }).reduce((acc, obj) => ({ ...acc, ...obj }), {}); // Convert array to object

        // Helper function to group PnL by date
        const groupPnlByDate = (histories: any[], hooks: any[]) => {
            return histories.reduce((acc, history) => {
                if (history.data?.realized_pnl !== undefined) {
                    const historyDate = moment(history.createdAt).format('MMM D'); // "Feb 10"
                    const pnl = parseFloat(history.data.realized_pnl);

                    if (hooks.some(hook => hook._id.equals(history.hook))) {
                        acc[historyDate] = (acc[historyDate] || 0) + pnl;
                    }
                }
                return acc;
            }, { ...initialData }); // Fill missing days with 0
        };

        // Compute PnL for Standard and Premium
        const standardPnlByDate = groupPnlByDate(positionHistories, standardHooks);
        const premiumPnlByDate = groupPnlByDate(positionHistories, premiumHooks);

        return res.status(200).json({
            standard: standardPnlByDate,
            premium: premiumPnlByDate
        });

    } catch (error) {
        console.error("Error in get-pnl-last-30-days:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});

router.get('/homepage', async (req, res) => {
    try {
        const adminData = await AdminData.findOne({}, 'mainTitle subTitle featuredCardTitle featuredCardDescription featuredCardTitle1 featuredCardDescription1 featuredCardTitle2 featuredCardDescription2 siteMaintainanceMode');
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
