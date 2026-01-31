# Accessibility Writing Guide

Writing content that works for all users.

---

## Why Accessible Writing Matters

Accessible writing helps:
- Users with visual impairments (screen readers)
- Users with cognitive differences
- Users with motor impairments
- Non-native speakers
- Users in challenging environments
- Everyone (good UX writing is accessible writing)

---

## Screen Reader Considerations

### Link Text

**Bad**: "Click here", "Learn more", "Read more"

**Why it's bad**: Screen reader users often navigate by links. Out of context, these phrases mean nothing.

**Good**: Descriptive link text that makes sense alone

| Instead of | Use |
|------------|-----|
| "Click here to view pricing" | "View pricing" |
| "Learn more" | "Learn more about our security features" |
| "Read more" | "Read the full case study" |

---

### Alt Text for Images

**Purpose**: Describe meaningful images for users who can't see them.

**Guidelines**:
- Describe the content, not the image type ("A dog" not "Image of a dog")
- Be concise (under 125 characters)
- Don't include "image of" or "picture of"
- Convey the purpose/meaning, not just appearance

**Examples**:
| Context | Good Alt Text |
|---------|---------------|
| Product photo | "Blue running shoes with white soles" |
| Chart | "Bar chart showing 45% increase in sales from Q1 to Q2" |
| Decorative | "" (empty alt attribute) |
| Logo | "Company Name logo" |

**When to Skip Alt Text**:
- Purely decorative images
- Images with adjacent text that describes them
- Use empty alt="" (not missing alt attribute)

---

### Buttons and Controls

**Labels must**:
- Describe the action
- Make sense out of context
- Be unique on the page (if possible)

**Bad**: Multiple "Submit" buttons on one page
**Good**: "Submit Payment", "Submit Form", "Send Message"

---

### Form Labels

**Every input needs an associated label**:
- Labels must be programmatically associated
- Placeholder text is NOT a replacement for labels
- Labels should be visible (not just for screen readers)

**Error Messages**:
- Associate with the relevant field
- Announce errors to screen readers
- Don't rely only on color to indicate errors

---

## Cognitive Accessibility

### Plain Language

**Reading Level**: Aim for 7th-8th grade level

**Guidelines**:
- Short sentences (under 20 words)
- Common words over jargon
- Active voice
- One idea per sentence

**Tools**: Hemingway Editor, readability scores

### Chunking Information

- Use headings to organize content
- Break long content into sections
- Use bullet points for lists
- White space helps comprehension

### Clear Instructions

**Bad**: "Please complete the required fields and submit"
**Good**: "Enter your email and password, then click 'Create Account'"

Be specific about:
- What to do
- Where to do it
- What happens next

---

### Memory Load

**Don't make users remember things**:
- Show context on each screen
- Use recognition over recall
- Provide examples and hints

**Bad**: "Enter the code we sent you" (what code? where?)
**Good**: "Enter the 6-digit code we sent to j***@email.com"

---

## Inclusive Language

### Gender

**Avoid gendered language**:
| Instead of | Use |
|------------|-----|
| "He or she" | "They" |
| "Mankind" | "Humanity", "People" |
| "Man-hours" | "Work hours", "Person hours" |
| "Hey guys" | "Hey everyone", "Hey team" |

### Ability

**Avoid ableist language**:
| Instead of | Use |
|------------|-----|
| "Crazy", "Insane" | "Wild", "Unbelievable" |
| "Blind to" | "Unaware of" |
| "Crippled" | "Broken", "Disabled" |
| "Dumb" | "Invalid", "Empty" |
| "Lame" | "Disappointing" |

### Cultural Sensitivity

- Avoid idioms that don't translate
- Be aware of color symbolism differences
- Consider global date/time/number formats
- Don't assume cultural knowledge

---

## Writing for Time Pressure

### Don't Assume Speed

Some users need more time due to:
- Motor impairments
- Cognitive processing differences
- Screen reader navigation
- Environmental factors

**Guidelines**:
- Avoid countdown timers when possible
- If timers are necessary, allow extension
- Don't auto-advance content too quickly
- Save progress automatically

---

## Error Prevention and Recovery

### Prevent Errors

- Clear labels and instructions
- Examples of expected format
- Inline validation before submit
- Confirmation for significant actions

### Helpful Errors

**Accessible error messages**:
1. Clearly explain what happened
2. Don't blame the user
3. Show how to fix it
4. Associate with the relevant field
5. Don't rely on color alone

**Example**:
```
✗ Error: Invalid input (uses color only, no explanation)

✓ Password must be at least 8 characters. (specific, actionable)
```

---

## Mobile Accessibility

### Touch Targets

- Minimum 44x44 pixels
- Adequate spacing between targets
- Clear visual boundaries

### Text

- Minimum 16px for body text
- Scalable with user settings
- Sufficient color contrast

### Copy

- Extra concise (less screen space)
- Clear hierarchy
- Important info visible without scrolling

---

## Testing Accessibility

### Automated Tools
- WAVE
- axe
- Lighthouse
- Screen reader testing (NVDA, VoiceOver)

### Manual Checks
- Navigate with keyboard only
- Listen with a screen reader
- Read at 1.5x zoom
- Check color contrast

### User Testing
- Include users with disabilities
- Test with assistive technology users
- Gather feedback on comprehension

---

## Accessibility Checklist for Writers

### General Content
- [ ] Reading level appropriate (7th-8th grade)
- [ ] Short sentences (under 20 words)
- [ ] Active voice
- [ ] Plain language (no jargon)
- [ ] Inclusive language

### Links
- [ ] Descriptive link text
- [ ] Makes sense out of context
- [ ] Indicates if opens new window

### Images
- [ ] Meaningful images have alt text
- [ ] Alt text describes purpose/content
- [ ] Decorative images have empty alt

### Forms
- [ ] All inputs have labels
- [ ] Instructions are clear and specific
- [ ] Error messages are helpful and associated

### Buttons/Actions
- [ ] Labels describe the action
- [ ] Unique labels when possible
- [ ] Consequences are clear

### Time-Based Content
- [ ] No unnecessary time limits
- [ ] Auto-advance can be paused
- [ ] Progress is saved

---

## Resources

- WCAG Guidelines: https://www.w3.org/WAI/standards-guidelines/wcag/
- Plain Language Guidelines: https://www.plainlanguage.gov/
- Inclusive Design: https://inclusivedesignprinciples.org/
