
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

type EmailTab = 'scheduled' | 'sent' | 'cancelled';

const API = 'http://localhost:4000/api';

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

  const showNotice = (message: string, type: 'success' | 'error' = 'success') => {
    setNotice(message);
    setNoticeType(type);
  };

  // Fetch emails
  const load = useCallback(async (initial = false) => {
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

      showNotice('Unable to load emails. Please check the backend.', 'error');

    } finally {
      setRefreshing(false);
      setInitialLoading(false);
    }
  }, [tab]);

  // Initial loading and automatic refresh
  useEffect(() => {
    setInitialLoading(true);
    load();

    const interval = setInterval(() => load(), 3000);

    return () => clearInterval(interval);
  }, [load]);

  // CSV upload
  function parseCsv(file: File) {
    Papa.parse(file, {
      complete: (result) => {
        const values = (result.data as unknown[])
          .flatMap(value =>
            Array.isArray(value) ? value : [value]
          )
          .map(value => String(value).trim())
          .filter(value =>
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
          );

        const uniqueEmails = [...new Set(values)];

        setRecipients(uniqueEmails);

        showNotice(
          uniqueEmails.length > 0
            ? `Loaded ${uniqueEmails.length} valid email addresses.`
            : 'No valid email addresses found.',
          uniqueEmails.length > 0 ? 'success' : 'error'
        );
      },

      error: () => {
        showNotice('Unable to read CSV file.', 'error');
      }
    });
  }

  // Schedule emails
  async function schedule() {
    if (
      recipients.length === 0 ||
      !subject.trim() ||
      !body.trim() ||
      !startAt
    ) {
      showNotice('Fill all fields and upload a valid CSV.', 'error');
      return;
    }

    if (new Date(startAt).getTime() <= Date.now()) {
      showNotice('Please select a future date and time.', 'error');
      return;
    }

    setBusy(true);

    try {
      const response = await fetch(`${API}/emails/schedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          recipients,
          subject,
          body,
          startAt: new Date(startAt).toISOString(),
          delaySeconds: Number(delay),
          senderId
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Scheduling failed');
      }

      showNotice(
        `Successfully scheduled ${data.count} emails.`,
        'success'
      );

      setCompose(false);
      setRecipients([]);
      setSubject('');
      setBody('');
      setStartAt('');
      setDelay(0);
      setSenderId('sender-1');

      setTab('scheduled');

    } catch (error) {
      console.error('Scheduling error:', error);

      showNotice(
        error instanceof Error ? error.message : 'Scheduling failed.',
        'error'
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
        error instanceof Error ? error.message : 'Unable to cancel email.',
        'error'
      );
    }
  }

  const heading =
    tab === 'scheduled'
      ? 'Scheduled Emails'
      : tab === 'sent'
        ? 'Sent Emails'
        : 'Cancelled Emails';

  const timeHeading =
    tab === 'sent' ? 'Sent time' : 'Scheduled time';

  const emptyMessage =
    tab === 'scheduled'
      ? 'No scheduled emails yet.'
      : tab === 'sent'
        ? 'No sent emails yet.'
        : 'No cancelled emails yet.';

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
            onClick={() => setCompose(true)}
          >
            ＋ Compose New Email
          </button>
        </div>

        {/* Notifications */}
        {notice && (
          <div
            className="notice"
            style={{
              borderLeft: `4px solid ${noticeType === 'success' ? '#16a34a' : '#dc2626'}`
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

                {/* Loading State */}
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

                {/* Email Rows */}
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
                        <small title={email.error}> ⚠</small>
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

                {/* Empty State */}
                {!initialLoading && rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={tab === 'scheduled' ? 6 : 5}
                      className="empty"
                    >
                      <div style={{ padding: '35px' }}>
                        <div style={{ fontSize: '35px' }}>
                          {tab === 'scheduled' ? '📅' :
                            tab === 'sent' ? '✉️' : '📭'}
                        </div>

                        <h3>{emptyMessage}</h3>

                        <p className="muted">
                          {tab === 'scheduled'
                            ? 'Compose a new email campaign to get started.'
                            : tab === 'sent'
                              ? 'Your successfully sent emails will appear here.'
                              : 'Emails you cancel will appear here.'}
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
                onClick={() => setCompose(false)}
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
                if (file) parseCsv(file);
              }}
            />

            <div className="csv-count">
              {recipients.length} recipients loaded
            </div>

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
                onClick={() => setCompose(false)}
              >
                Cancel
              </button>

              <button
                className="primary"
                disabled={busy}
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
