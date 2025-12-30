MakeTheCase is an app that allows students to chat with the protagonist of a business case.

## Admin functions

The instructor accesses an admin console with the following functions:
* cases - For uploading and managing business cases.
* sections - For creating and managing course sections.
* students - For keeping track of students in each given section.
* models - The AI LLMs that can be used in case chats and evaluations
* evaluations - The evaluation of student chats with case protagonists

## Case chat workflow
* The instructor previously installs a case by uploading the case and teaching note and the chat question.
* The instructor creates a course section.
* The instructor opens a case for a given course section.
* The students log in to MakeTheCase.
* The students select the case and the preferred persona.
* The students 


### Install cases and teaching notes

A "case" is a description of a business situation that students will study to learn more about business issues and to prepare for class discussion.

The instructor also has a "teaching note" for each case that provides background information about the case. Students do not have access to the teaching note.

The admin console allows instructors to upload cases into the 

Cases and teaching notes are formatted as markdown files.

Cases and teaching notes are stored in a "case_files" directory.



TABLE: cases
case_id
case_title
protagonist
chat_topic
chat_question


TABLE: case_files
case_id
filename
tagged_as


TABLE: students
id
username byu_netid
password_hash
created_at
first_name
last_name
full_name
section_id
persona: favorite protagonist persona


TABLE: results
