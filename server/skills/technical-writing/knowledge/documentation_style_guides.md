# Documentation Style Guides

A summary of best practices from Google, Microsoft, and industry-standard technical writing style guides.

---

## Core Principles

### 1. Write for Your Audience

- Identify who will read the documentation
- Match complexity to reader's technical level
- Don't assume prior knowledge without stating prerequisites
- Use terminology your audience expects

### 2. Be Clear and Concise

- Use simple, direct language
- One idea per sentence
- Eliminate unnecessary words
- Get to the point quickly

### 3. Be Consistent

- Use the same terminology throughout
- Follow the same formatting patterns
- Apply consistent capitalization and punctuation
- Maintain uniform voice and tone

---

## Language Guidelines

### Voice and Tone

**Use Active Voice (Preferred)**
- Active: "Click the Submit button"
- Passive: "The Submit button should be clicked" (Avoid)

**Use Second Person**
- Do: "You can configure the settings..."
- Don't: "The user can configure the settings..."
- Don't: "One can configure the settings..."

**Be Direct**
- Do: "To save the file, press Ctrl+S"
- Don't: "You might want to save the file by pressing Ctrl+S"

### Sentence Structure

**Keep Sentences Short**
- Aim for 20-25 words maximum
- Break complex sentences into smaller ones
- Use one idea per sentence

**Lead with Context**
- Do: "To create a new project, click File > New"
- Don't: "Click File > New to create a new project"

**Avoid Double Negatives**
- Do: "The feature is available"
- Don't: "The feature is not unavailable"

### Word Choice

**Use Specific Terms**
- Do: "Click" (for mouse), "Tap" (for touch), "Select" (for options)
- Don't: "Hit", "Press" (for UI elements)

**Avoid Jargon**
- Define technical terms on first use
- Prefer common words when possible
- Create a glossary for complex documentation

**Avoid Filler Words**
Remove: very, really, basically, simply, actually, just, quite, rather

**Be Precise**
- Do: "Wait 30 seconds"
- Don't: "Wait a moment"

---

## Formatting Standards

### Headings

**Capitalization**
- Google Style: Sentence case ("Getting started with the API")
- Microsoft Style: Title case ("Getting Started with the API")
- Pick one and be consistent

**Guidelines**
- Be specific and descriptive
- Front-load important words
- Avoid gerunds when possible ("Configure settings" not "Configuring settings")
- Don't skip heading levels (H1 > H2 > H3)

### Lists

**Numbered Lists**
- Use for sequential steps
- Use for ranked items
- Start each item with an action verb (for procedures)

**Bulleted Lists**
- Use for unordered items
- Use for features or options
- Keep items grammatically parallel

**List Formatting**
- Capitalize the first word
- No periods for short items (fragments)
- Use periods for complete sentences
- Maintain parallel structure

### Code

**Inline Code**
- Use for: file names, function names, variables, commands, UI elements
- Format: `code formatting`

**Code Blocks**
- Always specify the language
- Include comments for clarity
- Show realistic, working examples
- Keep examples minimal but complete

**Command Line**
- Show the prompt where helpful
- Use `$` for regular user, `#` for root
- Separate commands from output

### Tables

**When to Use Tables**
- Parameter references
- Feature comparisons
- Option lists with descriptions
- Any repeated pattern of related data

**Table Guidelines**
- Include header row
- Keep cell content concise
- Align numbers to the right
- Use "N/A" or "-" for empty cells

### Links

**Link Text**
- Use descriptive text
- Don't use "click here" or "this page"
- Include enough context in the link text
- Do: "See the [Installation Guide](#) for details"
- Don't: "[Click here](#) to see the Installation Guide"

---

## Document Structure

### Standard Page Structure

1. **Title**: Clear, descriptive, action-oriented
2. **Introduction**: 1-2 sentences explaining what and why
3. **Prerequisites**: What users need before starting
4. **Body**: Main content with clear headings
5. **Examples**: Working, tested examples
6. **Related links**: Next steps or related topics

### Procedures (How-to)

1. Brief introduction (why do this?)
2. Prerequisites (what's needed?)
3. Numbered steps (one action per step)
4. Expected result (what should happen)
5. Troubleshooting (common issues)

### Reference Documentation

- Consistent structure for each item
- Complete information (all parameters, options)
- Working examples
- Clear type information
- Default values noted

---

## Common Mistakes to Avoid

### Ambiguous Language

| Avoid | Use Instead |
|-------|-------------|
| "Some" | Specific number or "multiple" |
| "Several" | "Three" or "more than two" |
| "A few" | Specify the number |
| "Usually" | "In most cases" or be specific |
| "Often" | Provide frequency or conditions |

### Unclear References

| Avoid | Use Instead |
|-------|-------------|
| "It" (when unclear) | Repeat the noun |
| "This" (alone) | "This setting", "This feature" |
| "Above"/"Below" | Link to specific section |

### Unnecessary Words

Remove when possible:
- "In order to" → "To"
- "Due to the fact that" → "Because"
- "At the present time" → "Now"
- "A total of five" → "Five"
- "Basic fundamentals" → "Fundamentals"
- "End result" → "Result"

---

## Platform-Specific Guidelines

### Google Style Highlights

- Conversational but professional tone
- Use contractions (you're, it's, don't)
- Sentence case for headings
- Present tense for UI actions
- "Click" for mouse, "Tap" for touch

### Microsoft Style Highlights

- Friendly and helpful tone
- Use contractions sparingly
- Title case for headings
- Focus on customer success
- Use "Select" instead of "Click"

---

## Accessibility

### General Guidelines

- Use descriptive alt text for images
- Don't rely on color alone to convey meaning
- Use proper heading hierarchy
- Ensure sufficient color contrast
- Write descriptive link text

### Screen Reader Considerations

- Images need meaningful alt text
- Tables need clear headers
- Use semantic HTML elements
- Avoid "click here" links
- Provide text alternatives for non-text content

---

## Localization

### Writing for Translation

- Use simple sentence structures
- Avoid idioms and cultural references
- Allow for text expansion (30-50%)
- Don't embed text in images
- Use Unicode for special characters

### Date and Number Formats

- Use ISO 8601 dates when possible (YYYY-MM-DD)
- Specify units (MB, not M)
- Use numerals for measurements
- Note time zones explicitly

---

## Quick Reference

### Before Publishing Checklist

- [ ] Title is clear and descriptive
- [ ] Introduction explains purpose
- [ ] Prerequisites are listed
- [ ] Steps are numbered and complete
- [ ] Code examples are tested
- [ ] Links are working
- [ ] Terminology is consistent
- [ ] Formatting follows style guide
- [ ] Spelling and grammar checked
- [ ] Accessible to all users
