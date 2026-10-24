# AWS RDS MySQL Database Setup Guide — Kalasathi Production

This guide documents the step-by-step configuration to create, secure, and connect the **AWS RDS MySQL Database** for Kalasathi in the AWS Console, ensuring **100% Free Tier compliance** and **zero accidental charges**.

---

## 1. Selected Database Architecture

| Parameter                  | Decision                              | Specification                                                               |
| :------------------------- | :------------------------------------ | :-------------------------------------------------------------------------- |
| **AWS Region**             | **Asia Pacific (Mumbai)**             | `ap-south-1` _(Co-located in the same region and VPC as your EC2 instance)_ |
| **Database Engine**        | **MySQL Community**                   | **MySQL 8.0.xx** _(Matches local environment & Prisma ORM)_                 |
| **Deployment Option**      | **Single-AZ (1 instance)**            | Lightweight, stable, and covered under Free Tier                            |
| **DB Instance Class**      | **`db.t4g.micro`** (or `db.t3.micro`) | 2 vCPUs, 1 GiB RAM (AWS Graviton2 ARM)                                      |
| **Storage**                | **20 GiB `gp3` SSD**                  | Maximum 100% free storage limit _(Autoscaling OFF)_                         |
| **Public Access**          | **No (Strictly Private)**             | Database is completely hidden from the public internet                      |
| **Initial Database Name**  | **`kalasathi_ecom`**                  | Auto-creates the database schema for Prisma connection                      |
| **Estimated Monthly Cost** | **$0.00 / mo (Free Tier)**            | 750 hours/month + 20 GB storage free for first 12 months                    |

---

## 2. AWS Console: Create Database Step-by-Step

Log into the **AWS Management Console**, ensure your region is set to **Asia Pacific (Mumbai) `ap-south-1`**, and navigate to **RDS $\rightarrow$ Databases $\rightarrow$ Create database**.

### Step 2.1: Creation Method & Engine Options

- **Database creation method:** Select 👉 **Standard create** _(gives full control over settings)_.
- **Engine type:** Select 👉 **MySQL**.
- **Edition:** **MySQL Community**.
- **Engine version:** **MySQL 8.0.xx** _(Select the latest 8.0 version, e.g., 8.0.35 or 8.0.36)_.
  > ⚠️ **Notice:** If you see a checkbox labeled _"Show only versions that support Multi-AZ DB cluster"_, make sure it is **unchecked**.

### Step 2.2: Templates (⚠️ Prevents Expensive Auto-Defaults)

- Under **Templates**, select 👉 **Free tier**.
  _(If "Free tier" is grayed out, choose **Sandbox** or **Dev/Test** and ensure Single-AZ is selected in the next step)._

### Step 2.3: Availability and Durability

- Under **Deployment options**, select:
  👉 **Single-AZ DB instance deployment (1 instance)**
  > 🚨 **Critical:** Do NOT select _Multi-AZ DB cluster (3 instances)_ or _Multi-AZ DB instance (2 instances)_. Those are expensive high-availability setups costing $600–$1,700/month!

### Step 2.4: Settings & Credentials

- **DB instance identifier:** `kalasathi-db`
- **Master username:** `admin`
- **Credentials management:** Select 👉 **Self managed** _(Do NOT select AWS Secrets Manager, which incurs extra monthly fees)_.
- **Master password:** Enter a strong password _(e.g. 16+ characters with letters, numbers, and symbols)_.
- **Confirm master password:** Re-type your password.
  > 📝 **Save this password!** You will need it immediately for your backend `.env` file.

### Step 2.5: Instance Configuration

- Select: **Burstable classes (includes t classes)**.
- In the dropdown, choose: 👉 **`db.t4g.micro`** (or **`db.t3.micro`**).
  > ⚠️ **Check:** Verify the dropdown says `micro`. Do NOT select `large`, `m5d`, or `r5`.

### Step 2.6: Storage Configuration

- **Storage type:** Select **General Purpose SSD (`gp3`)** _(or `gp2`)_.
- **Allocated storage:** Type 👉 **`20` GiB** _(change from 400 to 20)_.
- **Storage autoscaling:** 👉 **Uncheck / Turn OFF** _"Enable storage autoscaling"_.
  > ⚠️ **Why:** If left checked, AWS will automatically expand your disk to 1,000 GB over time and bill you for the excess storage.

### Step 2.7: Connectivity (Networking & Security)

- **Compute resource:** Select **Don't connect to an EC2 compute resource** _(we configure security group access directly)_.
- **Virtual private cloud (VPC):** Select your **Default VPC (`vpc-0ab38a3dad259916a`)** _(must match your EC2 instance)_.
- **DB Subnet group:** `default-vpc-0ab38a3dad259916a`.
- **Public access:** Select 👉 **No**.
  > 🔒 **Why:** With Public access set to "No", hackers cannot scan or attack your database port. Only your EC2 server inside the same VPC can reach it.
- **VPC security group (firewall):** Select **Create new**.
  - **New VPC security group name:** Type 👉 **`kalasathi-rds-sg`**.
- **Availability Zone:** `No preference`.
- **Database port:** `3306`.

### Step 2.8: Database Authentication & Monitoring

- **Database authentication:** **Password authentication**.
- **Monitoring:**
  - Select 👉 **Database Insights - Standard** _(Free for 7 days retention)_.
  - Do NOT select _Advanced_ (which incurs extra CloudWatch charges).

