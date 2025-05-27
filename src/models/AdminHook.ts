// models/AdminHook.js
import mongoose from 'mongoose';
import { Document } from 'mongoose';

export interface IAdminHook extends Document {
    pair: string;
    url: string;
}

const adminHookSchema = new mongoose.Schema<IAdminHook>(
    {
        pair: { type: String, required: true },
        url: { type: String, required: true },
    },
    { timestamps: true }
);

const AdminHook = mongoose.model('AdminHook', adminHookSchema);

export default AdminHook;