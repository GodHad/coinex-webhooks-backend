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
}

const userSchema = new Schema<IUser>(
    {
        firstName: { type: String, required: true },
        lastName: { type: String, required: true },
        email: { type: String, required: true },
        password: { type: String, required: true },
        subscribed: { type: Number, default: 0 },
        subscribeEndDate: { type: Date },
        isAdmin: { type: Boolean, default: false },
    },
    { timestamps: true }
);

const User = mongoose.model<IUser>('User', userSchema);

export default User;