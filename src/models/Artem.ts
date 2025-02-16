// models/ArtemHistory.js
import mongoose from 'mongoose';

const artemSchema = new mongoose.Schema(
    {
        action: { type: String, required: true },
        size: { type: String, required: true },
        coinpair: { type: String, required: true },
        data: { type: mongoose.Schema.Types.Mixed },
    },
    { timestamps: true }
);

const ArtemHistory = mongoose.model('ArtemHistory', artemSchema);

export default ArtemHistory;