### Step 2.9: Additional Configuration (Click arrow to expand at bottom)

1. **Initial database name:** Type 👉 **`kalasathi_ecom`**
   > ⚠️ **Crucial:** If you leave this blank, RDS will start with no database schema, causing your backend connection to fail with `Unknown database 'kalasathi_ecom'`.
2. **Automated backups:** Keep **Enabled** (Backup retention period: **7 days**).
3. **Backup window:** `No preference`.
4. **Encryption:** Enable encryption (default AWS KMS key).
5. **Deletion protection:** **Enable deletion protection** _(prevents accidental deletion from the console)_.

---

### Step 2.10: Final Price Verification & Creation

Scroll to the very bottom and inspect the **Estimated monthly costs** box:

- It should say: 👉 **"Free tier eligible"** (or ~$0.00 – $13.50 USD).
- Click the orange button: 👉 **Create database**.

_(It takes AWS approximately **5 to 8 minutes** to provision the database. The status will transition from `Creating` to `Available`)._

---

## 3. Configuring the Security Group (EC2 $\leftrightarrow$ RDS Bridge)

Once the database status turns **Available**, link the RDS firewall to allow incoming traffic **only** from your EC2 server:

1. In the AWS Console, open **EC2 $\rightarrow$ Network & Security $\rightarrow$ Security Groups**.
2. Find your EC2 security group: **`kalasathi-web-sg`** and copy its **Security Group ID** (starts with `sg-xxxxxxxxxxxxxxxxx`).
3. Now click on the RDS security group: **`kalasathi-rds-sg`**.
4. Click the **Inbound rules** tab $\rightarrow$ click **Edit inbound rules**.
5. Ensure there is one rule configured as follows:

| Type             | Protocol | Port Range | Source Type | Source Value                                           | Description                                   |
| :--------------- | :------: | :--------: | :---------- | :----------------------------------------------------- | :-------------------------------------------- |
| **MySQL/Aurora** |   TCP    |   `3306`   | **Custom**  | `sg-xxxxxxxxxxxxxxxxx` _(Paste `kalasathi-web-sg` ID)_ | Allow internal access from Kalasathi EC2 only |

6. Click **Save rules**.

---

## 4. Connecting and Migrating the Database from EC2

### Step 4.1: Retrieve your RDS Endpoint

1. Go to **RDS $\rightarrow$ Databases $\rightarrow$ `kalasathi-db`**.
2. Under the **Connectivity & security** tab, copy the **Endpoint** URL:
   ```
   kalasathi-db.xxxxxxxxxxxx.ap-south-1.rds.amazonaws.com
   ```

### Step 4.2: Test Connection from your EC2 Instance

SSH into your EC2 server and test the database connection using the MySQL client:

```bash
# 1. Install mysql-client if not already installed
sudo apt install -y mysql-client

# 2. Test the connection (replace with your RDS endpoint and password)
mysql -h kalasathi-db.xxxxxxxxxxxx.ap-south-1.rds.amazonaws.com -P 3306 -u admin -p
```

_Enter your master password when prompted. If successful, you will see the `mysql>` prompt. Type `exit` to return to bash._

---

## 5. Backend Configuration (`.env`)

Update the `DATABASE_URL` in your production `.env` files:

### For `kalasathi-ecom-backend/.env`:

```env
# Database Configuration
DATABASE_URL="mysql://admin:YOUR_MASTER_PASSWORD@kalasathi-db.xxxxxxxxxxxx.ap-south-1.rds.amazonaws.com:3306/kalasathi_ecom"
```

### For `kalasathi-ondc-backend/.env`:

```env
# Point both backends to the unified database
DATABASE_URL="mysql://admin:YOUR_MASTER_PASSWORD@kalasathi-db.xxxxxxxxxxxx.ap-south-1.rds.amazonaws.com:3306/kalasathi_ecom"
ONDC_DB_URL="mysql://admin:YOUR_MASTER_PASSWORD@kalasathi-db.xxxxxxxxxxxx.ap-south-1.rds.amazonaws.com:3306/kalasathi_ecom"
```

---

## 6. Running Prisma Migrations to Create All Tables

Once `.env` is configured on your EC2 instance, execute Prisma migrations to create all database tables:

```bash
cd /var/www/kalasathi-ecom-backend

# 1. Generate Prisma Client
npx prisma generate

# 2. Run all database migrations
npx prisma migrate deploy
```

_(This automatically generates all tables: `users`, `seller_profiles`, `stores`, `store_locations`, `products`, `orders`, and related indexes)._

---

## 7. Emergency Maintenance & Backup Operations

### Creating a Manual Snapshot (Before Major Updates)

Before doing a major release, you can create a zero-downtime manual backup in 30 seconds:

1. In the RDS Console, select `kalasathi-db`.
2. Click **Actions $\rightarrow$ Take snapshot**.
3. Name it `kalasathi-db-pre-migration-backup` and click **Take snapshot**.

### Quick S3 SQL Dump Command (Run from EC2)

You can also take an instant compressed SQL dump directly to your S3 bucket:

```bash
mysqldump -h kalasathi-db.xxxxxxxxxxxx.ap-south-1.rds.amazonaws.com -u admin -p kalasathi_ecom | gzip > backup-$(date +%F).sql.gz
```
