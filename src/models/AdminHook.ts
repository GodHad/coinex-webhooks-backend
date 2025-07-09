// models/AdminHook.js
import mongoose from 'mongoose';
import { Document } from 'mongoose';

export interface IAdminHook extends Document {
    pair: string;
    url: string;
    alertName: string;
    timeframe: string;
    recommendedLeverage: string;
    enabled: boolean;
}

const adminHookSchema = new mongoose.Schema<IAdminHook>(
    {
        pair: { type: String, required: true },
        url: { type: String, required: true },
        alertName: { type: String, required: true },
        timeframe: { type: String, required: true },
        recommendedLeverage: { type: String, required: true },
        enabled: { type: Boolean, required: true },
    },
    { timestamps: true }
);

const AdminHook = mongoose.model('AdminHook', adminHookSchema);

export default AdminHook;