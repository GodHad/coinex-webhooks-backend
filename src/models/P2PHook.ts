// models/P2PHook.js
import mongoose from 'mongoose';

const p2PHookSchema = new mongoose.Schema(
    {
        creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        name: { type: String, required: true },
        description: { type: String },
        pair: { type: String, required: true },
        timeframe: { type: String },
        type: { type: String, enum: ['Technical', 'Trend Following', 'Scalping', 'Mean Reversion', 'Breakout', 'Custom'], required: true },
        riskLevel: { type: String, enum: ['High', 'Medium', 'Low'] },
        url: { type: String, required: true },
        subscriptionFee: { type: Number, required: true },
        tags: { type: String, required: true },
        imageUrl: { type: String, required: true },
        status: { type: Number, default: 0 },
    },
    { timestamps: true }
);

const P2PHook = mongoose.model('P2PHook', p2PHookSchema);

export default P2PHook;