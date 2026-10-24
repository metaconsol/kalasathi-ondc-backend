# Kalasathi AWS Production Deployment Master Guide

This document is the master playbook for deploying the full **Kalasathi Multi-Seller Marketplace & ONDC Platform** to AWS.

---

## 📚 Complete Deployment Documentation Suite

We have created three comprehensive guides in this workspace:

1. 🚀 **[AWS EC2 Instance Setup Guide](AWS_EC2_INSTANCE_SETUP_GUIDE.md)**  
   _Covers AWS Console instance launch (`t4g.small` ARM Graviton2), Elastic IP assignment, Security Groups, Nginx reverse proxy configuration, Certbot SSL, and PM2 process management._

2. 🗄️ **[AWS RDS Database Setup Guide](AWS_RDS_DATABASE_SETUP_GUIDE.md)**  
   _Covers RDS MySQL 8 (`db.t4g.micro`), automated backups, parameter groups, security group pairing, and database migration._

3. ⚙️ **Production Environment Templates:**
   - `kalasathi-ecom-backend/.env.aws.production`
   - `kalasathi-ondc-backend/.env.aws.production`
   - `kalasathi-ui/.env.aws.production`

---

## 🏗️ Architecture Overview

```
                      Internet / Shoppers / ONDC Network
                                     │
                                     ▼ (Ports 80 / 443 HTTPS)
                       ┌───────────────────────────┐
                       │   AWS Elastic IP (IPv4)   │
                       └─────────────┬─────────────┘
                                     │
                     ┌───────────────▼───────────────┐
                     │     Nginx Web Server / SSL    │
                     │  (certbot TLS 1.3 auto-renew) │
                     └───────┬───────────────┬───────┘
                             │               │
       ┌─────────────────────┼───────────────┴─────────────────────┐
       │ (location /)        │ (location /api/v1/)                 │ (location /api/v1/ondc/)
       ▼                     ▼                                     ▼
┌──────────────┐     ┌───────────────┐                     ┌───────────────┐
│ kalasathi-ui │     │ ecom-backend  │                     │ ondc-backend  │
│ (Vite Static)│     │ (Node.js/PM2) │                     │ (Node.js/PM2) │
│ /var/www/... │     │ Port 5002     │                     │ Port 5001     │
└──────────────┘     └───────┬───────┘                     └───────┬───────┘
                             │                                     │
                             └───────────────┬─────────────────────┘
                                             ▼
                               ┌───────────────────────────┐
                               │       AWS RDS MySQL       │
                               │  (kalasathi-db Port 3306) │
                               └───────────────────────────┘
```

---

## ⚡ Quick 5-Step Deployment Playbook

### Step 1: Provision Infrastructure (AWS Console)

1. **Launch RDS:** Follow [`AWS_RDS_DATABASE_SETUP_GUIDE.md`](AWS_RDS_DATABASE_SETUP_GUIDE.md) to launch `kalasathi-db` (`db.t4g.micro`, MySQL 8.0, 20 GB gp3).
2. **Launch EC2:** Follow [`AWS_EC2_INSTANCE_SETUP_GUIDE.md`](AWS_EC2_INSTANCE_SETUP_GUIDE.md) to launch `kalasathi-web-prod` (`t4g.small` ARM, Ubuntu 24.04 LTS, 30 GB gp3).
3. **Allocate Elastic IP:** Associate 1 Elastic IP with your EC2 instance and point your domain DNS A-records to it.

---

### Step 2: Connect to EC2 & Prepare Server

```bash
ssh -i kalasathi-key.pem ubuntu@<YOUR_ELASTIC_IP>

# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Node.js 22 LTS, Nginx, Git & Build tools
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx git build-essential

# Install PM2 globally
sudo npm install -g pm2
pm2 startup systemd
```

---

### Step 3: Clone Repositories & Install Dependencies

```bash
# Create application root directory
sudo mkdir -p /var/www && cd /var/www

# Clone repositories (or copy from local)
git clone https://github.com/metaconsol/kalasathi-ecom-backend.git
git clone https://github.com/metaconsol/kalasathi-ondc-backend.git
git clone https://github.com/metaconsol/kalasathi-ui.git

# Set permissions
sudo chown -R ubuntu:ubuntu /var/www
```

---

### Step 4: Configure Environments & Build

#### 1. E-Commerce Backend (Port 5002)

```bash
cd /var/www/kalasathi-ecom-backend
cp .env.aws.production .env
nano .env  # Update DATABASE_URL with your RDS endpoint, keys & secrets

npm install
npx prisma generate
npx prisma migrate deploy
npm run build

# Start with PM2
pm2 start dist/main.js --name kalasathi-ecom-backend
```

#### 2. ONDC Protocol Backend (Port 5001)

```bash
cd /var/www/kalasathi-ondc-backend
cp .env.aws.production .env
nano .env  # Update DATABASE_URL and ONDC cryptographic keys

npm install
npx prisma generate
npm run build

# Start with PM2
pm2 start dist/main.js --name kalasathi-ondc-backend
```

#### 3. Frontend UI

```bash
cd /var/www/kalasathi-ui
cp .env.aws.production .env
nano .env  # Set VITE_API_URL=https://kalasathi.com/api/v1

npm install
npm run build
# Built files will be output to /var/www/kalasathi-ui/dist
```

#### Save PM2 State

```bash
pm2 save
```

---

### Step 5: Configure Nginx Reverse Proxy & Enable SSL

1. Configure Nginx:

   ```bash
   sudo nano /etc/nginx/sites-available/kalasathi
   ```

   _(Paste the complete Nginx configuration block from Section 5 of [AWS_EC2_INSTANCE_SETUP_GUIDE.md](AWS_EC2_INSTANCE_SETUP_GUIDE.md))._

2. Activate site and test config:

   ```bash
   sudo ln -s /etc/nginx/sites-available/kalasathi /etc/nginx/sites-enabled/
   sudo rm -f /etc/nginx/sites-enabled/default
   sudo nginx -t
   sudo systemctl reload nginx
   ```

3. Issue Free Let's Encrypt SSL:
   ```bash
   sudo certbot --nginx -d kalasathi.com -d www.kalasathi.com
   ```

---

## 🛠️ Service Maintenance Cheat Sheet

| Task                         | Command                           |
| :--------------------------- | :-------------------------------- |
| **View Running Services**    | `pm2 status`                      |
| **Check E-Commerce Logs**    | `pm2 logs kalasathi-ecom-backend` |
| **Check ONDC Protocol Logs** | `pm2 logs kalasathi-ondc-backend` |
| **Restart All Services**     | `pm2 restart all`                 |
| **Check Nginx Status**       | `sudo systemctl status nginx`     |
| **Test Nginx Syntax**        | `sudo nginx -t`                   |
| **Reload Nginx**             | `sudo systemctl reload nginx`     |
| **Renew SSL Dry Run**        | `sudo certbot renew --dry-run`    |
