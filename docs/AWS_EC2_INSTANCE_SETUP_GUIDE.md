# AWS EC2 Instance Setup Guide — Kalasathi Production

This guide documents the exact, verified configuration to launch and configure the production **Amazon EC2 instance** for Kalasathi in the AWS Console.

---

## 1. Selected Stack & Sizing Architecture

| Parameter            | Decision                    | Specification                                                      |
| :------------------- | :-------------------------- | :----------------------------------------------------------------- |
| **AWS Region**       | **Asia Pacific (Mumbai)**   | `ap-south-1` _(Lowest latency for Indian shoppers & ONDC network)_ |
| **Instance Type**    | **`t4g.small`**             | 2 vCPUs, 2 GB RAM (AWS Graviton2 64-bit ARM processor)             |
| **Operating System** | **Ubuntu Server 24.04 LTS** | 64-bit (Arm) HVM, SSD Volume Type _(Free Tier eligible)_           |
| **Storage (EBS)**    | **30 GB `gp3` SSD**         | Baseline 3,000 IOPS, 125 MB/s throughput _(Free Tier eligible)_    |
| **Static IP**        | **1 Elastic IP (IPv4)**     | Fixed public IP for stable domain DNS & ONDC BPP URI               |
| **Web Server / SSL** | **Nginx + Let's Encrypt**   | HTTP/2, Gzip/Brotli, 100% Free Auto-renewing TLS 1.3               |
| **Estimated Cost**   | **~$12.20 / mo (~₹1,020)**  | Highest performance-per-rupee on AWS                               |

---

## 2. AWS Console: Launch Instance Step-by-Step

Log into the **AWS Management Console**, switch the region dropdown in the top-right to **Asia Pacific (Mumbai) `ap-south-1`**, and navigate to **EC2 $\rightarrow$ Instances $\rightarrow$ Launch instances**.

### Step 2.1: Name and Tags

- **Name:** `kalasathi-web-prod`

### Step 2.2: Application and OS Images (Amazon Machine Image)

- Click the **Ubuntu** tile.
- **Amazon Machine Image (AMI):** Select **Ubuntu Server 24.04 LTS (HVM), SSD Volume Type** _(Free tier eligible)_.
  > ⚠️ **Caution:** Do NOT select _Ubuntu Pro_ (which incurs extra subscription fees).
- **Architecture:** Select 👉 **64-bit (Arm)**.
  > ⚠️ **Important:** Because `t4g` uses AWS Graviton processors, you must select **64-bit (Arm)**. If left on _x86_, `t4g.small` will not appear in the list.

### Step 2.3: Instance Type

- Search and select: 👉 **`t4g.small`** (2 vCPUs, 2.0 GiB Memory).

### Step 2.4: Key Pair (Login)

- Click **Create new key pair** (or select your existing key pair):
  - **Key pair name:** `kalasathi-key`
  - **Key pair type:** `RSA`
  - **Private key file format:** `.pem` (for OpenSSH / macOS / Linux / Windows Terminal)
- Click **Create key pair** and save the downloaded `kalasathi-key.pem` securely.

### Step 2.5: Network Settings (Firewall / Security Group)

Click **Edit** on the top-right of the Network settings card:

- **VPC:** Select default VPC (`vpc-0ab38a3dad259916a`).
- **Subnet:** `No preference` (Default subnet).
- **Auto-assign public IP:** `Enable`.
- **Firewall (security groups):** Select **Create security group**.
  - **Security group name:** `kalasathi-web-sg`
  - **Description:** `Security group for Kalasathi Web and APIs`

#### Inbound Security Group Rules:

| Type      | Protocol | Port Range | Source Type  | Source CIDR           | Purpose                                                          |
| :-------- | :------: | :--------: | :----------- | :-------------------- | :--------------------------------------------------------------- |
| **SSH**   |   TCP    |    `22`    | **My IP**    | `<Your-Public-IP>/32` | Secure terminal access (Prevents brute-force bots)               |
| **HTTPS** |   TCP    |   `443`    | **Anywhere** | `0.0.0.0/0`           | Public encrypted traffic (Web & ONDC)                            |
| **HTTP**  |   TCP    |    `80`    | **Anywhere** | `0.0.0.0/0`           | Let's Encrypt SSL challenges & HTTP $\rightarrow$ HTTPS redirect |

> 🔒 **Security Notice:** Keep ports `5002` (Ecom Backend), `5001` (ONDC Backend), and `3306` (MySQL) **closed** to the public. Nginx handles ports 80/443 and securely forwards requests to `localhost` internally.

### Step 2.6: Configure Storage

- **Size:** `30` GiB _(Free Tier covers up to 30 GB)_.
- **Volume Type:** Select **General Purpose SSD (`gp3`)**.
- Keep **Delete on termination** checked.

### Step 2.7: Launch

