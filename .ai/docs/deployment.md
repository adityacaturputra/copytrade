# CopyTrade Deployment Guide

This guide explains how to deploy the CopyTrade application with a separated frontend (Vercel) and backend (VPS).

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
           ┌──────────────────┴──────────────────┐
           │                                     │
           ▼                                     ▼
┌──────────────────────┐            ┌──────────────────────────┐
│   Frontend (Vercel)  │            │   Backend (VPS)          │
│   ───────────────    │            │   ─────────────          │
│   Next.js App        │◄──────────►│   Express.js API         │
│   - Dashboard UI     │   API calls│   - Cron Jobs            │
│   - Settings UI      │            │   - Signal Processing    │
│   - Manual Trading   │            │   - Exchange Operations  │
│   - Draft Management │            │   - AI Analysis          │
└──────────────────────┘            └──────────────────────────┘
                                              │
                                              ▼
                                    ┌──────────────────────────┐
                                    │   MongoDB Atlas          │
                                    │   (Shared Database)      │
                                    └──────────────────────────┘
```

## Why Separate Frontend and Backend?

1. **Vercel Limitations**: Long-running processes (cron jobs) are limited to 60 seconds on Vercel's serverless functions
2. **Cost Efficiency**: VPS is cheaper for continuous background processing
3. **Reliability**: Backend can run 24/7 without cold starts
4. **Scalability**: Each component can be scaled independently

## Prerequisites

- A VPS (Virtual Private Server) - e.g., DigitalOcean, AWS EC2, Linode, Vultr
- MongoDB Atlas account (or self-hosted MongoDB)
- Vercel account
- Domain name (optional but recommended)

## Backend Deployment (VPS)

### 1. Server Requirements

- **OS**: Ubuntu 22.04 LTS (recommended)
- **RAM**: 1GB minimum, 2GB recommended
- **Storage**: 20GB SSD
- **Node.js**: v20 or later

### 2. Initial Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 for process management
sudo npm install -g pm2

# Install Git
sudo apt install git -y
```

### 3. Clone and Setup

```bash
# Clone the repository
git clone <your-repo-url> /opt/copytrade
cd /opt/copytrade

# Install dependencies
pnpm install

# Build the TypeScript code
pnpm --filter copytrade-backend build
```

### 4. Environment Configuration

Create the root `.env` file:

```bash
cp .env.example .env
nano .env
```

Edit the `.env` file:

```env
# ─── Server Configuration ──────────────────────────────────
PORT=3001
NODE_ENV=production

# ─── AI Provider Selection ─────────────────────────────────
AI_PROVIDER=glm

# ─── GLM (ZhipuAI) Configuration ───────────────────────────
GLM_API_KEY=your_glm_api_key_here
GLM_BASE_URL=https://api.z.ai/api/coding/paas/v4
GLM_MODEL=glm-5.1

# ─── MongoDB ───────────────────────────────────────────────
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/copytrade

# ─── Cron Security ─────────────────────────────────────────
CRON_SECRET=your_random_secret_here

# ─── Cron-Job.org Integration ──────────────────────────────
CRON_JOB_API_KEY=your_cron_job_api_key_here

# ─── Frontend URL (for CORS) ───────────────────────────────
FRONTEND_URL=https://your-vercel-app.vercel.app
```

### 5. Start the Backend

```bash
# Start with PM2
cd /root/apps/copytrade/server
pm2 start dist/index.js --name copytrade-backend --cwd /root/apps/copytrade/server

# Save PM2 config
pm2 save

# Setup PM2 to start on boot
pm2 startup systemd
```

Do not start the backend with `pm2 start "pnpm --filter copytrade-backend start"` from the monorepo root.
That keeps the process cwd at the repo root and makes Node look for `dist/index.js` in the wrong place.

### 6. Setup Nginx (Recommended)

```bash
# Install Nginx
sudo apt install nginx -y

# Create Nginx config
sudo nano /etc/nginx/sites-available/copytrade
```

Add this configuration:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/copytrade /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 7. SSL with Let's Encrypt (Optional but Recommended)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Obtain SSL certificate
sudo certbot --nginx -d your-domain.com
```

## Frontend Deployment (Vercel)

### 1. Prepare the Frontend

Update the frontend environment variables in Vercel:

```env
# ─── Backend Configuration ─────────────────────────────────
BACKEND_URL=https://your-vps-domain.com

# ─── AI Configuration ──────────────────────────────────────
AI_PROVIDER=glm
GLM_API_KEY=your_glm_api_key_here
GLM_BASE_URL=https://api.z.ai/api/coding/paas/v4
GLM_MODEL=glm-5.1

