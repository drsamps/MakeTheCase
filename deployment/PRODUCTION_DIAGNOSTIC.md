# Production Server Diagnostic Guide

## Issue: "Start Chat" Button Disabled

The "Start Chat" button is disabled when case data cannot be loaded from the server. This typically happens when the `case_files` directory is missing or inaccessible on the production server.

## Quick Diagnostic Steps

### 1. Check if Case Files Exist on Server

SSH into your production server and run:

```bash
cd /var/www/jsapps/makethecase  # or your app directory
node check-case-files.js
```

This will show:
- Whether the `case_files` directory exists
- Which case directories are present
- Whether `case.md` and `teaching_note.md` files exist for each case

### 2. Test the API Endpoint Directly

Test if the case data API is working:

```bash
curl http://localhost:3001/api/llm/case-data/malawis-pizza
```

Or from your local machine (if the server is accessible):

```bash
curl https://services.byu.edu/makethecase/api/llm/case-data/malawis-pizza
```

**Expected response:** JSON with `data` object containing case information
**Error response:** JSON with `error` object and error message

### 3. Check Server Logs

Check PM2 logs for detailed error messages:

```bash
pm2 logs makethecase --lines 50
```

Look for messages starting with `[case-data]` which will show:
- Which case ID is being requested
- Whether the case was found in the database
- Whether the case file was found and read successfully
- The exact file path being accessed

### 4. Verify File Permissions

Ensure the Node.js process can read the case files:

```bash
ls -la case_files/
ls -la case_files/malawis-pizza/
```

If permissions are incorrect:

```bash
chmod -R 755 case_files/
chown -R $(whoami):$(whoami) case_files/  # or appropriate user
```

### 5. Verify Case Files in Git

Ensure case files are committed to git:

```bash
git ls-files case_files/
```

You should see:
```
case_files/malawis-pizza/case.md
case_files/malawis-pizza/teaching_note.md
```

If files are missing, add them:

```bash
git add case_files/
git commit -m "Add case files"
git push
```

Then on the server:

```bash
git pull
```

## Common Issues and Solutions

### Issue: Case Files Not Deployed

**Symptom:** `check-case-files.js` shows "case_files directory does not exist"

**Solution:**
1. Ensure `case_files/` is committed to git
2. Pull latest changes on production server: `git pull`
3. Verify files exist: `ls -la case_files/`
4. Restart the server: `pm2 restart makethecase`

### Issue: Case Files Exist But Can't Be Read

**Symptom:** API returns 500 error, logs show "Failed to read case file"

**Solution:**
1. Check file permissions: `ls -la case_files/malawis-pizza/`
2. Fix permissions: `chmod -R 755 case_files/`
3. Ensure Node.js process user can read files
4. Check disk space: `df -h`

### Issue: Case Not Found in Database

**Symptom:** API returns 404, logs show "Case not found in database"

**Solution:**
1. Verify case exists in database:
   ```sql
   SELECT * FROM cases WHERE case_id = 'malawis-pizza';
   ```
2. If missing, create the case record or run seed script:
   ```bash
   node server/scripts/seed-malawis-pizza.js
   ```

### Issue: Wrong File Path

**Symptom:** Logs show incorrect path or "ENOENT" errors

**Solution:**
1. Check the `CASE_FILES_DIR` path in server logs
2. Verify the path is correct relative to `server/routes/llm.js`
3. The path should be: `{project_root}/case_files/`
4. If using a different directory structure, update `CASE_FILES_DIR` in `server/routes/llm.js`

## Enhanced Error Messages

The updated code now provides:

1. **Frontend:**
   - Clear error messages when case data fails to load
   - HTTP status codes in error messages
   - Prominent error display with red background
   - Console logging for debugging

2. **Backend:**
   - Detailed logging with `[case-data]` prefix
   - File path information in error messages
   - Clear distinction between database errors and file system errors

## Testing After Fix

1. Clear browser cache or use incognito mode
2. Log in to the application
3. Select a course section
4. Select a case
5. Check browser console (F12) for any errors
6. Verify "Start Chat" button is enabled
7. If still disabled, check the error message displayed above the button

## Prevention

1. **Always commit `case_files/` to git** - Don't add it to `.gitignore`
2. **Verify after deployment** - Run `check-case-files.js` after each deployment
3. **Monitor logs** - Set up log monitoring to catch file access errors early
4. **Document case deployment** - Include case file deployment in your deployment checklist
