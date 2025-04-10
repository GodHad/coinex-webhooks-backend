import { createServer } from "http";
import express from 'express';
import cors from 'cors';

import { init } from "./db/dbConnection";
import authRoutes from './routes/auth';
import hooksRoutes from './routes/hooks';
import webhooksRoutes from './routes/webhooks';
import historyRoutes from './routes/histories';
import userRoutes from './routes/users';
import adminRoutes from './routes/admin';
import p2pRoutes from './routes/p2p';

import './cron/cronJobs';
require("dotenv").config("../.env");

const app = express();
const PORT = process.env.PORT || 5050;

app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/auth', authRoutes);
app.use('/api/hooks', hooksRoutes);
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/histories', historyRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/p2p', p2pRoutes);

const startServer = async () => {
    try {
        await init()
        const server = createServer(app);
        server.listen(PORT, () => {
            console.log('App is running at http://localhost:%d in %s mode', PORT, app.get('env'));
        })
    } catch (error) {
        console.log('Failed to start the server: ', error);
        process.exit(1);
    }
}

startServer();