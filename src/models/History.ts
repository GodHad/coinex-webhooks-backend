import mongoose from 'mongoose';

const HistorySchma = new mongoose.Schema({
    hook: { type: mongoose.Schema.Types.ObjectId, ref: 'Hook', required: true },
    symbol: { type: String, required: true },
    action: { type: String, required: true },
    amount: { type: String, required: true },
    status: { type: Boolean, required: true },
    data: { type: mongoose.Schema.Types.Mixed },
    error: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

const History = mongoose.model('History', HistorySchma);

export default History;