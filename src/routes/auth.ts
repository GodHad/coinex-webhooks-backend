import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import { jwtAuth } from '../middleware/authorization';
import { JWTRequest } from '../types/JWTRequest';
import { isValidEmail } from './admin';
import siteMaintenanceMiddleware from '../middleware/siteMaintainance';
import AdminData from '../models/AdminData';
import { sendEmail } from '../utils/sendMail';
require('dotenv').config();

const router = express.Router();

router.post('/register', siteMaintenanceMiddleware, async (req: Request, res: Response) => {
    try {
        const { firstname, lastname, email, password, confirmPassword } = req.body;

        if (!firstname || !lastname || !email || !password || !confirmPassword) {
            return res.status(400).json({ error: 'All fields are required.' });
        }

        if (password !== confirmPassword) return res.status(400).json({ error: 'Password not matched.' })

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            if (!existingUser.otp || !existingUser.otpExpires || new Date() > new Date(existingUser.otpExpires)) {
                const otp = Math.floor(100000 + Math.random() * 900000).toString();
                const otpExpires = new Date(Date.now() + 300 * 1000); // 5 mins

                existingUser.otp = otp;
                existingUser.otpExpires = otpExpires;
                await existingUser.save();

                await sendEmail(email, 'Your new OTP', `Your OTP is ${otp}. It will expire in 5 minutes.`, '');

                return res.status(200).json({
                    message: 'OTP has been resent to your email.',
                    requiredOtp: true,
                    email: existingUser.email
                });
            }
            return res.status(409).json({ error: 'Email is already registered.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({
            firstName: firstname,
            lastName: lastname,
            email,
            password: hashedPassword,
        });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = new Date(Date.now() + 300 * 1000);

        newUser.otp = otp;
        newUser.otpExpires = otpExpires;
        await newUser.save();

        await sendEmail(email, 'Verify your account', `Your OTP is: ${otp}. It will expire in 5 minutes.`, '');

        return res.status(201).json({
            message: 'User registered. Please verify OTP sent to your email.',
            requiredOtp: true,
            email: newUser.email
        });
    } catch (err) {
        console.error('Error in /register:', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

router.post('/login', async (req: Request, res: Response) => {
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'Password is incorrect' });
        }

        if (!user.status) return res.status(400).json({ message: 'Please request access to login' });
        const adminData = await AdminData.findOne();

        if (adminData?.siteMaintainanceMode && !user.isAdmin) return res.status(400).json({ message: 'Site is currently in maintenance. Please try again later' })

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Password is incorrect' });
        }

        const token = jwt.sign({ userId: user._id }, 'secret', { expiresIn: '1h' });

        res.status(200).json({
            message: 'Login successful.',
            token,
            user
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/verify-otp', async (req: Request, res: Response) => {
    const { email, otp } = req.body;

    try {
        const user = await User.findOne({ email });
        if (!user || user.otp !== otp) {
            return res.status(400).json({ message: 'Invalid OTP' });
        }

        if (user.otpExpires && new Date() > new Date(user.otpExpires)) {
            return res.status(400).json({ message: 'OTP has expired' });
        }

        user.otp = null;
        user.otpExpires = null;
        user.status = 1;
        await user.save();

        const token = jwt.sign({ userId: user._id }, 'secret', { expiresIn: '1h' });

        res.status(200).json({
            message: 'OTP verified. Login successful.',
            token,
            user
        });
    } catch (error) {
        console.error('OTP verify error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/login-with-jwt', siteMaintenanceMiddleware, jwtAuth, async (req: JWTRequest, res) => {
    const userId = req.user?.userId;

    try {
        const newToken = jwt.sign({ userId }, 'secret', { expiresIn: '1h' });
        const user = await User.findByIdAndUpdate(
            userId,
            { $set: { updatedAt: new Date() } },
            { new: true }
        );
        return res.status(200).json({
            message: 'Login successful',
            token: newToken,
            user
        });
    } catch (error) {
        console.error("Error during token verification:", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/update-user', jwtAuth, siteMaintenanceMiddleware, async (req: JWTRequest, res) => {
    const { firstName, lastName, email, password } = req.body;
    try {
        const user = await User.findById(req.user?.userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        let isUpdated = false;

        if (firstName && firstName !== user.firstName) {
            user.firstName = firstName;
            isUpdated = true;
        }
        if (lastName && lastName !== user.lastName) {
            user.lastName = lastName;
            isUpdated = true;
        }
        if (email && email !== user.email) {
            if (!isValidEmail(email)) {
                return res.status(400).json({ message: 'Please type the correct email type.' });
            }
            const existingUser = await User.findOne({ email });
            if (existingUser) {
                return res.status(400).json({ message: 'Email is already exists!' })
            }

            user.email = email;
            isUpdated = true;
        }
        if (password) {
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(password, salt);
            isUpdated = true;
        }

        if (isUpdated) {
            await user.save();
            return res.status(200).json({
                message: 'Update successful',
                user
            });
        } else {
            return res.status(400).json({ message: 'No changes detected' });
        }
    } catch (error) {
        console.error("Error during updating user:", error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post("/verify-otp", async (req, res) => {
    try {
        const { email, otp } = req.body;

        if (!email || !otp) {
            return res.status(400).json({ error: "Email and OTP are required" });
        }

        const user = await User.findOne({ email });

        if (!user || !user.otp || !user.otpExpires) {
            return res.status(401).json({ error: "OTP not found. Request a new one." });
        }

        if (new Date() > user.otpExpires) {
            return res.status(401).json({ error: "OTP expired. Request a new one." });
        }

        if (user.otp !== otp) {
            return res.status(401).json({ error: "Invalid OTP" });
        }

        user.otp = null;
        user.otpExpires = null;
        await user.save();

        const token = jwt.sign({ userId: user._id }, 'secret', { expiresIn: '1h' });

        return res.status(200).json({ message: "OTP verified. Login successful.", token });
    } catch (error) {
        return res.status(404).json({ message: 'Server error' });
    }
});

export default router;
