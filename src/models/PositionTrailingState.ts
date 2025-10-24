import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { IHook } from './Hook';

export type TrailingSide = 'long' | 'short';
export type TrailingType = 'percentage' | 'fixed' | 'atr' | 'volatility';

export interface IPositionTrailingState extends Document {
    hook: Types.ObjectId | IHook;
    positionId: string;
    market: string;
    side: TrailingSide;
    entryPrice?: number;
    currentPrice?: number;
    minProfitThreshold: number;
    trailDistance: number;
    trailType: TrailingType;
    isEnabled: boolean;
    autoApplied: boolean;
    highestPrice?: number;
    currentStopLoss?: number;
    lastCheckedAt?: Date;
    isOpen: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const PositionTrailingStateSchema = new Schema<IPositionTrailingState>({
    hook: { type: Schema.Types.ObjectId, ref: 'Hook', required: true, index: true },
    positionId: { type: String, required: true },
    market: { type: String, required: true },
    side: { type: String, enum: ['long', 'short'], required: true },
    entryPrice: { type: Number },
    currentPrice: { type: Number },
    minProfitThreshold: { type: Number, default: 2.0 },
    trailDistance: { type: Number, default: 1.5 },
    trailType: { type: String, enum: ['percentage', 'fixed', 'atr', 'volatility'], default: 'percentage' },
    isEnabled: { type: Boolean, default: false },
    autoApplied: { type: Boolean, default: false },
    highestPrice: { type: Number },
    currentStopLoss: { type: Number },
    lastCheckedAt: { type: Date },
    isOpen: { type: Boolean, default: true, index: true },
}, { timestamps: true });

PositionTrailingStateSchema.index({ hook: 1, positionId: 1 }, { unique: true });

export const PositionTrailingState: Model<IPositionTrailingState> =
    mongoose.models.PositionTrailingState ||
    mongoose.model<IPositionTrailingState>('PositionTrailingState', PositionTrailingStateSchema);

export default PositionTrailingState;
