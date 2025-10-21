import mongoose, { Schema, Types, Model, Document } from 'mongoose';
import { IUser } from './User';

export interface ITrailingConfig {
    minProfitThreshold: number;
    trailDistance: number;
    trailType: 'percentage' | 'fixed' | 'atr' | 'volatility';
}

export interface IHook extends Document {
    creator: IUser | Types.ObjectId;
    adminHook?: Types.ObjectId;
    name: string;
    url?: string;

    amount?: number;
    unit?: string;

    coinExApiKey: string;
    coinExApiSecret: string;

    status: number;
    positionState: string;
    tradeDirection: 'BOTH' | 'LONG_ONLY' | 'SHORT_ONLY';

    defaultLeverage?: number;
    defaultPositionType?: 1 | 2;
    autoApplySettings?: boolean;
    enableAutoTrailing?: boolean;
    trailingConfig?: ITrailingConfig;

    isSubscribed: boolean;
    leverage?: string;
    entryPrice?: string;
    stopLossPrice?: string | null;
    takeProfitPrice?: string | null;
    currentPrice?: string;

    balance: {
        total: number | null;
        available: number | null;
        inPosition: number | null;
    } | null;

    lastRetrieveTime: number;
}

const TrailingConfigSchema = new Schema<ITrailingConfig>({
    minProfitThreshold: { type: Number, default: 2.0 },
    trailDistance: { type: Number, default: 1.5 },
    trailType: { type: String, enum: ['percentage', 'fixed', 'atr', 'volatility'], default: 'percentage' },
}, { _id: false });

const hookSchema = new Schema<IHook>({
    creator: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    adminHook: { type: Schema.Types.ObjectId, ref: 'AdminHook', default: null, index: true },

    name: { type: String, required: true },
    url: { type: String },

    amount: { type: Number },
    unit: { type: String },

    coinExApiKey: { type: String, required: true },
    coinExApiSecret: { type: String, required: true },

    status: { type: Number, default: 0 },
    positionState: { type: String, default: 'neutral' },

    tradeDirection: { type: String, enum: ['BOTH', 'LONG_ONLY', 'SHORT_ONLY'], default: 'BOTH' },

    defaultLeverage: { type: Number, min: 1, max: 100, default: 2 },
    defaultPositionType: { type: Number, enum: [1, 2], default: 1 },
    autoApplySettings: { type: Boolean, default: true },
    enableAutoTrailing: { type: Boolean, default: false },
    trailingConfig: { type: TrailingConfigSchema, default: () => ({}) },

    isSubscribed: { type: Boolean, default: false },
    leverage: { type: String },
    entryPrice: { type: String },
    stopLossPrice: { type: String, default: null },
    takeProfitPrice: { type: String, default: null },
    currentPrice: { type: String },

    balance: {
        type: {
            total: { type: Number, default: null },
            available: { type: Number, default: null },
            inPosition: { type: Number, default: null },
        },
        default: null,
    },

    lastRetrieveTime: { type: Number, default: 0 },
}, { timestamps: true });

hookSchema.methods.getCreator = function () {
    return this.model('User').findById(this.creator);
};

hookSchema.methods.getAdminHook = function () {
    if (!this.adminHook) return null;
    return this.model('AdminHook').findById(this.adminHook);
};

const Hook: Model<IHook> =
    (mongoose.models.Hook as Model<IHook>) || mongoose.model<IHook>('Hook', hookSchema);

export default Hook;
