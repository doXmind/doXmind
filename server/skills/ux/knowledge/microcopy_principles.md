# Microcopy Principles

Core guidelines for writing effective interface copy.

---

## What is Microcopy?

Microcopy is the small bits of text throughout a digital product:
- Button labels
- Form field hints
- Error messages
- Tooltips
- Confirmation messages
- Empty states
- Navigation labels
- Loading states

Small words, big impact.

---

## Core Principles

### 1. Clarity Above All

**The Rule**: If a user has to think about what something means, rewrite it.

**In Practice**:
- Use common words
- Be specific
- Avoid ambiguity
- One meaning per message

| Unclear | Clear |
|---------|-------|
| "Process" | "Submit Payment" |
| "Item" | "Article" or "Product" |
| "Resource" | "Guide" or "Template" |
| "Submit" | "Send Message" |

---

### 2. Be Concise

**The Rule**: Use the fewest words that convey the complete meaning.

**In Practice**:
- Cut filler words
- Limit sentences to one idea
- Keep buttons to 1-4 words
- Respect user's time

| Wordy | Concise |
|-------|---------|
| "Click here to download" | "Download" |
| "In order to continue, you must..." | "To continue..." |
| "Please enter your email address below" | "Email" |
| "Are you sure you want to delete this?" | "Delete this item?" |

---

### 3. Lead with What Matters

**The Rule**: Put the most important information first.

**In Practice**:
- Front-load key words
- Verb-first for actions
- Answer "what" before "how"
- Consequence first, then explanation

| Back-loaded | Front-loaded |
|-------------|--------------|
| "Click here to save changes" | "Save changes" |
| "Your password must be 8 characters" | "8+ characters required" |
| "To get help, contact support" | "Contact support for help" |

---

### 4. Speak Human

**The Rule**: Write like you're talking to a person, not programming a computer.

**In Practice**:
- Conversational (not robotic)
- Contractions are okay
- Simple vocabulary
- Natural sentence structure

| Robotic | Human |
|---------|-------|
| "Error: Invalid input detected" | "That doesn't look right" |
| "Operation completed successfully" | "Done!" or "Saved" |
| "Authentication required" | "Please log in" |

---

### 5. Be Helpful, Not Just Accurate

**The Rule**: Don't just state what happened—help the user move forward.

**In Practice**:
- Explain what to do next
- Offer alternatives
- Anticipate questions
- Guide, don't block

| Accurate but Unhelpful | Helpful |
|------------------------|---------|
| "Password incorrect" | "Password incorrect. [Reset password](#)" |
| "Item not found" | "Item not found. Try searching for something else." |
| "Payment declined" | "Payment declined. Try a different card or contact your bank." |

---

### 6. Match User's Mindset

**The Rule**: Consider what the user is thinking and feeling at this moment.

**In Practice**:

| Context | User Mindset | Tone |
|---------|--------------|------|
| Success | Relieved, happy | Celebratory, brief |
| Error | Frustrated, confused | Calm, helpful |
| Important action | Uncertain | Clear, reassuring |
| Onboarding | Curious, impatient | Welcoming, efficient |
| Destructive action | Cautious | Serious, unambiguous |

---

### 7. Be Consistent

**The Rule**: Same thing = same word, everywhere.

**In Practice**:
- One term per concept
- Consistent capitalization
- Pattern-based messages
- Predictable structure

**Terminology Guide Example**:
| Concept | Use | Don't Use |
|---------|-----|-----------|
| Remove | Delete | Remove, Erase, Eliminate |
| Cancel | Cancel | Abort, Stop, Nevermind |
| Finish | Done | Complete, Finished, OK |

---

## Button Writing

### General Rules

1. **Start with a verb**: Save, Send, Download, Create
2. **Be specific**: "Save Changes" not "Save"
3. **Match user intent**: What do THEY want to do?
4. **Keep short**: 1-4 words

### Button Patterns

| Action Type | Pattern | Examples |
|-------------|---------|----------|
| Submit | [Verb] + [Object] | "Send Message", "Submit Application" |
| Navigation | [Verb] + [Destination] | "Go to Dashboard", "View Details" |
| Creation | Create/Add + [Thing] | "Create Project", "Add Member" |
| Destructive | [Verb] (warning color) | "Delete", "Remove" |

### Button Pairs

| Primary | Secondary |
|---------|-----------|
| Save | Cancel |
| Create | Cancel |
| Delete | Keep |
| Send | Cancel |
| Confirm | Go Back |

---

## Form Writing

### Labels
- Clear nouns
- Required indicator if needed
- Consistent format

### Placeholders
- Show format: "MM/DD/YYYY"
- Give example: "e.g., john@example.com"
- Don't replace labels

### Help Text
- Explain requirements: "8-20 characters"
- Prevent errors
- Position near field

---

## Error Writing

### Formula
**What happened** + **How to fix it**

### Principles
1. Don't blame the user
2. Be specific
3. Show the solution
4. Use plain language

### Examples
| Bad | Good |
|-----|------|
| "Error" | "Couldn't save. Try again." |
| "Invalid" | "Enter a valid email address" |
| "Failed" | "Connection lost. Check your internet." |

---

## Confirmation Writing

### Success Messages
- Brief and positive
- Confirm what happened
- Allow undo if possible

Examples:
- "Saved"
- "Message sent"
- "Project created"
- "Changes saved"

### Confirmation Dialogs

**For Significant Actions**:
```
[Question that states what will happen]

[Explanation of consequences]

[Primary Action] [Cancel]
```

Example:
```
Delete this project?

All files and settings will be permanently removed.

[Delete Project] [Cancel]
```

---

## Loading States

### While Waiting
- Set expectations
- Show progress if possible
- Provide context

Examples:
- "Loading..." (generic, okay for short waits)
- "Loading your dashboard..."
- "This may take a minute..."
- "Uploading... 45%"

### When It's Taking Long
- "Still working on it..."
- "Thanks for waiting..."
- "Almost there..."

---

## Empty States

### Components
1. What this area is for
2. Why it's empty
3. How to fill it (CTA)

### Example
```
No projects yet

Create a project to organize your work.

[Create Project]
```

---

## Quick Reference

### Do
- Front-load important words
- Use verbs for actions
- Be specific
- Write at a 7th-grade level
- Test with real users

### Don't
- Use jargon
- Be vague
- Blame users
- Write in ALL CAPS
- Use exclamation points excessively
