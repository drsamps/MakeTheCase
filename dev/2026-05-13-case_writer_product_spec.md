# Product Specification: Case Writer App

## 1. Product Overview

**Product name:** Case Writer  
**Product type:** AI-assisted instructional design and business case authoring tool  
**Primary user:** Business faculty, instructors, trainers, instructional designers, and case authors  
**Primary output:** A student-facing business case writeup and an instructor-only teaching note  

Case Writer helps an instructor develop a business case by starting with the teaching principle they want students to learn, generating scenario alternatives, guiding the instructor through scenario selection and refinement, and producing a polished student-facing case narrative. The app preserves a strict boundary between what students see in the case and what instructors see in the teaching note.

The app is not simply a “write me a case study” tool. It is a guided case-development system that combines instructional design, scenario generation, narrative drafting, evidence design, and teaching-note creation.

---

## 2. Core Product Concept

The app should guide the instructor through the following sequence:

1. Define the teaching principle.
2. Provide optional reference material.
3. Clarify audience, course, difficulty, and pedagogical goals.
4. Generate multiple case scenario alternatives.
5. Let the instructor select, combine, or revise a scenario.
6. Develop a case blueprint.
7. Draft the student-facing case writeup.
8. Optionally generate the instructor-only teaching note.
9. Export, revise, save, or reuse the case.

The central product distinction is:

### Student-facing case writeup includes:

1. Business context
2. Specific problem or opportunity
3. Relevant stakeholders
4. Data and evidence
5. Decision point

### Instructor-only teaching note includes:

6. Alternatives
7. Analysis
8. Implementation considerations
9. Results or expected outcomes
10. Lessons learned

The app must enforce this separation throughout the authoring process.

---

## 3. Product Goals

### 3.1 Primary goals

- Help instructors create high-quality business case drafts faster.
- Translate a teaching principle into a realistic decision scenario.
- Encourage pedagogical discipline by separating student materials from instructor-only materials.
- Produce cases that are discussion-worthy rather than merely descriptive.
- Give the instructor control over scenario selection, ambiguity, evidence, and difficulty.

### 3.2 Secondary goals

- Support multiple teaching levels: undergraduate, MBA, executive education, corporate training.
- Allow reference materials to shape the case.
- Generate exhibits, discussion questions, and teaching plans.
- Support fictional, disguised, composite, or real-company cases.
- Create reusable case templates and teaching-principle libraries.

### 3.3 Non-goals for MVP

- Fully automated publication-ready cases without instructor review.
- Legal verification of real-company claims.
- Automatic licensing of copyrighted reference materials.
- Full LMS integration.
- Multi-user classroom delivery tools.
- Automated grading of student responses.

---

## 4. Target Users and Personas

### 4.1 Business school professor

Wants to create cases aligned with a course module. Needs realistic scenarios, decision ambiguity, teaching questions, and instructor notes.

### 4.2 Adjunct instructor

Has limited prep time and wants usable teaching material quickly. Needs guided workflows and strong defaults.

### 4.3 Corporate trainer

Wants organization-specific cases for leadership, sales, finance, operations, or strategy workshops. Needs customization and privacy.

### 4.4 Instructional designer

Works with subject-matter experts to convert principles into learning activities. Needs structured outputs, learning objectives, and revision workflows.

### 4.5 Case author or researcher

Wants to develop publishable case drafts. Needs control over sources, factual grounding, version history, and documentation.

---

## 5. User Problems

Instructors often know what principle they want to teach but struggle to turn it into a compelling case narrative. Common problems include:

- Starting from theory rather than a realistic decision.
- Writing too much analysis into the student case.
- Failing to create a clear protagonist and decision point.
- Creating a scenario that has an obvious answer.
- Including too little data for analysis.
- Including too much data that distracts from the teaching goal.
- Struggling to generate realistic business context.
- Reusing stale or generic examples.
- Spending too much time formatting cases and teaching notes.

Case Writer should solve these problems by guiding the author through a deliberate case-design process.

---

## 6. MVP Scope

The MVP should include the minimum functionality needed to create a high-quality draft case and teaching note.

### 6.1 MVP features

