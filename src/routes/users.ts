import express from 'express';
import { adminAuth, jwtAuth } from '../middleware/authorization';
import User from '../models/User';
import Hook from '../models/Hook';
import { JWTRequest } from '../types/JWTRequest';
import AdminData from '../models/AdminData';
import PositionHistory, { IPositionHistory } from '../models/PositionHistory';
import { createCoinPaymentsInvoice, getInvoiceByPaymentMethod } from '../utils/coinpaymentsUtils';
import generateQRCode from '../utils/qrCodeUtils';
import path from 'node:path';
import fs from 'node:fs';

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
        const uniqueHooksMap = new Map();

        hooks.forEach(hook => {
            const key = `${hook.coinExApiKey}::${hook.coinExApiSecret}`;
            if (!uniqueHooksMap.has(key)) {
                uniqueHooksMap.set(key, hook);
            }
        });

        const uniqueHooks = Array.from(uniqueHooksMap.values());

        const standardHooks = uniqueHooks.filter(hook => !hook.adminHook);
        const premiumHooks = uniqueHooks.filter(hook => hook.adminHook);

        const positionHistories = await PositionHistory.find({ hook: { $in: uniqueHooks.map(h => h._id) } });
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
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());

        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const today = new Date().toISOString().split('T')[0];

        const todayPnl = positionHistories.filter(h => !h.finished).reduce((sum, history) => {
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
                const historyDate = new Date(parseInt(history.data.created_at));

                const pnl = parseFloat(history.data.realized_pnl);

                if (historyDate >= startOfWeek) {
                    acc.weekly += pnl;
                }
                if (historyDate >= startOfMonth) {
                    acc.monthly += pnl;
                }
                acc.allTime += pnl;
            }
            return acc;
        }, { daily: todayPnl, weekly: 0, monthly: 0, allTime: 0 });

        const calcRiskFromPositions = (positions: IPositionHistory[]) => {
            return positions
                .filter(p => !p.finished && p.data?.margin_avbl && p.data?.maintenance_margin_value)
                .reduce((sum, p) => {
                    return sum + (parseFloat(p.data.margin_avbl) - parseFloat(p.data.maintenance_margin_value));
                }, 0);
        };

        const totalRisk = calcRiskFromPositions(positionHistories);
        const standardTotalRisk = calcRiskFromPositions(standardPositionHistories);
        const premiumTotalRisk = calcRiskFromPositions(premiumPositionHistories);

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

        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - 30);

        const hooks = await Hook.find({ creator: userId });
        const uniqueHooksMap = new Map();

        hooks.forEach(hook => {
            const key = `${hook.coinExApiKey}::${hook.coinExApiSecret}`;
            if (!uniqueHooksMap.has(key)) {
                uniqueHooksMap.set(key, hook);
            }
        });

        const uniqueHooks = Array.from(uniqueHooksMap.values());

        const positionHistories = await PositionHistory.find({
            hook: { $in: uniqueHooks.map(h => h._id) },
            'data.created_at': { $gte: start.getTime(), $lte: end.getTime() }
        });

        const standardHooks = uniqueHooks.filter(hook => !hook.adminHook);
        const premiumHooks = uniqueHooks.filter(hook => hook.adminHook);

        const initialData = Array.from({ length: 30 }, (_, i) => {
            const dateKey = new Date(end.getTime() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            return { [dateKey]: 0 };
        }).reduce((acc, obj) => ({ ...acc, ...obj }), {});

        const groupPnlByDate = (histories: any[], hooks: any[]) => {
            return histories.reduce((acc, history) => {
                if (history.data?.realized_pnl) {
                    const historyDate = new Date(parseInt(history.data.created_at)).toISOString().split('T')[0];
                    const pnl = parseFloat(history.data.realized_pnl);

                    if (hooks.some(hook => hook._id.equals(history.hook))) {
                        acc[historyDate] = (acc[historyDate] || 0) + pnl;
                    }
                }
                return acc;
            }, { ...initialData });
        };

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
        const adminData = await AdminData.findOne({}, 'mainTitle subTitle featuredCardTitle featuredCardDescription featuredCardTitle1 featuredCardDescription1 featuredCardTitle2 featuredCardDescription2 siteMaintainanceMode totalPremiumSignals totalBalance totalTrades averageWinRate averageProfit totalPNL');
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
});

router.post('/request-subscription', jwtAuth, async (req: JWTRequest, res) => {
    try {
        const { plan, symbol, amount } = req.body;

        if (plan === 'Premium') {
            if (Number(amount) !== 49 && Number(amount) !== 490) return res.status(405).json({ message: 'Invalid arguments' });
        } else if (plan === 'Standard') {
            if (Number(amount) !== 19 && Number(amount) !== 190) return res.status(405).json({ message: 'Invalid arguments' });
        } else if (symbol !== 'BTC' && symbol !== 'ETH' && symbol !== 'SOL') {
            return res.status(405).json({ message: 'Invalid arguments' });
        }

        const userId = req.user?.userId;
        const user = await User.findById(userId);

        if (!user) return res.status(404).json({ message: 'User not found' });

        await user.updateOne({ requestedPlan: plan, requestedAmount: amount, requestedPaymentMethod: symbol });

        if (user.invoiceID) {
            const imagePath = `/uploads/${user.invoiceID}.png`;
            const oldPath = path.join(__dirname, '../../../coinex-new-frontend/public', imagePath);
            fs.existsSync(oldPath) && fs.unlinkSync(oldPath);
        }

        const result = await createCoinPaymentsInvoice('USD', amount, symbol, user.email);
        if (!result.success) return res.status(400).json({ message: result.message });

        await user.updateOne({ invoiceID: result.data.invoices[0].id });

        const result1 = await getInvoiceByPaymentMethod(result.data.invoices[0].id, symbol);
        if (!result1.success) return res.status(400).json({ message: result.message });

        const url = await generateQRCode({
            filename: result.data.invoices[0].id ?? 'test', 
            address: result1.data.addresses.address,
            currency: symbol,
            amount: Number(result1.data.amount.displayValue),
            imageUrl: result1.data.currency.logo.imageUrl,
        });

        return res.status(200).json({
            success: true,
            invoiceID: result.data.invoices[0].id,
            url,
            rate: result1.data.amount.rate,
            display: result1.data.amount.displayValue,
            address: result1.data.addresses.address,
            expires: result1.data.expires,
        });
    } catch (error) {
        console.error("Error request subscription: ", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;
