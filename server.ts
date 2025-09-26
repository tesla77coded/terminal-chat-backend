import express, { Application, Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import prisma from './config/prisma';
import http from 'http';
import { initializeWebSocket } from './socket/socket';
import internalKeepalive from './routes/internalKeepalive';
import userRoutes from './routes/userRoutes';
import messageRoutes from './routes/messageRoutes'

dotenv.config();

export const app: Application = express();
const PORT = process.env.PORT || 5050;

app.use(cors());

app.use(express.json());

// Basic test route
app.get('/', (req: Request, res: Response) => {
  res.send('Terminal Chat Backend API is running!..🚀');
});

app.get('/test-db-connection', async (req: Request, res: Response) => {
  try {
    await prisma.$connect();
    res.status(200).json({ message: 'Connection to database successfull!. ✅' });
  } catch (error) {
    console.error('Error while connecting to database. ');
    res.status(500).json({ message: 'database connection failed.❌', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// app.get('/', (req, res) => {
//   res.send('Server is running and ready for WebSocket connections.');
// })

// api routes
app.use('/internal', internalKeepalive);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);

export const server = http.createServer(app);
initializeWebSocket(server);
server.listen(PORT, () => {
  console.log(`Server running on port: http://localhost:${PORT}`);
});
