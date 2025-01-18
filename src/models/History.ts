import mongoose from 'mongoose';

const HistorySchma = new mongoose.Schema({
    hook: { type: mongoose.Schema.Types.ObjectId, ref: 'Hook', required: true },
    symbol: { type: String, required: true },
    action: { type: String, required: true },
    amount: { type: Number, required: true },
    status: { type: Boolean, required: true },
}, { timestamps: true });

const History = mongoose.model('History', HistorySchma);

export default History;