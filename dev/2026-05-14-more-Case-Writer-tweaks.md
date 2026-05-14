# Case Writer tweaks

- [ ] ## Case size options

For the case “Overview” it would be good to provide size options such as the following:

* story-problem (case is very simple with just a few paragraphs, no exhibits)  
* mini-case (half the size of a regular case, maybe 1 or 2 exhibits)  
* regular (the default case size)  
* extensive (more detail than a regular case)

That selection should influence how much information the AI Case Generator includes in the case.

- [ ] ## Teach Note type

The original spec said “Teaching note generation can be offered in three formats:

* Brief note: 1–2 pages  
* Standard note: 4–6 pages  
* Detailed note: Full instructor guide with rubrics and board plan”

Is that implemented anywhere? It could perhaps be an option next to the “Generate” button of the “5. Teaching Note” step.

- [ ] ## Scenarios count

The “Generate scenarios” has a “Count” button that is forced to be between 3 and 5 but I would like it to allow 1 or 2 (any value between 1 and 5).

- [ ] ## Prompt template view for admins

In the various Case Writer steps, it would be nice if admin users could view the prompt template that will be used in the “Generate” functions. For admin users, next to the “Generate” and AI model selector add a (i) info link with tooltip “click to display AI prompt: {prompt identifier from ai\_prompts.use}”. Clicking it will bring up a modal with heading “Prompt for {ai\_prompts.use}” then the ai\_prompts.description then the prompt\_template. At the bottom is a note: “Admin users can edit prompts under Admin|Prompts”. Close buttons at the top-right and bottom.

- [ ] ## Teaching note title

When generating a “Teaching Note” the top of the teaching note needs to contain a title: “Teaching note for: {name of case}”
