// models/Hook.js
import mongoose from 'mongoose';

const hookSchema = new mongoose.Schema(
    {
        creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        adminHook: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminHook' },
        name: { type: String, required: true },
        url: { type: String },
        coinExApiKey: { type: String, required: true },
        coinExApiSecret: { type: String, required: true },
        status: { type: Number, default: 0 },
        positionState: { type: String, default: 'neutral' },
        tradeDirection: { type: String, enum: ["BOTH", "LONG_ONLY", "SHORT_ONLY"], default: "BOTH" },
        isSubscribed: { type: Boolean, default: false }
    },
    { timestamps: true }
);

const Hook = mongoose.model('Hook', hookSchema);

export default Hook;