# MakeTheCase - Ubuntu Production Server Deployment Guide

**Date**: 2025-01-04
**Version**: Case Prep & Prompt Management Feature
**Target**: Ubuntu Linux Production Server

---

## Overview

This guide covers deploying the MakeTheCase application with the new Case Prep & Prompt Management features to an Ubuntu production server.

## Prerequisites

- Ubuntu 20.04 LTS or newer
- Root or sudo access
- Domain name configured (optional but recommended)
- SSL certificate (Let's Encrypt recommended)

---

## Part 1: System Preparation

### 1.1 Update System

```bash
sudo apt update
sudo apt upgrade -y
```

### 1.2 Install Node.js (v18 LTS or newer)

```bash
# Install Node.js from NodeSource
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # Should be v18.x or higher
npm --version   # Should be 9.x or higher
```

### 1.3 Install MySQL

```bash
# Install MySQL Server
sudo apt install -y mysql-server

# Secure MySQL installation
sudo mysql_secure_installation

# Start and enable MySQL
sudo systemctl start mysql
sudo systemctl enable mysql
```

### 1.4 Install PM2 (Process Manager)

```bash
# Install PM2 globally
sudo npm install -g pm2

# Configure PM2 to start on boot
pm2 startup systemd
# Follow the command output instructions
```

### 1.5 Install Nginx (Reverse Proxy)

```bash
# Install Nginx
sudo apt install -y nginx

# Start and enable Nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

---

## Part 2: Database Setup

### 2.1 Create MySQL Database and User

```bash
sudo mysql -u root -p
```

```sql
-- Create database
CREATE DATABASE ceochat CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Create production user
CREATE USER 'makethecase'@'localhost' IDENTIFIED BY 'STRONG_PASSWORD_HERE';

-- Grant privileges
GRANT ALL PRIVILEGES ON ceochat.* TO 'makethecase'@'localhost';

-- Flush privileges
FLUSH PRIVILEGES;

-- Exit MySQL
EXIT;
```

### 2.2 Import Existing Database Schema

If migrating from development:

```bash
# Option 1: Import from SQL dump
mysql -u makethecase -p ceochat < /path/to/backup.sql

# Option 2: Run migrations
mysql -u makethecase -p ceochat < server/migrations/001_case_prep_and_prompts.sql
mysql -u makethecase -p ceochat < server/migrations/002_additional_prompt_templates.sql
```

---

## Part 3: Application Deployment

### 3.1 Create Application Directory

```bash
# Create app directory
sudo mkdir -p /var/www/makethecase
sudo chown -R $USER:$USER /var/www/makethecase
cd /var/www/makethecase
```

### 3.2 Clone/Upload Application

**Option A: Git Clone**
```bash
git clone YOUR_REPO_URL .
git checkout main
```

**Option B: Manual Upload**
```bash
# Upload files via SCP from your Windows machine
scp -r "C:\Users\ses3\OneDrive - Brigham Young University\Apps\MakeTheCase\*" user@server:/var/www/makethecase/
```

### 3.3 Install Dependencies

**Backend Dependencies:**
```bash
cd /var/www/makethecase
npm install

# Verify critical packages are installed
npm list mammoth react-pdf react-markdown
```

**Expected New Packages:**
- `mammoth@1.6.0` - Word document conversion
- `react-pdf@^7.0.0` - PDF viewing
- `react-markdown@^9.0.0` - Markdown rendering
- `remark-gfm` - GitHub-flavored markdown support

### 3.4 Configure Environment Variables

```bash
# Create production environment file
nano .env.production

# Add the following (adjust values):
```

**.env.production:**
```bash
# Server Configuration
NODE_ENV=production
SERVER_PORT=3001

# Database Configuration
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=makethecase
MYSQL_PASSWORD=STRONG_PASSWORD_HERE
MYSQL_DATABASE=ceochat

# AI API Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...

# JWT Secret (generate with: openssl rand -base64 32)
JWT_SECRET=YOUR_GENERATED_JWT_SECRET_HERE

# Optional: CAS Authentication
CAS_URL=https://cas.byu.edu/cas
CAS_SERVICE_URL=https://yourdomain.com/api/cas/callback
```

### 3.5 Build Frontend

```bash
# Build the React frontend
npm run build

# Verify build output
ls -la dist/
# Should show index.html, assets/, etc.
```

### 3.6 Create Case Files Directory

```bash
# Create directory for case file uploads
sudo mkdir -p /var/www/makethecase/case_files
sudo chown -R $USER:$USER /var/www/makethecase/case_files
sudo chmod 755 /var/www/makethecase/case_files

# Create subdirectories for existing cases
mkdir -p /var/www/makethecase/case_files/malawis-pizza/uploads
```

---

## Part 4: PM2 Configuration

### 4.1 Create PM2 Ecosystem File

```bash
nano ecosystem.config.js
```

**ecosystem.config.js:**
```javascript
module.exports = {
  apps: [{
    name: 'makethecase',
    script: './server/index.js',
    instances: 2,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      SERVER_PORT: 3001
    },
    env_file: '.env.production',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    // Graceful shutdown
    kill_timeout: 5000
  }]
};
```

### 4.2 Start Application with PM2

```bash
# Create logs directory
mkdir -p logs