1. Teaching principle intake
2. Reference material paste/upload
3. Audience and course context settings
4. Scenario alternative generation
5. Scenario selection and refinement
6. Case blueprint generation
7. Student-facing case draft generation
8. Teaching-note draft generation
9. Manual editing
10. Export to Markdown, Word, and PDF
11. Save projects

### 6.2 MVP exclusions

- Collaborative editing
- LMS integration
- Case marketplace
- Automated copyright checking
- Citation management beyond basic source notes
- Student-facing simulation mode
- Advanced analytics
- Case peer review workflow

---

## 7. Core Workflow

## 7.1 Step 1: Teaching Principle Intake

The app begins by asking:

> What business principle, concept, framework, or decision skill do you want this case to teach?

Examples shown to the user:

- Pricing under uncertainty
- Product-market fit
- Channel conflict
- Incentive alignment
- Market segmentation
- First-mover advantage
- Working capital management
- Cash conversion cycle
- Competitive positioning
- Ethical decision-making
- Platform network effects
- Disruptive innovation
- Capacity planning
- Customer lifetime value
- Agency problems

### Inputs

- Teaching principle
- Optional short description
- Course or module
- Student level
- Desired difficulty
- Industry preference
- Functional area
- Geographic setting
- Desired length
- Tone and style
- Fictional, disguised, composite, or real company

### Output

A structured instructional design brief.

---

## 7.2 Step 2: Reference Material Intake

The instructor can provide supporting materials.

### Supported reference input options

- Paste text
- Upload PDF, Word document, PowerPoint, spreadsheet, or notes
- Enter a textbook/framework summary
- Add web links for instructor reference
- Select from saved teaching-principle library

### Reference material use cases

- Ground the case in a specific framework
- Match the instructor’s terminology
- Generate relevant data and exhibits
- Align the case with a lecture, reading, or course objective
- Produce a teaching note linked to the instructor’s preferred analysis method

### Design requirement

The app should summarize reference material before using it. The instructor should be able to approve or edit the summary so that case generation is based on an accurate interpretation.

---

## 7.3 Step 3: Learning Objective Confirmation

The app converts the intake into a teaching design brief.

### Example output

```markdown
Teaching principle: Channel conflict
Primary learning objective: Students should understand how selling through a large retail partner can create growth while undermining existing direct and independent dealer channels.
Secondary learning objectives:
- Evaluate channel margin tradeoffs
- Identify stakeholder incentives
- Assess long-term brand and pricing risks
- Recommend a go-to-market path under uncertainty
Audience: MBA students
Difficulty: Intermediate
Case type: Fictional but realistic
```

### User actions

- Approve
- Edit
- Regenerate
- Add constraints
- Change audience or difficulty

---

## 7.4 Step 4: Scenario Alternative Generation

The app generates 3–5 scenario alternatives.

Each scenario should include:

- Title
- Industry
- Protagonist
- Company context
- Central business tension
- Stakeholders
- Decision point
- Why it teaches the principle
- Likely data/exhibits
- Estimated difficulty

### Example scenario format

```markdown
Option A: The Big-Box Opportunity
Industry: Specialty food manufacturing
Protagonist: Founder/CEO of a regional premium salsa brand
Decision point: Should the company accept a national big-box retail contract that could triple volume but require lower margins and anger independent grocers?
Why it works: This scenario teaches channel conflict, margin tradeoffs, customer segmentation, and growth risk.
```

### User actions

- Select one scenario
- Combine two scenarios
- Request more scenarios
- Change industry
- Increase ambiguity
- Add quantitative data
- Make it more strategic, operational, financial, ethical, or entrepreneurial
- Convert to real-company inspired, fictional, or disguised version

---

## 7.5 Step 5: Scenario Selection and Refinement

Once a scenario is selected, the app asks targeted refinement questions.

### Possible refinement prompts

- Who should be the protagonist?
- What decision must they make?
- What makes the decision difficult?
- What data should students have?
- What information should remain ambiguous?
- Should the case have a clear right answer or multiple defensible answers?
- Should the case emphasize quantitative analysis, qualitative judgment, or both?
- Should the company be successful, struggling, or at an inflection point?
- Should the context be domestic, international, or cross-border?

### Design option

The app can either ask these questions one at a time in conversational mode or present them as editable fields in a structured form.

---

## 7.6 Step 6: Case Blueprint Generation

Before drafting the case, the app generates a blueprint.

