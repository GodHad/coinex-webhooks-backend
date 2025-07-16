import { NextFunction, Request, Response } from "express"
import jwt, { JwtPayload } from 'jsonwebtoken';
import User from "../models/User";

export const jwtAuth = (req: AuthRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.header('Authorization');
    const token = authHeader ? authHeader.replace('Bearer ', '') : null;
    if (!token) {
        res.status(400).json({ message: 'Token is required' });
        return;
    }
    try {
        jwt.verify(token, 'secret', (err, decoded) => {
            if (err) {
                return res.status(401).json({ message: 'Failed to authenticate token' });
            }

            req.user = decoded;
            next();
        });

    } catch (error) {
        res.status(401).json({ msg: "Token is not valid" });
    }
}

export const adminAuth = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.header('Authorization');
    const token = authHeader ? authHeader.replace('Bearer ', '') : null;
    if (!token) {
        res.status(400).json({ message: 'Token is required' });
        return;
    }
    try {
        const decoded = jwt.verify(token, 'secret') as ExtendedJWTPayload;
        if (!decoded || !decoded.userId) {
            res.status(401).json({ message: 'Failed to authenticate token', decoded });
            return;
        }

        const user = await User.findById(decoded.userId);
        if (!user || (!user.isAdmin && !user.isSubAdmin)) {
            res.status(403).json({ message: 'You don\'t have permission for admin' });
            return;
        }

        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ msg: "Token is not valid" });
    }
}

export interface AuthRequest extends Request {
    user?: any;
}

export interface ExtendedJWTPayload extends JwtPayload {
    userId?: string;
}