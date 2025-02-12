import { NextFunction, Request, Response } from "express";
import AdminData from "../models/AdminData";

const webhooksMaintenanceMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const adminData = await AdminData.findOne();

        if (!adminData || adminData.webhooksMaintainanceMode) {
            return res.status(503).json({
                success: false,
                message: "The site is currently under maintenance. Please try again later.",
            });
        }

        next();
    } catch (error) {
        console.error("Error checking maintenance mode:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export default webhooksMaintenanceMiddleware;
