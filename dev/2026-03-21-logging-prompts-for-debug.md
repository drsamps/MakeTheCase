# Logging prompts

To facilitate debugging of case chats, we need to implement an AI model call logging feature. This will be controlled by two new settings:

* log\_case\_chat\_prompts:int (The number of case chats to log)  
* log\_evaluation\_prompts:int (The number of evaluation prompts to log)

## Logging Case Chats

If log\_case\_chat\_prompts\>0 then when a case chat calls an LLM for a simulated response, create a “logs/{yyyy-mm-dd\_hh-mm-ss}\_CHAT-{student\_id}-{case\_id}-prompt.txt” file with the following information:

* a header that says “CASE CHAT LOG” with   
  * student\_id  
  * case\_id  
  * AI model\_id  
  * date and time of AI model call  
* The prompt fed to the LLM **without** the case context, but with the transcript (with prominent header)  
* The response from the LLM (with prominent header)

Every time a case chat is logged, decrease the log\_case\_chat\_prompts setting by 1 so that it only logs the specified number of case chat turns.

## Logging Evaluations

If log\_evaluation\_prompts\>0 then when a case chat calls an LLM for a simulated response, create a “logs/{yyyy-mm-dd\_hh-mm-ss}\_EVAL-{student\_id}-{case\_id}-prompt.txt” file with the following information:

* a header that says “TRANSCRIPT EVALUATION LOG” with   
  * student\_id  
  * case\_id  
  * AI model\_id  
  * date and time of AI model call  
* The prompt fed to the LLM **without** the case context, but with the transcript (with prominent header)  
* The response from the LLM (with prominent header)

Every time a case chat is logged, decrease the log\_evaluation\_prompts setting by 1 so that it only logs the specified number of case chat turns.

## Error handing

All logging should handle errors gracefully, not detracting from the student experience in case chats.  If an error occurs, log the error in a “logs/error\_log.txt” file. Also, to avoid excessive logging, only allow 100 files in the “logs” directory without hitting a “Too many log files \- delete old files to resume logging” error message.

## Admin “Logging” screen

The “Instructor Dashboard” has an “Admin” tab. Create a new “Logging” sub-tab under the “Admin” tab. The Logging tag is where the admin can set and monitor the log\_case\_chat\_prompts and log\_evaluation\_prompts settings, see the list of recent logs (selecting CHAT or EVAL or both), view/download the contents of selected log files, and delete one or a range of selected log files.