### Blueprint fields

- Working title
- Case type
- Teaching principle
- Student audience
- Opening hook
- Protagonist
- Company background
- Industry context
- Timeline
- Core conflict
- Stakeholders
- Evidence to include
- Exhibits
- Decision point
- Information to withhold from students
- Teaching-note-only content

### Purpose

The blueprint allows the instructor to approve the case structure before the app writes the full narrative.

---

## 7.7 Step 7: Student-Facing Case Draft

The student-facing case should include only:

1. Business context
2. Problem or opportunity
3. Stakeholders
4. Data and evidence
5. Decision point

### Recommended case structure

```markdown
# Case Title

## Opening
A narrative scene introducing the protagonist and decision pressure.

## Company Background
Relevant history, business model, customers, capabilities, and constraints.

## Market and Industry Context
Competitive, economic, customer, regulatory, technological, or operational context.

## The Problem or Opportunity
The central dilemma facing the protagonist.

## Stakeholders
The individuals and groups affected by the decision.

## Evidence and Exhibits
Relevant facts, metrics, qualitative observations, and data tables.

## Decision Point
The final decision the protagonist must make.
```

### Excluded from student case

The student-facing draft must not include:

- Recommended answer
- Full analysis
- Instructor interpretation
- Implementation plan
- Expected outcome
- Lessons learned
- Discussion guide
- Scoring rubric

---

## 7.8 Step 8: Teaching Note Generation

The teaching note is generated separately.

### Teaching note should include:

1. Case synopsis
2. Target audience
3. Learning objectives
4. Teaching plan
5. Board plan or class flow
6. Alternatives available to the protagonist
7. Recommended analysis
8. Quantitative solution, if applicable
9. Implementation considerations
10. Expected outcomes
11. Lessons learned
12. Discussion questions
13. Assignment questions
14. Rubric or grading guide
15. Possible student misconceptions

### Teaching note design requirement

The teaching note can reference hidden rationale, frameworks, and expected analysis, but should remain clearly separate from the student-facing case.

---

## 8. Functional Requirements

## 8.1 Project Management

The user should be able to:

- Create a new case project
- Name the project
- Save progress
- Resume previous projects
- Duplicate a project
- Delete a project
- Export project files
- View version history

### MVP priority

Project creation, saving, and exporting are high priority. Version history can be limited in MVP.

---

## 8.2 Guided Wizard

The app should provide a step-by-step wizard for users who want structure.

### Wizard steps

1. Teaching principle
2. Reference material
3. Audience and constraints
4. Scenario alternatives
5. Scenario selection
6. Case blueprint
7. Case draft
8. Teaching note
9. Export

### Design requirement

Users should be able to move forward and backward without losing content.

---

## 8.3 Conversational Mode

The app may also offer a chat-style authoring assistant.

### Conversational capabilities

- Ask clarifying questions
- Generate alternatives
- Revise tone
- Add data
- Change setting
- Expand narrative
- Shorten case
- Create exhibits
- Generate teaching note sections

### Design option

Conversational mode can supplement the wizard, but should not replace the structured workflow in the MVP unless the target users strongly prefer a chat-first interface.

---

## 8.4 Scenario Generator

The scenario generator should produce multiple distinct options.

### Requirements

Each scenario should differ meaningfully by:

- Industry
- Protagonist
- Decision type
- Stakeholder tension
- Data requirements
- Pedagogical angle

### Scenario quality rules

A good scenario should:

- Have a named decision-maker
- Present a time-sensitive decision
- Create meaningful tradeoffs
- Avoid an obvious answer
- Connect directly to the teaching principle
- Support classroom discussion
- Allow evidence-based analysis

---

## 8.5 Case Drafting Engine

The case drafting engine should generate the student-facing case from the approved blueprint.

### Requirements

- Preserve case/teaching-note boundary
- Follow approved length and tone
- Use instructor-approved scenario
- Include realistic but not overdetermined evidence
- Maintain ambiguity
- End with a clear decision point
- Avoid revealing the “answer”

### Revision controls

Users should be able to request:

- More realism
- More ambiguity
- More data
- Less data
- More narrative detail
- More concise writing
- More executive tone
- More undergraduate-friendly language
- More quantitative exhibits
- More stakeholder conflict
- Stronger opening hook

