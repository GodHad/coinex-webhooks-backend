import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User';
import jwt from 'jsonwebtoken';
import { jwtAuth } from '../middleware/authorization';
import { JWTRequest } from '../types/JWTRequest';
import { isValidUsername } from './admin';

const router = express.Router();

router.post('/register', async (req: Request, res: Response) => {
    const { email, password, inviteCode } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'You don\'t have the permission to access.' });
        }

        if (user.status) return res.status(400).json({message: 'You already registered. Please login'});

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Password is incorrect' });
        }

        if (inviteCode !== user.inviteCode) return res.status(400).json({ message: 'Invite code is incorrect' });

        user.status = 1;

        await user.save();
        const token = jwt.sign({ userId: user._id }, 'secret', { expiresIn: '1h' });

        res.status(200).json({
            message: 'Register successful',
            user: user,
            token
        });
    } catch (error) {
        console.log("Failed to register user: ", error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/login', async (req: Request, res: Response) => {
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'Password is incorrect' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign({ userId: user._id }, 'secret', { expiresIn: '1h' });

        res.status(200).json({
            message: 'Login successful',
            token,
            user
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/login-with-jwt', jwtAuth, async (req: JWTRequest, res) => {
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

router.post('/update-user', jwtAuth, async (req: JWTRequest, res) => {
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
            if (!isValidUsername(email)) {
                return res.status(400).json({ message: 'Username can only contain lowercase letters and numbers, with no spaces.' });
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


export default router;

