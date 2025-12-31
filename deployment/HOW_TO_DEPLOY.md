# How to Deploy MakeTheCase to Ubuntu Server

This guide covers deploying the MakeTheCase application to `https://services.byu.edu/makethecase` on an Ubuntu Linux server.

## Server Details
- **URL**: `https://services.byu.edu/makethecase`
- **Server Path**: `/var/www/jsapps/makethecase`
- **Backend Port**: `3001` (internal, proxied through Apache)
- **Process Manager**: PM2

---

## Initial Setup (One-Time)

### 1. Prerequisites

Ensure these are installed on your Ubuntu server:

```bash
# Node.js (v18 or later)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# MySQL
sudo apt-get update
sudo apt-get install mysql-server

# PM2 (process manager)
sudo npm install -g pm2

# Apache modules (if not already enabled)
sudo a2enmod proxy proxy_http rewrite headers ssl
```

### 2. Clone Repository

```bash
cd /var/www/jsapps
sudo git clone https://github.com/YOUR_USERNAME/MakeTheCase.git makethecase
sudo chown -R $USER:$USER makethecase
cd makethecase
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Set Up MySQL Database

```bash
mysql -u root -p < docs/mysql-database-structure-Oct2025.sql
mysql -u root -p < server/migrations/add_admin_auth.sql
mysql -u root -p < server/migrations/add_cases_tables.sql
```

### 5. Configure Environment Variables

```bash
cp env.local.example .env.local
nano .env.local
```

**Required settings:**
```bash
# API Keys
GEMINI_API_KEY=your_actual_gemini_key
OPENAI_API_KEY=your_actual_openai_key
ANTHROPIC_API_KEY=your_actual_anthropic_key

# MySQL Database
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=your_mysql_username
MYSQL_PASSWORD=your_mysql_password
MYSQL_DATABASE=ceochat

# JWT Secret (generate a random string)
JWT_SECRET=$(openssl rand -base64 32)

# Server port
SERVER_PORT=3001

# BYU CAS configuration
CAS_ENABLED=true
CAS_SERVER_URL=https://cas.byu.edu/cas/
CAS_SERVICE_BASE_URL=https://services.byu.edu/makethecase
CAS_REDIRECT_BASE_URL=https://services.byu.edu/makethecase
SESSION_COOKIE_PATH=/makethecase
SESSION_COOKIE_DOMAIN=.byu.edu
CAS_ATTR_EMAIL_FIELD=emailAddress
CAS_ATTR_NETID_FIELD=user
CAS_ATTR_PREFERRED_FIRST_FIELD=preferredFirstName
CAS_ATTR_PREFERRED_LAST_FIELD=preferredSurname
CAS_ATTR_FIRSTNAME_FIELD=givenName
CAS_ATTR_LASTNAME_FIELD=sn

# Production mode
NODE_ENV=production
```

### 6. Create Admin Account

```bash
npm run create-admin admin@byu.edu yourpassword
```

### 7. (Optional) Seed Initial Case

```bash
npm run seed-malawis
```

### 8. Build Frontend

```bash
NODE_ENV=production npm run build
```

### 9. Set Up PM2

```bash
# Create logs directory
mkdir -p logs

# Start the application
pm2 start ecosystem.config.cjs

# Save PM2 configuration
pm2 save

# Set up PM2 to start on system boot
pm2 startup
# Follow the instructions provided by the command
```

### 10. Configure Apache

```bash
# Copy Apache configuration
sudo cp deployment/makethecase.conf /etc/apache2/ses-includes/services/0002_443_makethecase.conf

# Test Apache configuration
sudo apache2ctl configtest

# Reload Apache
sudo systemctl reload apache2
```

**Note:** Adjust the destination path if your Apache configuration structure is different.

### 11. Verify Deployment

```bash
# Check PM2 status
pm2 status

# Check PM2 logs
pm2 logs makethecase --lines 20

# Test API endpoint
curl http://localhost:3001/api/health

# Test through Apache proxy
curl https://services.byu.edu/makethecase/api/health
```

Visit `https://services.byu.edu/makethecase` in your browser to verify the app is working.

---

## Regular Deployment (Updates)

When you need to deploy updates:

### 1. SSH into Server

```bash
ssh user@your-server
cd /var/www/jsapps/makethecase
```

### 2. Pull Latest Code

```bash
git pull origin main
# (or 'master' depending on your default branch)
```

### 3. Install/Update Dependencies

```bash
npm install
```

### 4. Run Database Migrations (if any)

```bash
# Check if there are new migration files
ls -la server/migrations/

# Run new migrations if needed
mysql -u root -p < server/migrations/new_migration.sql
```

### 5. Build Frontend

**Important:** Always build with `NODE_ENV=production`:

```bash
NODE_ENV=production npm run build
```

### 6. Restart PM2

```bash
pm2 restart makethecase
```

### 7. Verify Deployment

```bash
# Check logs for errors
pm2 logs makethecase --lines 30

# Test API
curl http://localhost:3001/api/health

# Check if app loads in browser
# Visit: https://services.byu.edu/makethecase
```

---

## Quick Deployment Script

You can create a simple deployment script to automate the regular deployment steps:

```bash
#!/bin/bash
# Save as: deploy.sh

cd /var/www/jsapps/makethecase
echo "Pulling latest code..."
git pull origin main

echo "Installing dependencies..."
npm install

echo "Building frontend..."
NODE_ENV=production npm run build

echo "Restarting PM2..."
pm2 restart makethecase

echo "Checking status..."
pm2 status

echo "Deployment complete! Check logs with: pm2 logs makethecase"
```

Make it executable:
```bash
chmod +x deploy.sh
```

Then run:
```bash
./deploy.sh
```

---

## Important Commands Reference

### PM2 Commands
```bash
pm2 status                    # Check app status
pm2 logs makethecase          # View logs (Ctrl+C to exit)
pm2 logs makethecase --lines 50  # View last 50 lines
pm2 restart makethecase       # Restart app
pm2 stop makethecase          # Stop app
pm2 start makethecase         # Start app
pm2 monit                     # Monitor resources
```

### Apache Commands
```bash
sudo systemctl status apache2    # Check Apache status
sudo systemctl reload apache2    # Reload config (no downtime)
sudo systemctl restart apache2   # Restart Apache
sudo apache2ctl configtest       # Test configuration
sudo tail -f /var/log/apache2/error.log  # View error log
```

### Database Commands
```bash
mysql -u root -p ceochat         # Connect to database
mysql -u root -p < file.sql      # Run SQL file
```

### Testing Endpoints
```bash
# Test backend directly
curl http://localhost:3001/api/health
curl http://localhost:3001/api/sections?enabled=true

# Test through Apache
curl https://services.byu.edu/makethecase/api/health
curl https://services.byu.edu/makethecase/api/sections?enabled=true
```

---

## Troubleshooting

### App Not Loading
1. Check PM2: `pm2 status` and `pm2 logs makethecase`
2. Check Apache: `sudo systemctl status apache2`
3. Check database connection in PM2 logs
4. Verify `.env.local` exists and has correct values

### Database Connection Issues
See: `deployment/DEBUG_DATABASE.md`

### Case Files Not Loading
See: `deployment/PRODUCTION_DIAGNOSTIC.md`

### API Requests Failing
1. Check browser console (F12) for errors
2. Verify API base path is `/makethecase/api` (not `/api`)
3. Check Apache proxy configuration
4. Verify backend is running: `curl http://localhost:3001/api/health`

### Static Files Not Loading
1. Verify `dist/` directory exists: `ls -la dist/`
2. Check Apache `Alias` configuration points to correct path
3. Verify file permissions: `ls -la /var/www/jsapps/makethecase/dist`

---

## File Locations Reference

```
/var/www/jsapps/makethecase/          # Application root
├── .env.local                        # Environment variables (not in git)
├── ecosystem.config.cjs              # PM2 configuration
├── dist/                             # Built frontend (generated)
├── server/                           # Backend code
├── case_files/                       # Case content files
├── deployment/                       # Deployment files
│   ├── makethecase.conf             # Apache configuration
│   ├── HOW_TO_DEPLOY.md            # This file
│   └── ...
└── logs/                             # PM2 logs (generated)
```

---

## Security Notes

1. **Never commit `.env.local`** - It contains sensitive API keys and passwords
2. **Keep dependencies updated**: `npm audit` and `npm update`
3. **Regular backups**: Back up the MySQL database regularly
4. **Monitor logs**: Set up log monitoring for errors
5. **File permissions**: Ensure proper file permissions (case_files, dist, etc.)

---

## Updating Apache Configuration

If you need to update the Apache config:

```bash
# Edit the config file
sudo nano /etc/apache2/ses-includes/services/0002_443_makethecase.conf

# Or copy from deployment directory
sudo cp /var/www/jsapps/makethecase/deployment/makethecase.conf \
       /etc/apache2/ses-includes/services/0002_443_makethecase.conf

# Test configuration
sudo apache2ctl configtest

# Reload Apache
sudo systemctl reload apache2
```

---

## Need Help?

- **Database issues**: See `deployment/DEBUG_DATABASE.md`
- **Case file issues**: See `deployment/PRODUCTION_DIAGNOSTIC.md`
- **General deployment issues**: See `deployment/DEPLOYMENT_FIX.md`
