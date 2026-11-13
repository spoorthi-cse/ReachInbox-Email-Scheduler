
import 'dotenv/config';
import { Worker, DelayedError } from 'bullmq';
import { connection } from './queue';
import { prisma } from './db';
import { getTransporter, getSenderAddress } from './mailer';
import nodemailer from 'nodemailer';

const MAX_EMAILS_PER_HOUR = Number(
  process.env.MAX_EMAILS_PER_HOUR || 100
);

const RATE_LIMIT_DURATION_MS = Number(
  process.env.RATE_LIMIT_DURATION_MS || 3600000
);

const MIN_SEND_INTERVAL_MS = Number(
  process.env.MIN_SEND_INTERVAL_MS || 10000
);

const WORKER_CONCURRENCY = Number(
  process.env.WORKER_CONCURRENCY || 5
);

const spacingScript = `
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local nextAllowed = tonumber(redis.call('GET', KEYS[1]) or '0')
local interval = tonumber(ARGV[1])

if now >= nextAllowed then
  redis.call('SET', KEYS[1], now + interval)
  redis.call('PEXPIRE', KEYS[1], interval * 2 + 60000)
  return 0
end

return nextAllowed - now
`;

async function reserveSendingSlot(): Promise<number> {
  if (MIN_SEND_INTERVAL_MS === 0) {
    return 0;
  }

  const waitTime = await connection.eval(
    spacingScript,
    1,
    'reachinbox:email:next-send',
    MIN_SEND_INTERVAL_MS
  );

  return Number(waitTime);
}

const worker = new Worker(
  'email-scheduler',
  async job => {
    const email = await prisma.email.findUnique({
      where: { id: job.data.emailId }
    });

    if (
      !email ||
      email.status === 'sent' ||
      email.status === 'cancelled' ||
      email.status === 'failed'
    ) {
      console.log(`Skipping email ${job.data.emailId}`);
      return;
    }

    const senderId = email.senderId || 'sender-1';

    const waitTime = await reserveSendingSlot();

    if (waitTime > 0) {
      await job.moveToDelayed(Date.now() + waitTime, job.token);
      throw new DelayedError();
    }

    try {
      const mailer = await getTransporter(senderId);
      const senderAddress = getSenderAddress(senderId);

      const info = await mailer.sendMail({
        from: `ReachInbox <${senderAddress}>`,
        to: email.recipient,
        subject: email.subject,
        text: email.body
      });

      const preview = nodemailer.getTestMessageUrl(info);

      await prisma.email.update({
        where: { id: email.id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          error: null
        }
      });

      console.log(`Email sent to ${email.recipient} using ${senderId}`);
      console.log(`Ethereal preview: ${preview || 'Unavailable'}`);

    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      const maxAttempts = job.opts.attempts ?? 1;
      const isFinalAttempt =
        job.attemptsMade + 1 >= maxAttempts;

      if (isFinalAttempt) {
        await prisma.email.update({
          where: { id: email.id },
          data: {
            status: 'failed',
            error: message
          }
        });

        console.error(
          `Email permanently failed after ${maxAttempts} attempts: ${email.recipient}`,
          message
        );
      } else {
        console.error(
          `Email attempt ${job.attemptsMade + 1}/${maxAttempts} failed. BullMQ will retry: ${email.recipient}`,
          message
        );
      }

      throw error;
    }
  },
  {
    connection,
    concurrency: WORKER_CONCURRENCY,
    limiter: {
      max: MAX_EMAILS_PER_HOUR,
      duration: RATE_LIMIT_DURATION_MS
    }
  }
);

worker.on('completed', job => {
  console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, error) => {
  console.error(`Job ${job?.id} failed:`, error.message);
});

worker.on('error', error => {
  console.error('Worker error:', error);
});

console.log('Email worker started');
console.log(`Hourly limit: ${MAX_EMAILS_PER_HOUR}`);
console.log(`Minimum interval: ${MIN_SEND_INTERVAL_MS} ms`);
console.log(`Worker concurrency: ${WORKER_CONCURRENCY}`);

// Graceful shutdown for Railway deployments
let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) return;

  isShuttingDown = true;
  console.log(`${signal} received. Shutting down email worker...`);

  try {
    // Stop accepting new jobs and wait for active jobs to finish.
    await worker.close();

    // Close Redis and database connections.
    await connection.quit();
    await prisma.$disconnect();

    console.log('Email worker shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('Worker shutdown error:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
