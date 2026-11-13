
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import validator from 'validator';
import { emailQueue } from './queue';
import { prisma } from './db';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

const app = express();

// CORS configuration for local development and production
const allowedOrigins = (
  process.env.CORS_ORIGIN || 'http://localhost:5173'
)
  .split(',')
  .map(origin => origin.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error('Not allowed by CORS'));
    }
  })
);

app.use(express.json({ limit: '5mb' }));

// Bull Board dashboard
const board = new ExpressAdapter();
board.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter: board
});

app.use('/admin/queues', board.getRouter());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    message: 'ReachInbox API is running'
  });
});

// Get emails by status
app.get('/api/emails', async (req, res) => {
  try {
    const status = String(req.query.status || '');

    const where = [
      'scheduled',
      'sent',
      'failed',
      'cancelled'
    ].includes(status)
      ? { status }
      : {};

    const emails = await prisma.email.findMany({
      where,
      orderBy: { scheduledAt: 'asc' }
    });

    return res.json(emails);
  } catch (err) {
    console.error('Fetch emails error:', err);

    return res.status(500).json({
      error: 'Failed to fetch emails'
    });
  }
});

// Schedule emails
app.post('/api/emails/schedule', async (req, res) => {
  try {
    const {
      recipients,
      subject,
      body,
      startAt,
      delaySeconds = 0,
      senderId = 'sender-1'
    } = req.body as {
      recipients: string[];
      subject: string;
      body: string;
      startAt: string;
      delaySeconds?: number;
      senderId?: string;
    };

    // Validate required fields
    if (
      !Array.isArray(recipients) ||
      recipients.length === 0 ||
      !subject?.trim() ||
      !body?.trim() ||
      !startAt
    ) {
      return res.status(400).json({
        error: 'recipients, subject, body and startAt are required'
      });
    }

    // Validate sender
    if (!['sender-1', 'sender-2'].includes(senderId)) {
      return res.status(400).json({
        error: 'Invalid sender. Choose sender-1 or sender-2.'
      });
    }

    // Validate sender credentials
    const senderUser =
      senderId === 'sender-1'
        ? process.env.ETHEREAL_SENDER1_USER
        : process.env.ETHEREAL_SENDER2_USER;

    const senderPass =
      senderId === 'sender-1'
        ? process.env.ETHEREAL_SENDER1_PASS
        : process.env.ETHEREAL_SENDER2_PASS;

    if (!senderUser || !senderPass) {
      return res.status(400).json({
        error: `SMTP credentials are missing for ${senderId}`
      });
    }

    // Validate scheduled date
    const start = new Date(startAt);

    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({
        error: 'Invalid startAt date'
      });
    }

    // Validate delay
    const delay = Number(delaySeconds);

    if (!Number.isFinite(delay) || delay < 0) {
      return res.status(400).json({
        error: 'delaySeconds must be a non-negative number'
      });
    }

    // Normalize recipients
    const normalizedRecipients = recipients.map(recipient =>
      typeof recipient === 'string' ? recipient.trim() : ''
    );

    // Validate all recipients before saving
    const invalidRecipients = normalizedRecipients.filter(
      recipient =>
        !recipient ||
        recipient.length > 254 ||
        !validator.isEmail(recipient, {
          allow_display_name: false,
          require_tld: true,
          allow_utf8_local_part: false
        })
    );

    if (invalidRecipients.length > 0) {
      return res.status(400).json({
        error:
          'Some recipient email addresses are invalid. Please correct them before scheduling.',
        invalidRecipients
      });
    }

    // Remove duplicate email addresses
    const uniqueRecipients = [
      ...new Map(
        normalizedRecipients.map(recipient => [
          recipient.toLowerCase(),
          recipient
        ])
      ).values()
    ];

    const duplicateCount =
      normalizedRecipients.length - uniqueRecipients.length;

    const delayMs = delay * 1000;
    const results = [];

    // Save emails and add jobs to BullMQ
    for (let i = 0; i < uniqueRecipients.length; i++) {
      const recipient = uniqueRecipients[i];

      const scheduledAt = new Date(
        start.getTime() + i * delayMs
      );

      const record = await prisma.email.create({
        data: {
          recipient,
          subject: subject.trim(),
          body: body.trim(),
          senderId,
          scheduledAt,
          status: 'scheduled'
        }
      });

      await emailQueue.add(
        'send-email',
        { emailId: record.id },
        {
          jobId: record.id,
          delay: Math.max(
            0,
            scheduledAt.getTime() - Date.now()
          ),
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000
          },
          removeOnComplete: false,
          removeOnFail: false
        }
      );

      results.push(record);
    }

    return res.status(201).json({
      count: results.length,
      senderId,
      duplicateCount,
      emails: results
    });
  } catch (err) {
    console.error('Schedule error:', err);

    return res.status(500).json({
      error: 'Failed to schedule emails'
    });
  }
});

// Cancel scheduled email
app.delete('/api/emails/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const email = await prisma.email.findUnique({
      where: { id }
    });

    if (!email) {
      return res.status(404).json({
        error: 'Email not found'
      });
    }

    if (email.status !== 'scheduled') {
      return res.status(400).json({
        error: 'Only scheduled emails can be cancelled'
      });
    }

    const job = await emailQueue.getJob(id);

    if (job) {
      const jobState = await job.getState();

      if (jobState === 'active') {
        return res.status(409).json({
          error: 'Email is already being processed.'
        });
      }

      if (jobState === 'completed') {
        return res.status(409).json({
          error: 'Email has already been sent.'
        });
      }

      await job.remove();
    }

    const updated = await prisma.email.updateMany({
      where: {
        id,
        status: 'scheduled'
      },
      data: {
        status: 'cancelled'
      }
    });

    if (updated.count === 0) {
      return res.status(409).json({
        error: 'Email status changed. Please refresh.'
      });
    }

    return res.json({
      message: 'Email cancelled successfully',
      id
    });
  } catch (err) {
    console.error('Cancel email error:', err);

    return res.status(500).json({
      error: 'Failed to cancel email'
    });
  }
});

// Start API server
const port = Number(process.env.PORT || 4000);

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`ReachInbox API running on port ${port}`);
  console.log('Bull Board: /admin/queues');
});

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`${signal} received. Shutting down API...`);

  server.close(async () => {
    try {
      await emailQueue.close();
      await prisma.$disconnect();

      console.log('API shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('API shutdown error:', error);
      process.exit(1);
    }
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
