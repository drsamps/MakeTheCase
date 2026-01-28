# Instructor access to sections

Currently instructors are managed in the “Instructor Management” screen and the login info is stored in the “admins” data table. The “admins” table distinguishes between “superuser” admins who can access all “Instructor Dashboard” screens and non-superuser admins who I have referred to as “admin instructors” (who can only access a subset of “Instructor Dashboard” screen).

These admin instructors can manage every course and every section, which is a problem. We may need to have a separate “instructors” data table that keeps track of regular instructors who only have access to their course information. Regular instructors should only be allowed to see and manage information pertaining to their courses, including:

* Courses  
* Sections  
* Students  
* Case Assignments

Cases and Case Files should be made accessible to a specific instructor, to a set of instructors, or all instructors (\*). If a logged in instructor uploads a case and case files, they should be accessible only to that instructor (or an admin who can access everything) unless an admin shares the case with other instructors.

Regular instructors cannot create courses or sections, but they can manage course sections that are already created. Courses and sections must be created by an admin, either a superuser or an admin instructor. Only a superuser admin can create semesters.

## Primary and secondary instructors

It would be nice if each Course and Section has a primary instructor, who is either the instructor creating the Course or Section, or is assigned by a superuser. A primary instructor should have the option of reassigning a course or section to a different primary instructor. Each section can also have secondary instructors (such as teaching assistants) who can manage sections and students and case chats for the assigned sections.

=====
