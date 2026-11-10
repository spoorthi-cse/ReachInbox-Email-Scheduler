import { Queue } from 'bullmq';
import IORedis from 'ioredis';
export const connection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT || 6379),
  maxRetriesPerRequest: null
});
export const emailQueue = new Queue('email-scheduler', { connection });