---

## 8.6 Exhibit Generator

The app should optionally generate exhibits.

### Possible exhibits

- Revenue by segment
- Contribution margin table
- Customer survey results
- Competitor comparison
- Market growth estimates
- Cost structure
- Channel margin analysis
- Timeline of events
- Stakeholder map
- Decision matrix
- Organizational chart
- Operational capacity table
- Cash flow projection

### Design requirement

Exhibits should be editable. Users should be warned when numbers are synthetic or illustrative.

### Design option

Allow three exhibit modes:

1. **Narrative only:** No tables or numbers.
2. **Light exhibits:** Simple tables that support discussion.
3. **Quantitative case:** Exhibits designed for calculations or financial analysis.

---

## 8.7 Teaching Note Generator

The app should generate an instructor-only teaching note from the completed case.

### Requirements

- Identify intended learning objectives
- Present discussion flow
- Provide alternatives
- Explain recommended analysis
- Include likely student responses
- Include possible board plan
- Include implementation considerations
- Include expected outcomes or lessons
- Suggest assignment questions
- Generate rubric if requested

### Design option

Teaching note generation can be offered in three formats:

1. **Brief note:** 1–2 pages
2. **Standard note:** 4–6 pages
3. **Detailed note:** Full instructor guide with rubrics and board plan

---

## 8.8 Export

The app should allow export to:

- Markdown
- Word document
- PDF
- Plain text
- HTML
- LMS-ready package, later version

### Export package options

- Student case only
- Teaching note only
- Case plus teaching note
- Case plus exhibits
- Full instructor package

### Design requirement

Teaching notes should be clearly labeled as instructor-only.

---

## 9. AI Behavior Requirements

## 9.1 AI Role

The AI acts as a case-writing and instructional-design assistant.

It should:

- Ask focused questions
- Generate options
- Preserve instructor control
- Use reference material where provided
- Maintain separation between student and instructor material
- Avoid pretending that synthetic facts are verified real facts
- Mark fictionalized or illustrative data clearly

---

## 9.2 AI Guardrails

The AI should not:

- Invent real-company facts and present them as verified
- Include the recommended answer in the student case
- Make defamatory claims about real people or companies
- Use copyrighted material verbatim without permission
- Generate sensitive personal information
- Overfit the case to one obvious conclusion
- Ignore the stated teaching principle

---

## 9.3 AI Prompting Strategy

Use separate AI calls for each major task rather than one large prompt.

Recommended AI tasks:

1. Summarize reference material
2. Create teaching design brief
3. Generate scenario alternatives
4. Refine selected scenario
5. Generate case blueprint
6. Draft student case
7. Generate exhibits
8. Generate teaching note
9. Revise selected section
10. Validate boundary between case and teaching note

### Why separate calls are preferable

- Easier to debug
- Easier to control output format
- Better user experience
- Lower risk of mixing teaching-note content into student case
- More opportunities for instructor approval

---

## 9.4 Structured Output Requirements

Where possible, AI outputs should be structured as JSON objects before being rendered to the user.

### Example scenario object

```json
{
  "title": "The Big-Box Opportunity",
  "industry": "Specialty food manufacturing",
  "protagonist": "Founder and CEO",
  "company_context": "A regional premium food brand with loyal independent grocery accounts",
  "central_tension": "Growth through national retail may damage margins and channel relationships",
  "decision_point": "Should the company accept the national retailer contract?",
  "stakeholders": ["Founder", "Independent grocers", "National retailer", "Production team", "Investors"],
  "why_it_teaches_the_principle": "Students must evaluate channel conflict, margin tradeoffs, and growth risk",
  "possible_exhibits": ["Channel margin table", "Revenue forecast", "Retailer terms", "Customer segment summary"]
}
```

---

## 10. Data Model

## 10.1 Case Project

```json
{
  "project_id": "string",
  "owner_id": "string",
  "title": "string",
  "status": "draft | reviewed | exported | archived",
  "created_at": "datetime",
  "updated_at": "datetime",
  "teaching_principle": "string",
  "audience": "string",
  "course_context": "string",
  "difficulty": "introductory | intermediate | advanced | executive",
  "case_type": "fictional | disguised | composite | real_company_inspired | real_company_verified",
  "reference_materials": [],
  "learning_objectives": [],
  "scenario_options": [],
  "selected_scenario": {},
  "case_blueprint": {},
  "student_case": {},
  "teaching_note": {},
  "exports": []
}
```

