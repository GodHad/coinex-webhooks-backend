import mongoose, {Document, Schema, model} from 'mongoose';

export interface IPositionHistory extends Document {
    hook: mongoose.Schema.Types.ObjectId;
    data: any;
    finished: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const PositionHistorySchma = new Schema<IPositionHistory>({
    hook: { type: mongoose.Schema.Types.ObjectId, ref: 'Hook', required: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    finished: { type: Boolean, required: true }
}, { timestamps: true });

const PositionHistory = model('PositionHistory', PositionHistorySchma);

export default PositionHistory;