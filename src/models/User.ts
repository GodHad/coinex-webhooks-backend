// models/User.js
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
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

const User = mongoose.model('User', userSchema);

export default User;