---

## 10.2 Reference Material

```json
{
  "reference_id": "string",
  "type": "pasted_text | uploaded_file | link | saved_framework",
  "title": "string",
  "content_summary": "string",
  "approved_by_user": true,
  "source_notes": "string"
}
```

---

## 10.3 Student Case

```json
{
  "title": "string",
  "opening_hook": "string",
  "company_background": "string",
  "market_context": "string",
  "problem_or_opportunity": "string",
  "stakeholders": [],
  "evidence": [],
  "exhibits": [],
  "decision_point": "string",
  "draft_markdown": "string"
}
```

---

## 10.4 Teaching Note

```json
{
  "case_synopsis": "string",
  "target_audience": "string",
  "learning_objectives": [],
  "discussion_questions": [],
  "alternatives": [],
  "analysis_guidance": "string",
  "implementation_considerations": "string",
  "expected_outcomes": "string",
  "lessons_learned": [],
  "board_plan": "string",
  "rubric": []
}
```

---

## 11. User Experience Requirements

## 11.1 Navigation Model

Recommended MVP navigation:

- Dashboard
- New Case
- My Cases
- Case Editor
- Reference Library
- Settings

Within the Case Editor:

- Brief
- Scenarios
- Blueprint
- Student Case
- Teaching Note
- Exhibits
- Export

---

## 11.2 Case Editor Layout

Recommended layout:

- Left panel: workflow steps
- Center panel: current content
- Right panel: AI assistant, suggestions, and revision controls

### Design option

For a simpler MVP, use a single-column wizard and defer the three-panel editor until later.

---

## 11.3 Instructor Control Points

The instructor should approve or revise:

- Teaching objective
- Reference summary
- Scenario selection
- Case blueprint
- Student case draft
- Teaching note draft
- Exhibits
- Final export

The app should never proceed from teaching principle directly to final case without intermediate approval, unless the user explicitly chooses a “fast draft” mode.

---

## 11.4 Revision Interface

Each generated section should support common revision actions.

### Example actions

- Rewrite
- Shorten
- Expand
- Make more realistic
- Make more ambiguous
- Add stakeholder conflict
- Add quantitative evidence
- Simplify for undergraduates
- Make suitable for executives
- Remove analysis from student-facing case
- Generate alternatives
- Restore previous version

---

## 12. Design Options to Consider

## 12.1 Wizard-first vs. chat-first

### Wizard-first

**Pros**
- Strong structure
- Easier for instructors to understand
- Better control over case/teaching-note separation
- Easier to develop predictable outputs

**Cons**
- May feel rigid
- Slower for power users

### Chat-first

**Pros**
- Flexible and natural
- Good for brainstorming
- Fast for experienced users

**Cons**
- Harder to enforce structure
- Easier for student/instructor content to mix
- Harder to ensure complete outputs

### Recommendation

Use a wizard-first MVP with an embedded chat assistant.

---

## 12.2 Fictional vs. real-company cases

### Fictional cases

**Pros**
- Easier to generate
- Fewer legal and factual risks
- Can be tailored exactly to the teaching principle
- Useful for classroom discussion

**Cons**
- May feel less authentic
- Requires careful realism

### Real-company cases

**Pros**
- Greater student engagement
- Easier to connect to current events
- More credible when well sourced

**Cons**
- Requires fact checking
- Higher legal and reputational risk
- May need citations and permissions

### Recommendation

MVP should support fictional, disguised, and composite cases. Treat verified real-company cases as an advanced feature requiring stricter source handling.

---

## 12.3 Scenario alternatives vs. direct drafting

### Scenario alternatives

**Pros**
- Encourages better case design
- Gives instructor control
- Improves alignment with teaching objective
- Reduces generic output

**Cons**
- Adds one step to workflow

### Direct drafting

**Pros**
- Fast
- Simple

**Cons**
- Higher risk of weak or unfocused cases
- Less instructor ownership

### Recommendation

Scenario alternatives should be a core feature. Provide a “fast draft” shortcut only for experienced users.

---

## 12.4 Structured forms vs. open text input

