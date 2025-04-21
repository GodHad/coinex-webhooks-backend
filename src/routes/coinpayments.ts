import express from 'express';
import User from '../models/User';
import { getSocketIOInstance } from '../utils/socket';

const router = express.Router();

router.post('/callback', async (req, res) => {
    try {
        const invoiceStatus = req.body;
        const user = await User.findOne({ invoiceID: invoiceStatus.invoice.id });
        if (!user) return res.status(404).json({ message: 'User not found' });

        const io = getSocketIOInstance();
        io.to(`invoice-${user.invoiceID}`).emit('invoiceStatusUpdate', {
            invoiceId: user.invoiceID,
            status: invoiceStatus.type,
        });

        console.log(invoiceStatus);

        if (user.invoiceStatus === 'InvoicePaid' && invoiceStatus.type === 'InvoiceCompleted') {
            const currentDate = new Date();
            if (user.requestedPlan === 'Standard') {
                user.subscribed = 1;
                currentDate.setMonth(currentDate.getMonth() + 1);
                user.subscribeEndDate = currentDate;
            } else if (user.requestedPlan === 'Premium') {
                user.subscribed = 2;
                currentDate.setFullYear(currentDate.getFullYear() + 1);
                user.subscribeEndDate = currentDate;
            }
            user.requestedAmount = null;
            user.requestedPaymentMethod = null;
            user.requestedPlan = null;
            await user.save();
        } else {
            await user.updateOne({ invoiceStatus: invoiceStatus.type });
        }

        return res.status(200).json({ message: 'success' });
    } catch (error) {
        console.error(error);
        return res.status(400).json({ message: 'Hey I got error' });
    }
});

export default router;