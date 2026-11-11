## Handling Large Email Campaigns (1,000+ Emails)

ReachInbox uses BullMQ and Redis to process large email campaigns reliably.

🎥 **Demo Video**

Watch the complete working demonstration of ReachInbox Email Scheduler.

**Project Demo**: https://drive.google.com/file/d/14JDyqmqOaClLYySPkDXgU0eoJXbpkzZV/view?usp=drive_link

### Processing strategy

1. All valid email records are stored in PostgreSQL.
2. Email jobs are added to a BullMQ queue.
3. Redis maintains the queue and coordinates job processing.
4. Workers process jobs using configurable concurrency.
5. Rate limiting controls the number of emails sent within an hourly window.
6. Jobs exceeding the rate limit are delayed instead of being discarded.
7. Failed jobs are retained for monitoring and retry according to the configured retry policy.

### Configuration

| Setting | Value | Purpose |
|---|---:|---|
| WORKER_CONCURRENCY | 5 | Process up to five jobs concurrently |
| MAX_EMAILS_PER_HOUR | 2 | Global hourly sending limit (test setting) |
| RATE_LIMIT_DURATION_MS | 3600000 | One-hour rate-limit window |
| MIN_SEND_INTERVAL_MS | 10000 | Minimum sending interval |

### Handling 1,000+ Emails

For a campaign containing 1,000 or more recipients, jobs are queued and processed gradually. The application does not attempt to send all emails simultaneously.

When the hourly limit is reached, BullMQ delays excess jobs. Processing resumes when the rate limit allows it.

The hourly limit can be increased through environment configuration for larger campaigns, subject to SMTP provider limits.

### Monitoring

Bull Board provides visibility into:
- Waiting jobs
- Active jobs
- Completed jobs
- Failed jobs
- Delayed jobs

This allows administrators to monitor campaign progress and investigate failures.

### Reliability

PostgreSQL stores email records, while Redis stores queue data. Redis persistence must be enabled to retain queued jobs across Redis restarts. Job processing and duplicate-send prevention must also be verified before production deployment.