### Structured forms

**Pros**
- Easier to generate consistent cases
- Better for novice users
- Easier to save and reuse data

**Cons**
- Can feel tedious

### Open text input

**Pros**
- Fast and flexible
- Better for brainstorming

**Cons**
- Less predictable
- More follow-up needed

### Recommendation

Use structured forms with optional free-text fields.

---

## 12.5 Reference material handling

### Option A: Paste-only references

Best for MVP simplicity.

### Option B: File upload and retrieval

Best for serious instructional use. Allows the model to use uploaded notes, readings, syllabi, and frameworks.

### Option C: Full reference library

Best for later versions. Users can save reusable frameworks and prior case materials.

### Recommendation

Start with paste and upload. Add a reusable reference library later.

---

## 12.6 Case length options

Offer preset lengths:

- Mini case: 1–2 pages
- Standard case: 4–8 pages
- Extended case: 8–15 pages
- Quantitative case: variable, with exhibits

### Recommendation

MVP should support mini and standard cases.

---

## 12.7 Exhibit complexity

Offer exhibit modes:

1. No exhibits
2. Simple qualitative exhibits
3. Basic quantitative exhibits
4. Advanced financial/operational exhibits

### Recommendation

MVP should support no exhibits, simple exhibits, and basic quantitative exhibits.

---

## 12.8 Export and formatting

### Simple export

Markdown and copy-to-clipboard.

### Professional export

Word and PDF with title page, exhibits, and instructor-only note labeling.

### Recommendation

MVP should support Markdown, Word, and PDF exports.

---

## 12.9 Collaboration

### Single-author mode

Best for MVP.

### Multi-author collaboration

Useful for faculty teams, instructional designers, and corporate training groups.

### Review workflow

Could include comments, approvals, tracked changes, and role-based permissions.

### Recommendation

Single-author MVP. Add collaboration later.

---

## 12.10 Deployment model

### SaaS web app

Best for broad use.

### Institution-hosted version

Useful for universities or companies with privacy requirements.

### LMS plugin

Useful later, but not ideal for MVP.

### Custom GPT or chatbot prototype

Fastest way to validate workflow before building full software.

### Recommendation

Validate with a prompt-based prototype, then build a SaaS web app.

---

## 13. Suggested Technical Architecture

## 13.1 MVP architecture

- Front end: React 19 + TypeScript + Tailwind CSS (Vite build)
- Back end: Node.js + Express.js (ES modules)
- Database: MySQL 8
- File storage: Object storage for uploads and exports
- AI provider: LLM API with structured outputs
- Document generation: Markdown-to-Word/PDF export service
- Authentication: BYU CAS, Email/password

---

## 13.2 AI orchestration layer

The back end should include an AI orchestration service responsible for:

- Prompt templates
- Structured output schemas
- Reference retrieval
- Content generation
- Validation checks
- Revision handling
- Logging and versioning

---

## 13.3 Validation layer

Before final output, the app should run checks such as:

- Does the student case include a clear decision point?
- Does the student case accidentally reveal the recommended answer?
- Are alternatives or analysis included in the student case?
- Are generated data and exhibits labeled appropriately?
- Does the case align with the teaching principle?
- Is the protagonist clear?
- Are stakeholders identified?
- Is the ambiguity sufficient?

---

## 14. Prompt Templates

## 14.1 Teaching Brief Prompt

```text
You are an instructional design assistant for business case writing.

Given the instructor's teaching principle, audience, course context, and optional reference material, create a structured teaching design brief.

Do not generate a full case yet.

Return:
- teaching principle
- primary learning objective
- secondary learning objectives
- target audience
- desired difficulty
- case type
- likely decision context
- what the student case should include
- what should be reserved for the teaching note
```

---

## 14.2 Scenario Generation Prompt

```text
Generate 5 distinct business case scenario alternatives for the following teaching design brief.

Each scenario must include:
- title
- industry
- protagonist
- company context
- central tension
- decision point
- stakeholders
- evidence or exhibits that could be included
- why the scenario teaches the principle

Do not write the full case.
Do not include analysis or recommendations.
Make the options meaningfully different from each other.
```

---

## 14.3 Case Blueprint Prompt

