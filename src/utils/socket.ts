import { Server } from "socket.io";
import { Server as HttpServer } from "node:http";
import dotenv from 'dotenv';

let io: Server;


dotenv.config();

const frontendURL = process.env.FRONTEND_URL;

const websocketServer = (server: HttpServer) => {
    const io = new Server(server, {
        cors: { origin: '*', methods: ['GET', 'POST'] }
    });

    io.on('connection', (socket) => {
        console.log('Scoket connected: ', socket.id);

        socket.on('subscribeToInvoice', async (invoiceID) => {
            socket.join(`invoice-${invoiceID}`);
        });

        socket.on('disconnect', () => {
            console.log('Socket disconnected: ', socket.id);
        })
    });

    return { io };
}

export default websocketServer;

export const setSocketIOInstance = (instance: Server) => {
    io = instance;
};

export const getSocketIOInstance = (): Server => {
    if (!io) throw new Error('Socket.io instance not set');
    return io;
};