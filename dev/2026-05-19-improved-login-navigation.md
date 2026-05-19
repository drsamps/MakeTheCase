# Improved Login Navigation

When a student logs in to the tool they see a screen that says:  
“Make The Case  
Click below to sign in with your BYU NetID to chat with cases as assigned by your instructor.  
Click to login with BYU NetID”  
If the user control-clicks on the “Make The Case” heading it opens a new browser tab navigating to “admin” but strangely showing the same student login screen. If the user then control-clicks on that new “Make The Case” heading it then displays the Instructor Dashboard login that says:  
“Instructor Dashboard  
Sign in with BYU NetID  
Click to login with BYU NetID  
or sign in with email/password  
Email Address  
Password  
\[Sign In\]  
to Chatbot (link)”  
which allows the user to login to the Instructor Dashboard.  
It would be good if on the student login screen the word “instructor” was an inconspicuous hotlink to display the Instructor Dashboard login screen, or they could control-click (on Windows) to open the Instructor Dashboard login screen in another tab.

## Dashboard home screens

Logging in to the Instructor Dashboard first displays the “Dashboard” menu item, which should be changed to “Home” (keeping that icon of a home) with two sub-menu items: “Welcome” and “Dashboard”. The “Dashboard” sub-menu screen should contain all of the information currently in the Dashboard screen, except the heading “Welcome back” should be changed to “Dashboard Summary”.  
The "Welcome" sub-menu screen is the first screen people see when they log in and should welcome the Instructor and provide useful information about the system. This “Welcome” screen might describe the purpose of the system, which is to facilitate enhanced student learning by allowing students to engage in AI-simulated conversations about relevant course topics as they are applied to business situations. The Welcome screen might also describe a typical Instructor Workflow including:

* Installing cases that are already written.  
* Creating new cases using Case Writer.  
* Setting up scenarios that students will address in a case chat.  
  * tell what a scenario is and what it includes (protagonist, question, possibly positions)  
* Setting up case chats with various options including:  
  * scenarios  
  * personality of conversation (chatbot personas)  
  * availability of hints  
  * etc.  
* Assigning case chat to students  
* Evaluating the Results in preparation for class discussion  
* and so forth.

It could be best for this static “Welcome” screen to be stored in a configuration file (perhaps as markdown or html) that I can later go in and edit as desired. Where would we store that information? The info could have links to various parts of the system, such as “Case Writer”. 

## Case Writer navigation

I have logged in as an Instructor. In the Instructor Dashboard clicking “Case Writer” switches to the case-writer tool. In “Case Writer” screen clicking “Back to Dashboard” (should be “back to Instructor Dashboard”) goes to the Instructor Dashboard login screen \-- but it should instead go back to the Instructor Dashboard (since the instructor is already logged in).  
Note that currently students can only login using BYU CAS, and Instructors can use BYU CAS or can enter an email address and password.
