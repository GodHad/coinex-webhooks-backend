import mongoose, { Document, Types } from 'mongoose';

interface IHistory extends Document {
  hook: Types.ObjectId | {
    _id: Types.ObjectId;
    adminHook?: Types.ObjectId;
  };
  symbol: string;
  action: string;
  amount: string;
  status: boolean;
  data: any;
  error: any;
  positionState?: string;
  tradeDirection?: string;
  isResended?: boolean;
  createdAt: Date;
}

const HistorySchma = new mongoose.Schema({
  hook: { type: mongoose.Schema.Types.ObjectId, ref: 'Hook', required: true },
  symbol: { type: String, required: true },
  action: { type: String, required: true },
  amount: { type: String, required: true },
  status: { type: Boolean, required: true },
  data: { type: mongoose.Schema.Types.Mixed },
  error: { type: mongoose.Schema.Types.Mixed },
  positionState: { type: String },
  tradeDirection: { type: String },
  isResended: { type: Boolean },
}, { timestamps: true });

const History = mongoose.model('History', HistorySchma);

export default History;