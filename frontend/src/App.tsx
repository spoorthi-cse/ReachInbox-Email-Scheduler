
import { useEffect, useState, useCallback } from 'react';
import Papa from 'papaparse';

type Email = {
  id: string;
  recipient: string;
  subject: string;
  scheduledAt: string;
  sentAt: string | null;
  status: string;
  senderId?: string;
  error?: string | null;
};

type EmailTab = 'scheduled' | 'sent' | 'failed' | 'cancelled';

const API = import.meta.env.DEV
  ? 'http://localhost:4000/api'
  : '/api';

export default function App() {
  const [tab, setTab] = useState<EmailTab>('scheduled');
  const [rows, setRows] = useState<Email[]>([]);
  const [compose, setCompose] = useState(false);

  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [startAt, setStartAt] = useState('');
  const [delay, setDelay] = useState(0);
  const [senderId, setSenderId] = useState('sender-1');

  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  const [notice, setNotice] = useState('');
  const [noticeType, setNoticeType] = useState<'success' | 'error'>('success');
  const [composeError, setComposeError] = useState('');

  const showNotice = (
    message: string,
    type: 'success' | 'error' = 'success'
  ) => {
    setNotice(message);
    setNoticeType(type);
  };

  // Fetch emails
  const load = useCallback(async () => {
    setRefreshing(true);

    try {
      const response = await fetch(
        `${API}/emails?status=${tab}`,
        { cache: 'no-store' }
      );

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data: Email[] = await response.json();
      setRows(data);

    } catch (error) {
      console.error('Loading error:', error);

      showNotice(
        'Unable to load emails. Please check the backend.',
        'error'
      );

    } finally {
      setRefreshing(false);
      setInitialLoading(false);
    }
  }, [tab]);

  // Initial loading and automatic refresh
  useEffect(() => {
    setInitialLoading(true);
    load();

    const interval = setInterval(() => {
      load();
    }, 3000);

    return () => clearInterval(interval);
  }, [load]);

  // Email validation
  function isValidEmail(email: string): boolean {
    return (
      email.length <= 254 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    );
  }

  // CSV upload and validation
  function parseCsv(file: File) {
    setComposeError('');

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setRecipients([]);
      setComposeError('Please upload a CSV file.');
      return;
    }

    Papa.parse(file, {
      skipEmptyLines: true,

      complete: (result) => {
        const values = (result.data as unknown[][])
          .flatMap(row => row)
          .map(value => String(value).trim())
          .filter(Boolean);

        const emailValues = values.filter(
          value => value.toLowerCase() !== 'email'
        );

        const validEmails: string[] = [];
        const invalidEmails: string[] = [];

        for (const value of emailValues) {
          if (isValidEmail(value)) {
            validEmails.push(value);
          } else {
            invalidEmails.push(value);
          }
        }

        const uniqueEmails = [
          ...new Map(
            validEmails.map(email => [
              email.toLowerCase(),
              email
            ])
          ).values()
        ];

        // Do not allow partial campaigns with invalid addresses
        if (invalidEmails.length > 0) {
          setRecipients([]);

          setComposeError(
            `Found ${invalidEmails.length} invalid email address(es): ${invalidEmails.join(', ')}. Please correct your CSV and upload it again.`
          );

          return;
        }

        setRecipients(uniqueEmails);

        if (uniqueEmails.length === 0) {
          setComposeError(
            'No email addresses found. Please check your CSV file.'
          );
        } else {
          setComposeError('');

          showNotice(
            `Successfully loaded ${uniqueEmails.length} valid email address(es).`,
            'success'
          );
        }
      },

      error: () => {
        setRecipients([]);
        setComposeError('Unable to read CSV file.');
      }
    });
  }

  // Schedule emails
  async function schedule() {
    console.log('Schedule button clicked');

    setComposeError('');

    if (busy) return;

    if (recipients.length === 0) {
      setComposeError(
        'Please upload a CSV containing valid email addresses.'
      );
      return;
    }

    if (!subject.trim() || !body.trim() || !startAt) {
      setComposeError(
        'Please fill in the subject, email body and schedule date.'
      );
      return;
    }

    const selectedDate = new Date(startAt);

    if (Number.isNaN(selectedDate.getTime())) {
      setComposeError('Please enter a valid schedule date and time.');
      return;
    }

    if (selectedDate.getTime() <= Date.now()) {
      setComposeError('Please select a future date and time.');
      return;
    }

    if (!Number.isFinite(delay) || delay < 0) {
      setComposeError('Delay must be a non-negative number.');
      return;
    }

    setBusy(true);

    try {
      console.log('Sending scheduling request:', {
        recipients,
        subject,
        senderId,
        startAt,
        delay
      });

      const response = await fetch(`${API}/emails/schedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          recipients,
          subject: subject.trim(),
          body: body.trim(),
          startAt: selectedDate.toISOString(),
          delaySeconds: Number(delay),
          senderId
        })
      });

      const data = await response.json();

      console.log('Scheduling API response:', response.status, data);

      if (!response.ok) {
        const invalidMessage = Array.isArray(data.invalidRecipients)
          ? ` Invalid addresses: ${data.invalidRecipients.join(', ')}`
          : '';

        throw new Error(
          (data.error || 'Scheduling failed') + invalidMessage
        );
      }

      showNotice(
        `Successfully scheduled ${data.count} email(s).`,
        'success'
      );

      setCompose(false);
      setComposeError('');
      setRecipients([]);
      setSubject('');
      setBody('');
      setStartAt('');
      setDelay(0);
      setSenderId('sender-1');

      setTab('scheduled');

    } catch (error) {
      console.error('Scheduling error:', error);

      setComposeError(
        error instanceof Error
          ? error.message
          : 'Scheduling failed. Please try again.'
      );

    } finally {
      setBusy(false);
    }
  }

  // Cancel scheduled email
  async function cancelEmail(id: string) {
    const confirmed = window.confirm(
      'Are you sure you want to cancel this scheduled email?'
    );

    if (!confirmed) return;

    try {
      const response = await fetch(`${API}/emails/${id}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Cancellation failed');
      }

      showNotice('Email cancelled successfully!', 'success');

      await load();

    } catch (error) {
      console.error('Cancellation error:', error);

      showNotice(
        error instanceof Error
          ? error.message
          : 'Unable to cancel email.',
        'error'
      );
    }
  }

  // Close compose modal
  function closeCompose() {
    if (busy) return;

    setCompose(false);
    setComposeError('');
    setRecipients([]);
    setSubject('');
    setBody('');
    setStartAt('');
    setDelay(0);
    setSenderId('sender-1');
  }

  const heading =
    tab === 'scheduled'
      ? 'Scheduled Emails'
      : tab === 'sent'
        ? 'Sent Emails'
        : tab === 'failed'
          ? 'Failed Emails'
          : 'Cancelled Emails';

  const timeHeading =
    tab === 'sent' ? 'Sent time' : 'Scheduled time';

  const emptyMessage =
    tab === 'scheduled'
      ? 'No scheduled emails yet.'
      : tab === 'sent'
        ? 'No sent emails yet.'
        : tab === 'failed'
          ? 'No failed emails yet.'
          : 'No cancelled emails yet.';

  const emptyDescription =
    tab === 'scheduled'
      ? 'Compose a new email campaign to get started.'
      : tab === 'sent'
        ? 'Your successfully sent emails will appear here.'
        : tab === 'failed'
          ? 'Emails that failed after all retry attempts will appear here.'
          : 'Emails you cancel will appear here.';

  return (
    <div className="app">

      {/* Header */}
      <header>
        <div className="brand">
          <span className="logo">R</span>
          <span>ReachInbox</span>
        </div>

        <div className="user">
          <div className="avatar">D</div>
          <div>
            <b>Demo User</b>
            <small>demo@reachinbox.app</small>
          </div>
        </div>
      </header>

      <main>

        {/* Welcome */}
        <div className="welcome">
          <div>
            <p className="eyebrow">EMAIL CAMPAIGNS</p>
            <h1>Email Scheduler</h1>
            <p className="muted">
              Manage and schedule your email outreach.
            </p>
          </div>

          <button
            className="primary"
            onClick={() => {
              setNotice('');
              setComposeError('');
              setCompose(true);
            }}
          >
            + Compose New Email
          </button>
        </div>

        {/* Notifications */}
        {notice && (
          <div
            className="notice"
            style={{
              borderLeft: `4px solid ${
                noticeType === 'success' ? '#16a34a' : '#dc2626'
              }`
            }}
          >
            {notice}
            <button onClick={() => setNotice('')}>×</button>
          </div>
        )}

        {/* Tabs */}
        <div className="tabs">
          <button
            className={tab === 'scheduled' ? 'active' : ''}
            onClick={() => setTab('scheduled')}
          >
            Scheduled
          </button>

          <button
            className={tab === 'sent' ? 'active' : ''}
            onClick={() => setTab('sent')}
          >
            Sent
          </button>

          <button
            className={tab === 'failed' ? 'active' : ''}
            onClick={() => setTab('failed')}
          >
            Failed
          </button>

          <button
            className={tab === 'cancelled' ? 'active' : ''}
            onClick={() => setTab('cancelled')}
          >
            Cancelled
          </button>
        </div>

        {/* Email Table */}
        <section className="panel">

          <div className="panel-head">
            <div>
              <h2>{heading}</h2>

              <p className="muted">
                {initialLoading
                  ? 'Loading emails...'
                  : `${rows.length} email${rows.length === 1 ? '' : 's'}`}
              </p>
            </div>

            <button
              className="secondary"
              onClick={() => load()}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing...' : '↻ Refresh'}
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Subject</th>
                  <th>Sender</th>
                  <th>{timeHeading}</th>
                  <th>Status</th>
                  {tab === 'scheduled' && <th>Action</th>}
                </tr>
              </thead>

              <tbody>

                {initialLoading && (
                  <tr>
                    <td
                      colSpan={tab === 'scheduled' ? 6 : 5}
                      className="empty"
                    >
                      <div style={{ padding: '35px' }}>
                        <div className="loading-spinner"></div>
                        <p>Loading your emails...</p>
                      </div>
                    </td>
                  </tr>
                )}

                {!initialLoading && rows.map(email => (
                  <tr key={email.id}>
                    <td>{email.recipient}</td>
                    <td>{email.subject}</td>

                    <td>
                      {email.senderId === 'sender-2'
                        ? 'Sender 2'
                        : 'Sender 1'}
                    </td>

                    <td>
                      {new Date(
                        tab === 'sent'
                          ? email.sentAt || email.scheduledAt
                          : email.scheduledAt
                      ).toLocaleString()}
                    </td>

                    <td>
                      <span className={`status ${email.status}`}>
                        {email.status}
                      </span>

                      {email.error && (
                        <small
                          title={email.error}
                          style={{
                            marginLeft: '6px',
                            cursor: 'help'
                          }}
                        >
                          ⚠
                        </small>
                      )}
                    </td>

                    {tab === 'scheduled' && (
                      <td>
                        <button
                          className="secondary"
                          onClick={() => cancelEmail(email.id)}
                        >
                          Cancel
                        </button>
                      </td>
                    )}
                  </tr>
                ))}

                {!initialLoading && rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={tab === 'scheduled' ? 6 : 5}
                      className="empty"
                    >
                      <div style={{ padding: '35px' }}>
                        <div style={{ fontSize: '35px' }}>
                          {tab === 'scheduled'
                            ? '📅'
                            : tab === 'sent'
                              ? '✉️'
                              : tab === 'failed'
                                ? '⚠️'
                                : '📭'}
                        </div>

                        <h3>{emptyMessage}</h3>

                        <p className="muted">
                          {emptyDescription}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}

              </tbody>
            </table>
          </div>

        </section>
      </main>

      {/* Compose Modal */}
      {compose && (
        <div className="overlay">
          <div className="modal">

            <div className="modal-head">
              <div>
                <h2>Compose email campaign</h2>

                <p className="muted">
                  Upload recipients and choose your schedule.
                </p>
              </div>

              <button
                className="close"
                onClick={closeCompose}
                disabled={busy}
              >
                ×
              </button>
            </div>

            <label>Select sender account</label>

            <select
              value={senderId}
              onChange={event => setSenderId(event.target.value)}
            >
              <option value="sender-1">Sender 1</option>
              <option value="sender-2">Sender 2</option>
            </select>

            <small className="muted">
              Emails in this campaign will be sent using the selected account.
            </small>

            <label>CSV file with recipient email addresses</label>

            <input
              type="file"
              accept=".csv,text/csv"
              onChange={event => {
                const file = event.target.files?.[0];

                if (file) {
                  setNotice('');
                  parseCsv(file);
                }
              }}
            />

            <div className="csv-count">
              {recipients.length} recipient
              {recipients.length === 1 ? '' : 's'} loaded
            </div>

            {/* Visible validation errors */}
            {composeError && (
              <div
                className="notice"
                role="alert"
                style={{
                  borderLeft: '4px solid #dc2626',
                  color: '#991b1b',
                  background: '#fef2f2',
                  padding: '12px',
                  margin: '10px 0'
                }}
              >
                {composeError}
              </div>
            )}

            <label>Subject</label>

            <input
              value={subject}
              onChange={event => setSubject(event.target.value)}
              placeholder="Your email subject"
            />

            <label>Email body</label>

            <textarea
              rows={5}
              value={body}
              onChange={event => setBody(event.target.value)}
              placeholder="Write your message..."
            />

            <div className="form-grid">
              <div>
                <label>Start date & time</label>

                <input
                  type="datetime-local"
                  value={startAt}
                  onChange={event => setStartAt(event.target.value)}
                />
              </div>

              <div>
                <label>Delay between emails (seconds)</label>

                <input
                  type="number"
                  min="0"
                  value={delay}
                  onChange={event =>
                    setDelay(Math.max(0, Number(event.target.value)))
                  }
                />
              </div>
            </div>

            <div className="modal-actions">
              <button
                className="secondary"
                onClick={closeCompose}
                disabled={busy}
              >
                Cancel
              </button>

              <button
                type="button"
                className="primary"
                disabled={busy || recipients.length === 0}
                onClick={schedule}
              >
                {busy ? 'Scheduling...' : 'Schedule emails'}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