- Review the **Summary** card on the right.
- Click the orange button: 👉 **Launch instance**.

---

## 3. Allocate and Attach Elastic IP (Static IPv4)

To prevent your domain DNS and ONDC BPP connection from breaking on server reboots, attach a dedicated Elastic IP:

1. In the EC2 sidebar, navigate to **Network & Security $\rightarrow$ Elastic IPs**.
2. Click **Allocate Elastic IP address**.
3. Keep default settings (`Amazon's pool of IPv4 addresses`, Region: `ap-south-1`) and click **Allocate**.
4. Select the newly created Elastic IP, click **Actions $\rightarrow$ Associate Elastic IP address**.
   - **Resource type:** `Instance`
   - **Instance:** Select `kalasathi-web-prod`
   - **Private IP address:** Select the primary private IP of your instance.
5. Click **Associate**.

> 🌐 **Domain DNS Configuration:** In your domain registrar (GoDaddy / Cloudflare / Namecheap / Route 53), point your `A` records to this **Elastic IP address**:
>
> - `A` record for `@` (e.g. `kalasathi.com`) $\rightarrow$ `<YOUR_ELASTIC_IP>`
> - `A` record for `api` (e.g. `api.kalasathi.com`) $\rightarrow$ `<YOUR_ELASTIC_IP>`

---

## 4. Post-Launch Server Configuration (First-Time Setup)

Once the instance shows `Running` with `2/2 checks passed`, open your terminal on your computer and connect:

```bash
# 1. Set correct read-only permissions for your key pair
chmod 400 ~/.ssh/kalasathi-key.pem

# 2. SSH into your Ubuntu instance
ssh -i ~/.ssh/kalasathi-key.pem ubuntu@<YOUR_ELASTIC_IP>
```

Once inside the server, execute the following commands step-by-step:

### Step 4.1: Update Server Packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git build-essential ufw unzip
```

### Step 4.2: Enable 2 GB Swap Space (Zero Memory Ceiling Buffer)

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

_(Verify by running `free -h` — you will see 2.0G of Swap alongside your 2.0G of physical RAM)._

### Step 4.3: Install Node.js 20 LTS & PM2 (ARM64 Optimized)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
node -v  # Expected: v20.x.x
npm -v
```

### Step 4.4: Install & Configure Nginx Web Server

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

### Step 4.5: Install Certbot for Free Let's Encrypt SSL

```bash
sudo apt install -y certbot python3-certbot-nginx
```

---

## 5. Production Nginx Configuration File

Create the Nginx site configuration file on the server:

```bash
sudo nano /etc/nginx/sites-available/kalasathi
```

Paste the following production reverse proxy configuration (replace `kalasathi.com` with your actual domain):

```nginx
server {
    listen 80;
    server_name kalasathi.com www.kalasathi.com api.kalasathi.com;

    # Client body size limit for product photo uploads (up to 20MB)
    client_max_body_size 20M;

    # Gzip Compression for blazing fast delivery
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/rss+xml font/truetype font/opentype application/vnd.ms-fontobject image/svg+xml;

    # 1. E-Commerce Backend API Reverse Proxy
    location /api/v1/ {
        proxy_pass http://127.0.0.1:5002/api/v1/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 90s;
    }

    # 2. ONDC Beckn Protocol API Reverse Proxy
    location /api/v1/ondc/ {
        proxy_pass http://127.0.0.1:5001/api/v1/ondc/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # 3. Frontend Static Application (kalasathi-ui dist/)
    location / {
        root /var/www/kalasathi-ui/dist;
        index index.html index.htm;
        try_files $uri $uri/ /index.html;

        # Cache static assets for 30 days
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 30d;
            add_header Cache-Control "public, no-transform";
        }
    }
}
```

Enable the configuration and reload Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/kalasathi /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

---

## 6. Obtain Free SSL Certificate (HTTPS)

Once your domain DNS A-records are pointing to your Elastic IP, run:

```bash
sudo certbot --nginx -d kalasathi.com -d www.kalasathi.com -d api.kalasathi.com
```

Certbot will automatically verify domain ownership, generate the TLS 1.3 certificates, modify Nginx to enforce HTTPS, and set up an automated daily renewal cron job.

---

## 7. Pairing with RDS MySQL Database

When configuring your environment variables (`.env`) for `kalasathi-ecom-backend` and `kalasathi-ondc-backend`, point `DATABASE_URL` to your RDS endpoint:

```env
DATABASE_URL="mysql://admin:YOUR_PASSWORD@kalasathi-db.xxxxxxxx.ap-south-1.rds.amazonaws.com:3306/kalasathi_ecom"
```

In your RDS Security Group (`kalasathi-rds-sg`), ensure Port `3306` permits inbound traffic from the Security Group ID of this EC2 instance (`kalasathi-web-sg`).
