# copytrade-proxy

Reverse proxy for OKX & MEXC APIs — provides a **static outbound IP** so exchange API IP whitelisting works with Vercel (Hobby plan).

## Architecture

```
Vercel App ──→ Oracle VPS (Static IP) ──→ OKX/MEXC API
```

From the exchange's perspective, all requests come from your VPS's static IP.

## Quick Setup (Oracle Cloud Free Tier)

### 1. Create Oracle Cloud Account
- Sign up at [cloud.oracle.com/free](https://cloud.oracle.com/free)
- Create an ARM instance (Ubuntu 22.04)
- Assign a **Reserved Public IP** (this is your static IP)
- Open port 3000 in the Oracle Cloud security list (VCN → Security Lists → Ingress Rules)

### 2. Deploy Proxy

SSH into your VPS and run:

```bash
# Upload the proxy folder (or clone your repo and cd into proxy/)
scp -r proxy/ ubuntu@<your-vps-ip>:~/proxy/
ssh ubuntu@<your-vps-ip>

# Run setup
cd ~/proxy
bash setup.sh
```

### 3. Configure

```bash
cp .env.example .env
nano .env
```

Set `API_SECRET` to a random string for security.

### 4. Whitelist IP on Exchanges

- **OKX**: Go to API → IP Restrictions → Add your VPS static IP
- **MEXC**: Go to API Management → IP Access → Add your VPS static IP

### 5. Configure Vercel

Add these environment variables in your Vercel project settings:

```
OKX_PROXY_URL=http://<your-vps-ip>:3000/okx
MEXC_PROXY_URL=http://<your-vps-ip>:3000/mexc
```

That's it! Your Vercel app will now route all exchange API calls through the proxy.

## Routes

| Path | Target |
|------|--------|
| `/okx/*` | `https://www.okx.com/*` |
| `/mexc/*` | `https://contract.mexc.com/*` |

Example:
- `GET http://<vps-ip>:3000/okx/api/v5/public/time` → `GET https://www.okx.com/api/v5/public/time`
- `POST http://<vps-ip>:3000/mexc/api/v1/private/order/submit` → `POST https://contract.mexc.com/api/v1/private/order/submit`

## Security

- **API_SECRET**: If set, all requests must include `?secret=<value>` or `x-proxy-secret` header
- **ALLOWED_IPS**: Comma-separated list of allowed client IPs
- **Firewall**: Only open port 3000 in Oracle Cloud security list

## Management

```bash
# View logs
pm2 logs copytrade-proxy

# Restart
pm2 restart copytrade-proxy

# Stop
pm2 stop copytrade-proxy

# Status
pm2 status
```

## Troubleshooting

```bash
# Test proxy from VPS
curl http://localhost:3000/okx/api/v5/public/time

# Test proxy from your machine
curl http://<vps-ip>:3000/okx/api/v5/public/time

# Check if port is open
telnet <vps-ip> 3000
```

If the proxy isn't reachable from outside:
1. Check Oracle Cloud VCN Security List (ingress rule for port 3000)
2. Check iptables: `sudo iptables -L -n`
3. Check PM2: `pm2 status` and `pm2 logs copytrade-proxy`