# ─── MongoDB ───────────────────────────────────────────────
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/copytrade

# ─── Cron Security ─────────────────────────────────────────
CRON_SECRET=your_random_secret_here

# ─── Cron-Job.org Integration ──────────────────────────────
CRON_JOB_API_KEY=your_cron_job_api_key_here
```

### 2. Deploy to Vercel

```bash
# From the client directory
cd client

# Deploy to Vercel
vercel --prod
```

Or connect your GitHub repository to Vercel for automatic deployments.

### 3. Vercel Environment Variables

Set these environment variables in the Vercel dashboard:

1. Go to Project Settings → Environment Variables
2. Add all variables from your `.env` file
3. Make sure `BACKEND_URL` points to your VPS

## Cron Job Configuration

### Option 1: Using cron-job.org (Recommended)

1. Sign up at [cron-job.org](https://cron-job.org)
2. Get your API key
3. Configure in the CopyTrade settings UI:
   - Base URL: `https://your-vps-domain.com/api/cron`
   - Jobs:
     - Signal Check: `/signal-check` (every 5 minutes)
     - Position Monitor: `/position-monitor` (every 30 minutes)
     - TP/SL Monitor: `/tp-sl-monitor` (every 5 minutes)

### Option 2: Using System Cron (VPS)

```bash
# Edit crontab
crontab -e
```

Add these lines:

```cron
# Signal check every 5 minutes
*/5 * * * * curl -X POST https://localhost:3001/api/cron/signal-check -H "Authorization: Bearer YOUR_CRON_SECRET"

# Position monitor every 30 minutes
*/30 * * * * curl -X POST https://localhost:3001/api/cron/position-monitor -H "Authorization: Bearer YOUR_CRON_SECRET"

# TP/SL monitor every 5 minutes
*/5 * * * * curl -X POST https://localhost:3001/api/cron/tp-sl-monitor -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## Monitoring and Logs

### Backend Logs

```bash
# View PM2 logs
pm2 logs copytrade-backend

# View last 100 lines
pm2 logs copytrade-backend --lines 100

# Monitor in real-time
pm2 monit
```

### Frontend Logs

View logs in the Vercel dashboard:
1. Go to your project
2. Click on a deployment
3. View the "Functions" tab for serverless function logs

## Troubleshooting

### Backend Issues

**Problem**: Backend won't start
```bash
# Check Node.js version
node --version  # Should be v20+

# Check if port is in use
sudo lsof -i :3001

# Check PM2 status
pm2 status
pm2 logs copytrade-backend
```

**Problem**: CORS errors
- Verify `FRONTEND_URL` in backend `.env` matches your Vercel URL
- Check that the URL doesn't have a trailing slash

**Problem**: MongoDB connection failed
- Verify `MONGODB_URI` is correct
- Check if IP whitelist includes your VPS IP
- Test connection: `mongo "YOUR_MONGODB_URI"`

### Frontend Issues

**Problem**: API calls failing
- Check browser console for CORS errors
- Verify `BACKEND_URL` environment variable
- Ensure backend is running and accessible

**Problem**: Cron jobs not running
- Check cron-job.org dashboard for job status
- Verify `CRON_SECRET` matches between frontend and backend
- Check backend logs for authentication errors

## Security Considerations

1. **Firewall**: Only open ports 80, 443, and 3001 (if needed)
2. **CRON_SECRET**: Use a strong random string
3. **MongoDB**: Use MongoDB Atlas with IP whitelist
4. **SSL**: Always use HTTPS in production
5. **Updates**: Regularly update dependencies

## Updating the Application

### Backend Update

```bash
cd /opt/copytrade

# Pull latest changes
git pull

# Install dependencies
cd server && npm install

# Rebuild
npm run build

# Restart PM2
pm2 restart copytrade-backend
```

### Frontend Update

Push to your Git repository - Vercel will automatically deploy.

Or manually:

```bash
cd client
vercel --prod
```

## Backup and Recovery

### MongoDB Backup

```bash
# Create backup
mongodump --uri="YOUR_MONGODB_URI" --out=/backup/$(date +%Y%m%d)

# Restore backup
mongorestore --uri="YOUR_MONGODB_URI" /backup/20240101/copytrade/
```

### Configuration Backup

```bash
# Backup .env file
cp /opt/copytrade/server/.env /backup/.env.$(date +%Y%m%d)
```

## Support

For issues and questions:
1. Check the logs first
2. Review this deployment guide
3. Open an issue in the repository
