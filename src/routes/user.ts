import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User';
import jwt from 'jsonwebtoken';
import { jwtAuth } from '../middleware/authorization';
import { JWTRequest } from '../types/JWTRequest';

const router = express.Router();

function isValidUsername(username: string) {
    const usernameRegex = /^[a-z0-9]+$/;
    return usernameRegex.test(username);
}

router.post('/register', async (req: Request, res: Response) => {
    const { firstName, lastName, email, password } = req.body;
    if (isValidUsername(email)) {
        return res.status(400).json({ message: 'Username can only contain lowercase letters and numbers, with no spaces.' });
    }
    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({
            firstName,
            lastName,
            email,
            password: hashedPassword
        });

        await newUser.save();

        const token = jwt.sign({ userId: newUser._id }, 'secret', { expiresIn: '1h' });

        res.status(201).json({
            message: 'User registered successfully',
            token,
            user: newUser
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
            return res.status(400).json({ message: 'Invalid credentials' });
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
        const user = await User.findById(userId);

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
            if (isValidUsername(email)) {
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

