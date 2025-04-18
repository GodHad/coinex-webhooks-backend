// models/User.js
import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    subscribed: number;
    subscribeEndDate?: Date;
    isAdmin: boolean;
    inviteCode?: string;
    status: number;
    otp: string | null;
    otpExpires: Date | null;
    balance: {
        total: number | null;
        available: number | null;
        inPosition: number | null;
    } | null;
    activeAccount: number | null;
    requestedPlan: string | null;
    requestedAmount: number | null;
    requestedPaymentMethod: string | null;
    invoiceID: string | null;
    invoiceStatus: string | null;
    createdAt: Date;
    updatedAt: Date;
}

const userSchema = new Schema<IUser>(
    {
        firstName: { type: String, required: true },
        lastName: { type: String, required: true },
        email: { type: String, required: true, unique: true },
        password: { type: String, required: true },
        subscribed: { type: Number, default: 0 },
        subscribeEndDate: { type: Date },
        isAdmin: { type: Boolean, default: false },
        status: { type: Number, default: 0 },
        otp: { type: String, default: null },
        otpExpires: { type: Date, default: null },
        activeAccount: { type: Number, default: null },
        balance: {
            type: {
                total: { type: Number, default: null },
                available: { type: Number, default: null },
                inPosition: { type: Number, default: null },
            },
            default: null,
        },
        requestedPlan: { type: String, default: null },
        requestedAmount: { type: Number, default: null },
        requestedPaymentMethod: { type: String, default: null },
        invoiceID: { type: String, default: null },
        invoiceStatus: { type: String, default: null },
    },
    { timestamps: true }
);

const User = mongoose.model<IUser>('User', userSchema);

export default User;
