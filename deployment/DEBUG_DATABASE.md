# Database Connection Debugging Guide

## Step 1: Check PM2 Logs

First, check if the server started successfully and if there are any database connection errors:

```bash
pm2 logs makethecase --lines 50
```

Look for:
- `✓ MySQL connected successfully` - means DB connection worked
- `✗ MySQL connection failed` - means DB connection failed
- Any error messages about database access

## Step 2: Verify Environment Variables

PM2 needs to have access to your `.env.local` file. Check if it exists and has the correct values:

```bash
cd /var/www/jsapps/makethecase
cat .env.local
```

Verify these are set correctly:
- `MYSQL_HOST=localhost` (or your MySQL host)
- `MYSQL_PORT=3306`
- `MYSQL_USER=your_mysql_username`
- `MYSQL_PASSWORD=your_mysql_password`
- `MYSQL_DATABASE=ceochat`

## Step 3: Test Database Connection Manually

Test if you can connect to MySQL with the credentials from `.env.local`:

```bash
mysql -h localhost -u YOUR_MYSQL_USER -p YOUR_MYSQL_DATABASE
```

Enter your password when prompted. If this fails, your credentials are wrong.

## Step 4: Verify Database and Tables Exist

Once connected to MySQL, check if the database and tables exist:

```sql
USE ceochat;
SHOW TABLES;
```

You should see tables like:
- `sections`
- `students`
- `evaluations`
- `cases`
- `models`
- etc.

If tables are missing, run the migration scripts:

```bash
cd /var/www/jsapps/makethecase
mysql -u root -p < docs/mysql-database-structure-Oct2025.sql
mysql -u root -p < server/migrations/add_admin_auth.sql
mysql -u root -p < server/migrations/add_cases_tables.sql
```

## Step 5: Test API Endpoint Directly

Test if the API is responding:

```bash
curl http://localhost:3001/api/health
```

Should return: `{"status":"ok","timestamp":"..."}`

Test the sections endpoint:

```bash
curl http://localhost:3001/api/sections?enabled=true
```

Should return JSON with sections data or an error message.

## Step 6: Check PM2 Environment

PM2 might not be loading `.env.local`. Update the ecosystem config to explicitly load it:

The ecosystem.config.cjs should work, but you can also set environment variables directly in PM2:

```bash
pm2 restart makethecase --update-env
```

Or set environment variables in the ecosystem config file.

## Step 7: Check Browser Console

Open the browser developer console (F12) and check:
1. Network tab - see if API requests are being made
2. Console tab - look for error messages
3. Check if requests to `/makethecase/api/sections` are returning errors

## Step 8: Verify Apache Proxy

Test if Apache is correctly proxying requests:

```bash
curl https://services.byu.edu/makethecase/api/health
```

Should return the same as `curl http://localhost:3001/api/health`

## Common Issues:

1. **PM2 not loading .env.local**: PM2 runs from a different context. Make sure `.env.local` is in the project root and PM2 is started from there.

2. **Database user permissions**: The MySQL user might not have access to the database:
   ```sql
   GRANT ALL PRIVILEGES ON ceochat.* TO 'your_mysql_user'@'localhost';
   FLUSH PRIVILEGES;
   ```

3. **MySQL not running**: Check if MySQL service is running:
   ```bash
   sudo systemctl status mysql
   ```

4. **Wrong database name**: Make sure `MYSQL_DATABASE` in `.env.local` matches the actual database name.

5. **Firewall blocking**: Make sure port 3001 is accessible locally (should be fine for localhost).
