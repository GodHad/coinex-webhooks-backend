import { NextFunction, Request, Response } from "express"
import jwt from 'jsonwebtoken'

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

export interface AuthRequest extends Request {
    user?: any;
}