```text
Create a case blueprint for the selected scenario.

The blueprint should prepare a student-facing business case, but it should not write the full case yet.

Include:
- working title
- opening hook
- protagonist
- company background
- industry context
- timeline
- stakeholders
- central conflict
- evidence to include
- potential exhibits
- decision question
- information to withhold from students
- teaching-note-only content
```

---

## 14.4 Student Case Draft Prompt

```text
Write a student-facing business case from the approved blueprint.

The case may include only:
1. Business context
2. Specific problem or opportunity
3. Stakeholders
4. Data and evidence
5. Decision point

Do not include:
- alternatives
- analysis
- recommendation
- implementation plan
- results
- lessons learned
- instructor guidance

End with a clear decision question.
```

---

## 14.5 Teaching Note Prompt

```text
Create an instructor-only teaching note for the completed case.

Include:
- case synopsis
- target audience
- learning objectives
- suggested class flow
- discussion questions
- alternatives
- analysis guidance
- implementation considerations
- expected outcomes
- lessons learned
- possible board plan
- assignment questions
- grading rubric, if requested

This content is instructor-only and should not be included in the student-facing case.
```

---

## 15. Quality Criteria

A generated case is successful if it:

- Has a clear protagonist
- Has a concrete decision point
- Teaches the intended principle
- Includes relevant context
- Presents meaningful stakeholder tensions
- Provides enough evidence for analysis
- Avoids giving away the answer
- Is realistic and engaging
- Supports multiple defensible student positions
- Can be taught within the intended class time

A generated teaching note is successful if it:

- Maps clearly to the learning objectives
- Helps the instructor guide discussion
- Identifies alternatives and tradeoffs
- Provides useful analysis guidance
- Anticipates student responses
- Offers a realistic teaching plan
- Stays separate from the student-facing case

---

## 16. Risk Register

## 16.1 Risk: Student case includes analysis or answer

**Mitigation:** Add validation check before export. Highlight prohibited sections and suggest edits.

## 16.2 Risk: AI invents factual claims about real companies

**Mitigation:** Default to fictional/composite cases. Require source verification for real-company mode.

## 16.3 Risk: Cases feel generic

**Mitigation:** Require scenario alternatives, protagonist specificity, stakeholder tensions, and concrete evidence.

## 16.4 Risk: Instructor loses control

**Mitigation:** Require approval checkpoints and editable structured fields.

## 16.5 Risk: Reference material is misinterpreted

**Mitigation:** Summarize references and ask instructor to approve summary.

## 16.6 Risk: Generated numbers are unrealistic

**Mitigation:** Label synthetic data and allow instructor editing. Add reasonableness checks where possible.

## 16.7 Risk: Copyright concerns

**Mitigation:** Avoid large verbatim reuse. Store source notes. Encourage instructor-provided material and paraphrasing.

---

## 17. Privacy and Compliance Considerations

The app may process proprietary teaching materials, internal company data, or unpublished case drafts.

### Requirements

- Secure user authentication
- Encrypted storage
- Clear data retention policy
- User control over deletion
- Organization-level privacy settings for enterprise plans
- No training on user content unless explicitly permitted
- Clear labeling of generated vs. user-provided content

---

## 18. Monetization Options

## 18.1 Individual instructor subscription

Monthly or annual plan for faculty and trainers.

## 18.2 Institutional license

University, business school, or corporate training license.

## 18.3 Usage-based pricing

Charge by case generation, export, or AI usage.

## 18.4 Freemium model

Free mini-case generation with paid export, teaching notes, reference uploads, and longer cases.

## 18.5 Case library marketplace

Later-stage option where instructors can publish or license cases.

---

## 19. Roadmap

## 19.1 Prototype

- Prompt-based workflow
- Manual copy/paste
- Scenario generation
- Case draft generation
- Teaching note generation

## 19.2 MVP

- Web app
- Guided wizard
- Save projects
- Reference paste/upload
- Scenario selection
- Case blueprint
- Student case editor
- Teaching note editor
- Markdown/Word/PDF export

## 19.3 Version 2

- Exhibit generator
- Version history
- Reusable teaching-principle library
- Case templates
- Better document formatting
- Advanced revision controls

## 19.4 Version 3

- Collaboration
- SSO
- Institution admin dashboard
- LMS export
- Case peer review
- Real-company source verification workflow