# Start the application
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Check status
pm2 status
pm2 logs makethecase --lines 50
```

---

## Part 5: Nginx Configuration

### 5.1 Create Nginx Site Configuration

```bash
sudo nano /etc/nginx/sites-available/makethecase
```

**/etc/nginx/sites-available/makethecase:**
```nginx
# Upstream Node.js application
upstream makethecase_backend {
    least_conn;
    server 127.0.0.1:3001 max_fails=3 fail_timeout=30s;
    keepalive 32;
}

# HTTP server (redirect to HTTPS)
server {
    listen 80;
    listen [::]:80;
    server_name yourdomain.com www.yourdomain.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

# HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    # SSL Configuration (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;

    # Modern SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Root directory for static files
    root /var/www/makethecase/dist;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml+rss;

    # Proxy API requests to Node.js backend
    location /api/ {
        proxy_pass http://makethecase_backend;
        proxy_http_version 1.1;

        # Headers
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts (important for file uploads and AI processing)
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        send_timeout 300s;

        # Buffer settings for large responses
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
        proxy_busy_buffers_size 8k;

        # Disable cache for API
        proxy_cache_bypass $http_upgrade;
    }

    # Serve static files from dist
    location / {
        try_files $uri $uri/ /index.html;
        expires 1h;
        add_header Cache-Control "public, immutable";
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # File upload size limit (10MB for case files)
    client_max_body_size 10M;
    client_body_buffer_size 128k;

    # Access and error logs
    access_log /var/log/nginx/makethecase_access.log;
    error_log /var/log/nginx/makethecase_error.log;
}
```

### 5.2 Enable Site and Test Configuration

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/makethecase /etc/nginx/sites-enabled/

# Test Nginx configuration
sudo nginx -t

# If OK, reload Nginx
sudo systemctl reload nginx
```

---

## Part 6: SSL Certificate (Let's Encrypt)

### 6.1 Install Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
```

### 6.2 Obtain SSL Certificate

```bash
# Obtain certificate (Nginx plugin)
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Follow the prompts
# Choose redirect HTTP to HTTPS: Yes
```

### 6.3 Auto-Renewal

```bash
# Test renewal
sudo certbot renew --dry-run

# Certbot auto-renewal is configured via systemd timer
sudo systemctl status certbot.timer
```

---

## Part 7: Database Migration

### 7.1 Run Production Migrations

```bash
cd /var/www/makethecase

# Run migrations
mysql -u makethecase -p ceochat < server/migrations/001_case_prep_and_prompts.sql
mysql -u makethecase -p ceochat < server/migrations/002_additional_prompt_templates.sql
```

### 7.2 Verify Database

```bash
mysql -u makethecase -p ceochat
```

```sql
-- Check tables exist
SHOW TABLES;

-- Should see: ai_prompts, settings, case_files (with new columns)

-- Check prompt count
SELECT COUNT(*) FROM ai_prompts;
-- Should return 8

-- Check settings
SELECT * FROM settings;

-- Exit
EXIT;
```

---

## Part 8: Firewall Configuration

### 8.1 Configure UFW (Ubuntu Firewall)

```bash
# Allow SSH (IMPORTANT: Do this first!)
sudo ufw allow OpenSSH

# Allow HTTP and HTTPS
sudo ufw allow 'Nginx Full'

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

---

## Part 9: Monitoring & Maintenance

### 9.1 PM2 Monitoring

```bash
# View logs
pm2 logs makethecase

# Monitor resources
pm2 monit

# Restart application
pm2 restart makethecase

# View detailed info
pm2 info makethecase
```

### 9.2 Log Rotation

**Create PM2 log rotation:**
```bash
pm2 install pm2-logrotate

# Configure log rotation
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 10
pm2 set pm2-logrotate:compress true
```

### 9.3 System Monitoring

```bash
# Install htop for system monitoring
sudo apt install -y htop

# Monitor system resources
htop

# Check disk usage
df -h

# Check case_files directory size
du -sh /var/www/makethecase/case_files
```

### 9.4 Backup Strategy

**Create backup script:**
```bash
nano /home/$USER/backup-makethecase.sh
```

```bash
#!/bin/bash
# MakeTheCase Backup Script

BACKUP_DIR="/backups/makethecase"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup database
mysqldump -u makethecase -p'PASSWORD' ceochat > $BACKUP_DIR/db_$DATE.sql

# Backup case files
tar -czf $BACKUP_DIR/case_files_$DATE.tar.gz /var/www/makethecase/case_files

# Keep only last 7 days
find $BACKUP_DIR -name "db_*.sql" -mtime +7 -delete
find $BACKUP_DIR -name "case_files_*.tar.gz" -mtime +7 -delete

echo "Backup completed: $DATE"
```

```bash
# Make executable
chmod +x /home/$USER/backup-makethecase.sh

# Schedule daily backup (3 AM)
crontab -e
```

Add:
```
0 3 * * * /home/$USER/backup-makethecase.sh >> /var/log/makethecase_backup.log 2>&1
```

---

## Part 10: Deployment Checklist

### Pre-Deployment
- [ ] Ubuntu server prepared with Node.js, MySQL, Nginx
- [ ] Database created and migrations run
- [ ] Environment variables configured in `.env.production`
- [ ] SSL certificate obtained
- [ ] Firewall configured

### Deployment
- [ ] Application files uploaded/cloned
- [ ] Dependencies installed (`npm install`)
- [ ] Frontend built (`npm run build`)
- [ ] Case files directory created with correct permissions
- [ ] PM2 started and saved
- [ ] Nginx configured and reloaded

### Post-Deployment
- [ ] Application accessible via HTTPS
- [ ] Admin login works
- [ ] Can access new tabs: Case Prep, Prompts, Settings
- [ ] File upload works (test with small PDF)
- [ ] AI processing works (test case outline generation)
- [ ] Prompt management works (create/edit prompts)
- [ ] Settings updates work (change active prompts)
- [ ] PM2 auto-starts on server reboot
- [ ] Backups configured and tested
- [ ] Monitoring dashboard accessible

### Testing
- [ ] Upload PDF file in Case Prep tab
- [ ] Process file with AI model
- [ ] Edit outline in side-by-side editor
- [ ] Create new prompt template
- [ ] Change active prompt in Settings
- [ ] Verify AI uses new prompt

---

## Part 11: Troubleshooting

### Application Won't Start

```bash
# Check PM2 logs
pm2 logs makethecase --err --lines 100

# Check if port 3001 is in use
sudo netstat -tulpn | grep 3001

# Test database connection
mysql -u makethecase -p ceochat -e "SELECT 1;"
```

### File Upload Fails

```bash
# Check directory permissions
ls -la /var/www/makethecase/case_files

# Should be owned by your user
sudo chown -R $USER:$USER /var/www/makethecase/case_files

# Check Nginx error log
sudo tail -f /var/log/nginx/makethecase_error.log
```

### AI Processing Fails

```bash
# Check API keys in environment
pm2 env 0  # Shows environment variables

# Check application logs
pm2 logs makethecase | grep -i error

# Test API key manually
curl https://api.openai.com/v1/models -H "Authorization: Bearer YOUR_API_KEY"
```

### PDF Conversion Issues

```bash
# Verify pdf-parse is installed
npm list pdf-parse

# Check if file is readable
ls -la /var/www/makethecase/case_files/*/uploads/

# Test file conversion manually
node -e "const converter = require('./server/services/fileConverter'); converter.convertFile('/path/to/file.pdf', '.pdf').then(console.log);"
```

---

## Part 12: Updates & Maintenance

### Deploying Updates

```bash
# Navigate to app directory
cd /var/www/makethecase

# Backup current version
cp -r . ../makethecase_backup_$(date +%Y%m%d)

# Pull latest code (if using Git)
git pull origin main

# Install any new dependencies
npm install

# Rebuild frontend
npm run build

# Run any new migrations
mysql -u makethecase -p ceochat < server/migrations/NEW_MIGRATION.sql

# Restart application
pm2 restart makethecase

# Monitor for errors
pm2 logs makethecase --lines 50
```

### Rollback Procedure

```bash
# Stop current version
pm2 stop makethecase

# Restore from backup
cd /var/www
mv makethecase makethecase_failed
mv makethecase_backup_YYYYMMDD makethecase

# Restart
cd makethecase
pm2 restart makethecase
```

---

## Security Recommendations

1. **Keep System Updated**
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

2. **Restrict Database Access**
   - MySQL should only listen on localhost
   - Use strong passwords
   - Regular security audits

3. **Monitor Failed Login Attempts**
   ```bash
   sudo apt install fail2ban
   sudo systemctl enable fail2ban
   ```

4. **Regular Backups**
   - Daily database backups
   - Weekly file backups
   - Store backups off-server

5. **API Key Security**
   - Never commit API keys to Git
   - Rotate keys regularly
   - Monitor API usage for anomalies

---

## Support & Resources

- **Application Logs**: `/var/www/makethecase/logs/`
- **Nginx Logs**: `/var/log/nginx/makethecase_*.log`
- **PM2 Logs**: `pm2 logs makethecase`
- **Database Logs**: `/var/log/mysql/error.log`

---

**End of Deployment Guide**
