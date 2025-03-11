import mongoose from 'mongoose';

const PositionHistorySchma = new mongoose.Schema({
    hook: { type: mongoose.Schema.Types.ObjectId, ref: 'Hook', required: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    finished: { type: Boolean, required: true }
}, { timestamps: true });

const PositionHistory = mongoose.model('PositionHistory', PositionHistorySchma);

export default PositionHistory;