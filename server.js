import 'dotenv/config';
import './src/config/passport.js';
import connectDB from './src/config/db.js';

import configNodeEnv from './src/middleware/node-env.js';
import express from 'express';
import homeRoute from './src/routes/index.js';
import userManagement from './src/routes/user/index.js';
import layouts from './src/middleware/layouts.js';
import passport from 'passport';
import path from 'path';
import session from 'express-session';
import { configureStaticPaths } from './src/utils/index.js'
import { notFoundHandler, globalErrorHandler } from './src/middleware/error-handler.js';
import { fileURLToPath } from 'url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mode = process.env.NODE_ENV;
const port = process.env.PORT;


const app = express();

app.use(configNodeEnv);

configureStaticPaths(app);


app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src/views'));

app.set('layout default', 'default');
app.set('layouts', path.join(__dirname, 'src/views/layouts'));
app.use(layouts);


app.use(express.json());

app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'stella-nebula-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

app.use(passport.initialize());
app.use(passport.session());

async function startServer() {
    try {
        await connectDB();
        app.use('/api/user', userManagement);
        app.use('/', homeRoute);

        app.use(notFoundHandler);
        app.use(globalErrorHandler);


        if (mode.includes('dev')) {
            const ws = await import('ws');

            try {
                const wsPort = parseInt(port) + 1;
                const wsServer = new ws.WebSocketServer({ port: wsPort });

                wsServer.on('listening', () => {
                    console.log(`WebSocket server is running on port ${wsPort}`);
                });

                wsServer.on('error', (error) => {
                    console.error('WebSocket server error:', error);
                });
            } catch (error) {
                console.error('Failed to start WebSocket server:', error);
            }
        }


        app.listen(port, async () => {
                console.log(`Server running on http://127.0.0.1:${port}`);
        });

    } catch (error) {
        console.error('Failed to start server due to database connection error:', error);
        process.exit(1);
    }

}

startServer();