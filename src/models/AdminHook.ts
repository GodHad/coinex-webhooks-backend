// models/AdminHook.js
import mongoose from 'mongoose';

const adminHookSchema = new mongoose.Schema(
    {
        creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        name: { type: String, required: true },
        pair: { type: String, required: true },
        url: { type: String, required: true },
        timeframe: { type: String },
        description: { type: String },
        ristLevel: { type: String, enum: ['High', 'Medium', ' Low'] },
        recommendedLeverage: { type: String },
    },
    { timestamps: true }
);

const AdminHook = mongoose.model('AdminHook', adminHookSchema);

export default AdminHook;