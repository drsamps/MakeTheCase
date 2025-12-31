#Here's a complete script you can run to update everything:
cd /var/www/jsapps/makethecase
git pull origin main
npm install
npm run build
pm2 restart makethecase
pm2 logs makethecase  # Check logs to ensure it started correctly
