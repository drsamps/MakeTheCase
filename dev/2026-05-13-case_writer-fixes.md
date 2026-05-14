Fixes to the Case Writer app…

- [ ] Upload source material.

At the start of a project the user needs to specify the “Teaching principle” which may come from some source material such as a textbook chapter. It would be good to optionally allow the user to upload the source material and from that use AI to extract a list of possible teaching principles (from the major topics of the source material).

- [ ] Save progress

The Case Writer has various “Save” buttons. It would be good if the button labels indicated the save status: “Save” if not yet saved (dirty data), or “Saved” if save was successful.

- [ ] Source material

The “Project metadata” needs to be followed by optional “Source material” which is where the generation comes from. The “Learning Brief” should not be arbitrary but should be based on any provided source material.

- [ ] Generate progress

The various “Generate” buttons would be better to say “Generating… 0:01” counting up the seconds of generating and giving the feeling of progress. Also, while generating it might be better if the buttons turned a more active color (like pulsing green) to indicate something good is happening (the faded buttons make it look like they are disabled).

- [ ] AI models

It is not clear what AI model is being used for each “Generate” and better if I can choose from the defined models.

- [ ] Wizard steps

It is not clear what the various Wizard steps mean. For example:

* Learning Brief \- what is that? what is it used for?  
* Scenarios \- are these just titles or are they narrative descriptions?  
* Blueprint \- what is that? What is it used for?

Perhaps include a brief description of each step in (parenthesis) after the step titles.

- [ ] Scenarios

Wizard step 2 (Scenarios) generates a list of scenarios but does not let me see other than the title and Industry \-- is there more to the scenarios than that and how can I view/edit it?

- [ ] Blueprint

The blueprint is kind of difficult to read, being in JSON format. Is there some way to see a summary of the blueprint, perhaps in markdown? That would make it easier to edit (and save) the blueprint before generating the student case.

- [ ] Student Case

I clicked the “Generate” button for “Student Case” and it “Generating…” for a few minutes then returned to “Generate” and did not show any results. Clicking the Export button did not produce anything, so perhaps nothing was generated.