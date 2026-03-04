import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import limiter from "./config/ratelimiter";
import router from "./routes";
import errorHandler from "./middlewares/errorHandler";
import { ApiError, ApiResponse } from "./utils";
import { StatusCodes } from "http-status-codes";
import morgan from "morgan";
import logger from "./utils/logger";
import cors from "cors";
import mongoose from "mongoose";
import { randomUUID } from "crypto";

const app = express();
const dbStates: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};
const normalizeOrigin = (origin: string): string => origin.trim().replace(/\/$/, '');
const corsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);
const corsAllowlist = new Set(corsOrigins);

if (corsAllowlist.size === 0) {
  logger.warn('CORS_ORIGINS is empty, requests with an Origin header will be blocked');
}

morgan.token('request-id', (req: Request) => (req as any).requestId ?? '-');
morgan.token('safe-url', (req: Request) => {
  const rawUrl = req.originalUrl || req.url || ''
  if (!rawUrl.includes('?')) {
    return rawUrl
  }

  const [path, queryString] = rawUrl.split('?')
  const params = new URLSearchParams(queryString || '')
  if (params.has('token')) {
    params.set('token', '[redacted]')
  }
  return `${path}?${params.toString()}`
});

app.use((req: Request, res: Response, next: NextFunction) => {
  const incomingRequestId = req.header('x-request-id')?.trim();
  const sanitized = incomingRequestId
    ? incomingRequestId.replace(/[^\x20-\x7E]/g, '').slice(0, 128)
    : '';
  const requestId = sanitized || randomUUID();

  (req as any).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});

app.use(morgan(':method :safe-url :status :res[content-length] - :response-time ms [request-id=:request-id]', {
  stream: {
    write: message => {
      logger.info(message.trim());
    }
  }
}));

app.use(helmet());
app.use(limiter);

app.use(cors({
  origin: "*",
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
}));

app.use(express.json());

app.get("/", (req, res) => {
  return res.json(new ApiResponse(StatusCodes.OK, "The Api is running"))
});

app.get('/health/live', (req, res) => {
  return res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Service is live'))
});

app.get('/health/ready', (req, res) => {
  const readyState = mongoose.connection.readyState;
  const databaseState = dbStates[readyState] || 'unknown';
  const responseData = {
    database: {
      state: databaseState,
    },
  };

  if (readyState !== 1) {
    return res
      .status(StatusCodes.SERVICE_UNAVAILABLE)
      .json(new ApiResponse(StatusCodes.SERVICE_UNAVAILABLE, 'Service is not ready', responseData));
  }

  return res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Service is ready', responseData));
});

app.use("/api", router);
app.use(errorHandler);

export default app;
