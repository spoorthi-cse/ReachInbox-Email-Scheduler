
import nodemailer from 'nodemailer';

const transporters: Record<string, nodemailer.Transporter> = {};

const senderAccounts: Record<string, { user: string; pass: string }> = {
  'sender-1': {
    user: process.env.ETHEREAL_SENDER1_USER || '',
    pass: process.env.ETHEREAL_SENDER1_PASS || ''
  },
  'sender-2': {
    user: process.env.ETHEREAL_SENDER2_USER || '',
    pass: process.env.ETHEREAL_SENDER2_PASS || ''
  }
};

export async function getTransporter(senderId: string = 'sender-1') {
  if (transporters[senderId]) {
    return transporters[senderId];
  }

  const account = senderAccounts[senderId];

  if (!account || !account.user || !account.pass) {
    throw new Error(`SMTP credentials missing for ${senderId}`);
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: account.user,
      pass: account.pass
    }
  });

  transporters[senderId] = transporter;

  return transporter;
}

export function getSenderAddress(senderId: string = 'sender-1') {
  const account = senderAccounts[senderId];

  if (!account || !account.user) {
    throw new Error(`Sender email not configured: ${senderId}`);
  }

  return account.user;
}
