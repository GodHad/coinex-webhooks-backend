import mongoose, { Document, Types } from 'mongoose';

export interface IHistory extends Document {
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
  resendStatus?: boolean;
  resendResult?: any;
  resendError?: any;
  createdAt: Date;
}

const historySchema = new mongoose.Schema<IHistory>({
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
  resendResult: { type: mongoose.Schema.Types.Mixed },
  resendError: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

historySchema.methods.getHook = function () {
  return this.model('Hook').findById(this.hook);
}

const History = mongoose.model('History', historySchema);

export default History;