## 19.5 Version 4

- Case marketplace
- Classroom discussion support
- Student assignment generation
- Rubric-based feedback tools
- Analytics on case usage and outcomes

---

## 20. MVP Acceptance Criteria

The MVP is successful if a user can:

1. Enter a teaching principle.
2. Add optional reference material.
3. Receive a structured learning objective.
4. Review at least 3 scenario alternatives.
5. Select or revise a scenario.
6. Generate a case blueprint.
7. Generate a student-facing case that excludes analysis and recommendations.
8. Generate a separate instructor-only teaching note.
9. Edit both outputs.
10. Export the result.

---

## 21. Example End-to-End Flow

### Instructor input

> I want to teach channel conflict to MBA students in a marketing strategy course. I would like the case to involve a growing consumer products company deciding whether to sell through a national retailer.

### App output: Learning brief

The app identifies channel conflict, margin tradeoffs, customer segmentation, and growth strategy as the relevant learning objectives.

### App output: Scenario alternatives

The app generates several options, including specialty food, outdoor apparel, beauty products, and home fitness equipment.

### Instructor selection

The instructor selects the specialty food option.

### App output: Case blueprint

The app creates a protagonist, company history, market context, stakeholder list, timeline, possible exhibits, and decision point.

### App output: Student case

The app writes a narrative case ending with the founder deciding whether to accept the national retailer’s offer.

### App output: Teaching note

The app separately provides alternatives, channel-margin analysis, discussion questions, implementation considerations, and lessons learned.

---

## 22. Open Product Questions

1. Should the MVP prioritize fictional cases or real-company-inspired cases?
2. Should the initial interface be wizard-first, chat-first, or hybrid?
3. How much control should users have over generated quantitative exhibits?
4. Should teaching notes be generated automatically or only on request?
5. Should the app support student assignment questions in MVP?
6. Should exports use branded templates?
7. Should cases be stored as structured data, markdown, or both?
8. How should the app label synthetic data?
9. Should users be able to create a reusable library of teaching principles?
10. Should the app eventually support peer review or case publication?

---

## 23. Recommended MVP Decision Set

For the first build, use the following product decisions:

- **Interface:** Wizard-first with an embedded AI assistant
- **Case type:** Fictional and composite cases by default
- **Reference handling:** Paste text and upload files
- **Scenario generation:** Required step
- **Approval checkpoints:** Required before case draft
- **Student/instructor separation:** Enforced by validation
- **Case lengths:** Mini and standard
- **Exhibits:** Optional, editable, synthetic data clearly labeled
- **Exports:** Markdown, Word, PDF
- **Collaboration:** Not included in MVP
- **Version history:** Lightweight autosave with manual checkpoints

---

## 24. Development Backlog

## 24.1 Must have

- User authentication
- Case project creation
- Teaching principle form
- Reference material input
- AI-generated teaching brief
- AI-generated scenario alternatives
- Scenario selection UI
- Case blueprint generation
- Student case generation
- Teaching note generation
- Markdown editor
- Export to Markdown
- Basic export to Word/PDF

## 24.2 Should have

- Editable structured fields
- Basic version history
- Exhibit generation
- Teaching note format options
- Revision commands
- Boundary validation
- Synthetic data labeling

## 24.3 Could have

- Case templates
- Saved teaching principles
- Instructor style profiles
- Board plan generator
- Assignment question generator
- Rubric generator
- Multiple export themes

## 24.4 Later

- Collaboration
- LMS integration
- SSO
- Real-company fact verification workflow
- Case library marketplace
- Student-facing simulation mode

---

## 25. Summary

Case Writer should be designed as a guided instructional authoring tool. Its core value is not merely generating prose, but helping instructors move from a teaching principle to a realistic, discussion-worthy decision case.

The most important product requirements are:

1. Start with the teaching principle.
2. Generate multiple scenario alternatives.
3. Keep the instructor in control.
4. Draft only the student-facing case first.
5. Keep alternatives, analysis, implementation, outcomes, and lessons in the teaching note.
6. Support iteration, editing, and export.

A strong MVP can be built with a wizard-first workflow, structured AI outputs, scenario selection, student-case drafting, teaching-note generation, and export. Later versions can add collaboration, institutional deployment, source verification, and case libraries.

