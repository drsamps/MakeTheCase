# Deployment Files

This directory contains files related to deploying the MakeTheCase application to production servers.

## Files

- **`HOW_TO_DEPLOY.md`** ⭐ - **Start here!** Complete step-by-step deployment guide
- **`makethecase.conf`** - Apache configuration file for serving the application at `/makethecase` on `services.byu.edu`
- **`PRODUCTION_DIAGNOSTIC.md`** - Guide for diagnosing production server issues, particularly related to case files
- **`DEBUG_DATABASE.md`** - Guide for debugging database connection issues
- **`DEPLOYMENT_FIX.md`** - Documentation of fixes for common deployment issues

## Quick Reference

### Apache Configuration
Copy the Apache config to your server:
```bash
sudo cp deployment/makethecase.conf /etc/apache2/ses-includes/services/0002_443_makethecase.conf
sudo systemctl reload apache2
```

### PM2 Configuration
The `ecosystem.config.cjs` file in the root directory is used for PM2 process management.

### Deployment Checklist
1. Pull latest code: `git pull`
2. Install dependencies: `npm install`
3. Build frontend: `NODE_ENV=production npm run build`
4. Restart PM2: `pm2 restart makethecase`
5. Verify: Check logs with `pm2 logs makethecase`
