// models/Hook.js
import mongoose, { Document, Schema } from 'mongoose';
import { IUser } from './User';

interface IHook extends Document {
    creator: IUser | mongoose.Types.ObjectId;
    adminHook?: mongoose.Types.ObjectId;
    name: string;
    url?: string;
    amount?: string;
    coinExApiKey: string;
    coinExApiSecret: string;
    status: number;
    positionState: string;
    tradeDirection: string;
    isSubscribed: boolean;
}

const hookSchema = new Schema<IHook>(
    {
        creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        adminHook: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminHook' },
        name: { type: String, required: true },
        url: { type: String },
        amount: { type: Number },
        coinExApiKey: { type: String, required: true },
        coinExApiSecret: { type: String, required: true },
        status: { type: Number, default: 0 },
        positionState: { type: String, default: 'neutral' },
        tradeDirection: { type: String, enum: ["BOTH", "LONG_ONLY", "SHORT_ONLY"], default: "BOTH" },
        isSubscribed: { type: Boolean, default: false }
    },
    { timestamps: true }
);

const Hook = mongoose.model<IHook>('Hook', hookSchema);

export default Hook;