// models/Hook.js
import mongoose from 'mongoose';

const hookSchema = new mongoose.Schema(
    {
        creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        name: { type: String, required: true },
        url: { type: String, required: true },
        coinExApiKey: { type: String, required: true },
        coinExApiSecret: { type: String, required: true },
        status: { type: Number, default: 0 },
        positionState: { type: String, default: 'neutral' },
        tradeDirection: { type: String, enum: ["BOTH", "LONG_ONLY", "SHORT_ONLY"], default: "BOTH" }
    },
    { timestamps: true }
);

const Hook = mongoose.model('Hook', hookSchema);

export default Hook;