import { Request } from "express";

export interface JWTRequest extends Request {
    user?: {
        userId: string;
    }
}