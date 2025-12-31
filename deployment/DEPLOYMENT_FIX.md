# Fix for "Start Chat" Button Disabled Issue

## Problem
The "Start Chat" button is disabled on the production server even though a case is selected. This is because the case content files are not being loaded from the server filesystem.

## Root Cause
The `/api/llm/case-data/:caseId` endpoint reads case files from the `case_files` directory on the server filesystem. If this directory or the case files don't exist on the production server, the API returns an error and the frontend disables the "Start Chat" button.

## Solution Steps

### 1. Verify Case Files Exist in Git

On your local machine, verify the case files are committed to git:

```bash
git status
git ls-files case_files/
```

You should see:
```
case_files/malawis-pizza/case.md
case_files/malawis-pizza/teaching_note.md
```

If these files are NOT tracked by git, add them:

```bash
git add case_files/
git commit -m "Add case files for deployment"
git push
```

### 2. Deploy to Production Server

SSH into your Ubuntu production server and navigate to the app directory:

```bash
cd /var/www/jsapps/makethecase  # or wherever your app is deployed
```

Pull the latest changes:

```bash
git pull origin main  # or master, depending on your branch
```

### 3. Verify Case Files on Server

Run the diagnostic script:

```bash
node check-case-files.js
```

This will tell you if the case_files directory and its contents exist on the server.

### 4. Build and Restart

Build the frontend:

```bash
npm run build
```

Restart the PM2 process:

```bash
pm2 restart makethecase
```

Or if you're using a different process manager, restart accordingly.

### 5. Verify the Fix

Visit https://services.byu.edu/makethecase/ and try to:
1. Log in
2. Select a course section
3. Select the "Malawi's Pizza Catering" case
4. The "Start Chat" button should now be enabled

## Alternative: Check Permissions

If the files exist but still don't load, check file permissions:

```bash
ls -la case_files/
ls -la case_files/malawis-pizza/
```

Ensure the files are readable by the user running the Node.js process (typically your user or www-data):

```bash
chmod -R 755 case_files/
```

## Diagnostic Endpoints

You can also test the API endpoint directly:

```bash
curl https://services.byu.edu/makethecase/api/llm/case-data/malawis-pizza
```

This should return JSON with case data. If it returns an error, the case files are not accessible.

## Updated Code Changes

The following improvements were made to help diagnose this issue:

1. **Better error messages**: The frontend now shows specific error messages when case data fails to load
2. **Loading indicator**: Shows "Loading Case..." in the button text while case data is being fetched
3. **Warning message**: Displays a warning if case content failed to load
4. **Diagnostic script**: `check-case-files.js` helps verify case files exist on the server

## Prevention

To prevent this issue in the future:

1. Always commit the `case_files` directory to git
2. Verify deployments include all necessary files
3. Run the diagnostic script after each deployment
4. Monitor the PM2 logs for errors: `pm2 logs makethecase`
