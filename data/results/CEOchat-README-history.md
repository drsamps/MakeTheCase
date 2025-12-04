10/27/2025

I created ChatWithCEO using Google AI Studio.
It appears to have defaulted to using Node.js for the backend.
I deployed it to the Google Cloud using AI Studio's "Deploy" button.
https://ceo-business-case-chat-simulator-962957134935.us-west1.run.app/#/admin

October 2025 I tested ChatWithCEO on undergrad GSCM students in the core.
Students went to https://services.byu.edu/gscm
which was a landing page that linked to the deployed version.

## move to GitHub (off of AI Studio)

I synced the latest Google AI Studio version to my home computer using Cursor.
Changed it so that it would run locally...
- needed to install Node.js on the home office computer
- needed to restart Cursor to get Node.js in the path
- cd "C:\Users\ses3\OneDrive - Brigham Young University\Apps\ChatWithCEO"
- npm install
- npm run dev
which produces
VITE v6.4.1  ready in 304 ms
  ➜  Local:   http://localhost:3000/
  ➜  Network: http://192.168.0.11:3000/
  ➜  press h + enter to show help
When I clicked on the Local URL it opened in Cursor browser window. I could not get it to open in a Chrome browser window.

Access Instructor Dashboard via ctrl-click header
/admin tool
sampsonsclasSs@gmail.com
/seanm______

## added ability to download data from Supabase

Then added a "Download to MySQL" button on the Instructor Dashboard.
- which I pushed to GitHub, so out of sync with Google AI Studio
- AI Studio will not GitHub pull, so it is deprecated.

Using that new button, got...
"mysql-database-structure-Oct2025.sql" contains the database structure.
"ceochat-upsert-20251027-2037.sql" contains all of the student data from this test.
I loaded these onto a local MYSQL server on the home office computer.
Loaded fine.

----

It appears that Gemini-Flash and Gemini-Flash-Lite runs cost me perhaps 30 cents for the student use.
It appears that the Gemini-2.5-Flash-Pro cost me about $1.60 for one section of student use.

## 12/3/2025 trial run in MBA 530 classes

I ran ChatWithCEO it on two sections of Dan's MBA 530 classes
Section 2 - Gemini-2.5-Flash
Section 1 - Gemini-2.5-Pro
-> these burnt through $4.55 (but free for now), probably mostly Gemini-2.5-Pro
Note that Gemini-2.5-Pro caused at least 7 or 8 "problem accessing LLM via API" error messages in the student's browsers.

I downloaded the data dump to
data/results/ceochat-upsert-20251203-1845.sql
which includes all of the prior data as well.

### feedback from MBA students

* some student got 15/15 by copy-and-paste from the case to the answer
* todo: disable copy and paste
* might be good to provide students with an outline of the case in the case frame (or TOC)
* the chat text box does not expand so it requires you to scroll (kind of a pain)
* students requested the ability to consider ideas outside of the case facts
  * P&L data
  * ideas like buying a second overn
