// models/PremiumHook.js
import mongoose, { Document, Types } from 'mongoose';
import { IAdminHook } from './AdminHook';
import { IUser } from './User';

export interface IPremiumHook extends Document {
    creator: Types.ObjectId | IUser;
    name: string;
    description: string;
    imageUrl: string;
    riskLevel: 'High' | 'Medium' | 'Low';
    color: string;
    iconType: string;
    pairs: [Types.ObjectId] | [IAdminHook]
}

const premiumHookSchema = new mongoose.Schema(
    {
        creator: { type: Types.ObjectId, ref: 'User', required: true },
        name: { type: String, required: true },
        description: { type: String },
        imageUrl: { type: String, required: true },
        riskLevel: { type: String, enum: ['High', 'Medium', 'Low'] },
        color: { type: String },
        iconType: { type: String },
        pairs: { type: [Types.ObjectId], ref: 'AdminHook', default: [] },
    },
    { timestamps: true }
);

premiumHookSchema.methods.getCreator = function () {
    return this.model('User').findById(this.creator);
}

premiumHookSchema.methods.getPairs = function () {
    return this.model('AdminHook').find({ _id: { $in: this.pairs } });
}

const PremiumHook = mongoose.model('PremiumHook', premiumHookSchema);

export default PremiumHook;