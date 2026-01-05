I need a new “Assignments” screen for managing which cases are assigned to which course sections with specific options, which will manage the “section\_cases” data table.  This should allow the admin Instructor to assign cases to course sections and select from various options, including prior options:

* hints\_allowed:int \- number of hints allowed or 0 for no hints (default \= 3\)  
* free\_hints:int \- number of free hint without penalizing the score (default \= 1\)  
* ask\_for\_feedback:boolean \- whether to ask the user for feedback at the end of the chat (default \= no or false)  
* ask\_save\_transcript:boolean \- whether to ask the user for permission to save the anonymized transcript (default \= no or false)  
* allowed\_personas:varchar(100) \- a csv list of protagonist personas to allow the user to select from.  
* default\_personal:varchar(20) \- the default persona for that given section case.

Plus some new chat\_options that need to be implemented:

* show\_case:boolean \- determines whether to show the case contents in a left frame, or not show the case.  
* do\_evaluation:boolean \- determine whether to do the supervisor after the case chat is complete, or just take the student to a finish screen to click logout.  
* chatbot\_personality:text \- AI model instructions to guide the case chatbot personality, in addition to what is provided by the selected persona.  
* and others (good to make the chat options flexible, perhaps documented in a chat\_options file or data table).

Along that line, it would be good to move the various personas into an expandable file and a “personas” data table with a new admin menu option for “personas” that allows editing the personas.  
Please plan these changes and proceed with the implementation, using your best judgement, and provide a documentation file about what was completed in the “docs” directory.

In addition, feel free to do any useful and low-risk refactors of the admin functions of this makethecase app.