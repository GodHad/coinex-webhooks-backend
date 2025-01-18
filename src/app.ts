import { createServer } from "http";
import express from 'express';
import cors from 'cors';
import { init } from "./db/dbConnection";
import authRoutes from './routes/user';
import hooksRoutes from './routes/hooks';
import webhooksRoutes from './routes/webhooks';

const app = express();
const PORT = 5000;

app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/auth', authRoutes);
app.use('/api/hooks', hooksRoutes);
app.use('/api/webhooks', webhooksRoutes);

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