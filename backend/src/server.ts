
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { emailQueue } from './queue';
import { prisma } from './db';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

const app = express();

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '5mb' }));

// Bull Board
const board = new ExpressAdapter();
board.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter: board
});

app.use('/admin/queues', board.getRouter());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
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

    res.json(emails);
  } catch (err) {
    console.error('Fetch emails error:', err);
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

// Schedule emails with sender selection
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

    if (
      !Array.isArray(recipients) ||
      recipients.length === 0 ||
      !subject ||
      !body ||
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

    const start = new Date(startAt);

    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({
        error: 'Invalid startAt date'
      });
    }

    const delay = Number(delaySeconds);

    if (!Number.isFinite(delay) || delay < 0) {
      return res.status(400).json({
        error: 'delaySeconds must be a non-negative number'
      });
    }

    const delayMs = delay * 1000;
    const results = [];

    for (let i = 0; i < recipients.length; i++) {
      const recipient = String(recipients[i]).trim();

      // Validate email address
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
        continue;
      }

      const scheduledAt = new Date(
        start.getTime() + i * delayMs
      );

      // Save email and sender in PostgreSQL
      const record = await prisma.email.create({
        data: {
          recipient,
          subject,
          body,
          senderId,
          scheduledAt,
          status: 'scheduled'
        }
      });

      // Add email to BullMQ
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

    if (results.length === 0) {
      return res.status(400).json({
        error: 'No valid recipient email addresses found'
      });
    }

    res.status(201).json({
      count: results.length,
      senderId,
      emails: results
    });

  } catch (err) {
    console.error('Schedule error:', err);

    res.status(500).json({
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

    res.json({
      message: 'Email cancelled successfully',
      id
    });

  } catch (err) {
    console.error('Cancel email error:', err);

    res.status(500).json({
      error: 'Failed to cancel email'
    });
  }
});

// Start server
const port = Number(process.env.PORT || 4000);

app.listen(port, () => {
  console.log(
    `API running at http://localhost:${port}; Bull Board: /admin/queues`
  );
});
