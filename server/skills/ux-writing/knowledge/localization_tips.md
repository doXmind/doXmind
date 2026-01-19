# Localization Tips

Writing content that translates well across languages and cultures.

---

## Why Localization Matters

- 75% of consumers prefer to buy in their native language
- Poor translations damage trust and brand perception
- Writing for localization from the start saves time and money
- Global products need global-ready content

---

## String Construction

### Never Concatenate Strings

**Bad (Concatenation)**:
```javascript
"Welcome " + userName + "!"
"You have " + count + " messages"
"Delete " + itemName + "?"
```

**Why it breaks**: Word order differs by language.
- English: "5 new messages"
- German: "5 neue Nachrichten"
- Japanese: "新しいメッセージが5件あります" (structure completely different)

**Good (Placeholder Tokens)**:
```javascript
"Welcome {userName}!"
"You have {count} messages"
"Delete {itemName}?"
```

Translators can reorder placeholders appropriately.

---

### Don't Embed Text in Images

**Bad**: Logo image with tagline baked in
**Good**: Image without text + separate text layer

Why: Text in images can't be translated

---

### Complete Sentences

**Bad**: "Page" + pageNum + "of" + totalPages
**Good**: "Page {current} of {total}"

Translators need full context to translate correctly.

---

## Grammar and Structure

### Avoid Idioms and Colloquialisms

**Bad**: "Piece of cake", "Hit the ground running", "In a nutshell"
**Good**: Simple, direct statements

| Idiom | Plain Alternative |
|-------|------------------|
| "Piece of cake" | "Easy" |
| "Break the ice" | "Start a conversation" |
| "Ballpark figure" | "Estimate" |
| "Up in the air" | "Uncertain" |
| "At the drop of a hat" | "Immediately" |

---

### Watch for False Friends

Words that look similar across languages but mean different things:

| English | Similar word in other language | Actual meaning |
|---------|-------------------------------|----------------|
| "Actual" | "Actuellement" (French) | "Currently" |
| "Gift" | "Gift" (German) | "Poison" |
| "Sensible" | "Sensible" (Spanish) | "Sensitive" |

Avoid words that could confuse translators or have false cognates.

---

### Use Standard Grammar

- Simple sentence structures
- Avoid complex subordinate clauses
- One idea per sentence
- Subject-verb-object order when possible

**Bad**: "The button, which when clicked saves your work and, assuming no errors occur, redirects you to the dashboard."

**Good**: "Click the button to save your work. You'll go to the dashboard."

---

## Numbers, Dates, and Units

### Number Formats

| Region | Format |
|--------|--------|
| US | 1,234.56 |
| Germany | 1.234,56 |
| France | 1 234,56 |

**Solution**: Use localization libraries that auto-format numbers.

### Date Formats

| Region | Format | Example |
|--------|--------|---------|
| US | MM/DD/YYYY | 12/31/2024 |
| Europe | DD/MM/YYYY | 31/12/2024 |
| ISO | YYYY-MM-DD | 2024-12-31 |

**Best Practice**:
- Use words when space allows: "December 31, 2024"
- Or use ISO format for unambiguous dates
- Never assume MM/DD/YYYY is universal

### Time Formats

| Region | Format |
|--------|--------|
| US | 12-hour (3:00 PM) |
| Most of world | 24-hour (15:00) |

**Best Practice**: Allow user preference or show both.

### Units

| Measurement | US | Rest of world |
|-------------|----|----|
| Distance | Miles | Kilometers |
| Temperature | Fahrenheit | Celsius |
| Weight | Pounds | Kilograms |

**Best Practice**: Auto-detect locale or allow user preference.

---

## Text Expansion

### Plan for Expansion

Translated text is often longer than English:

| Language | Typical Expansion |
|----------|-------------------|
| German | +30% |
| French | +20% |
| Spanish | +25% |
| Finnish | +40% |
| Chinese | -30% to +10% |
| Japanese | Variable |

### UI Implications

- Design flexible containers
- Avoid fixed-width buttons
- Allow text to wrap
- Test with German (often longest)

**Example**:
- English: "Save" (4 characters)
- German: "Speichern" (9 characters)
- French: "Enregistrer" (11 characters)

---

## Pluralization

### English Has Two Forms

- 1 item (singular)
- 0, 2, 3... items (plural)

### Other Languages Have More

| Language | Plural Forms |
|----------|--------------|
| English | 2 (one, other) |
| French | 2 (one, other) |
| Russian | 4 (one, few, many, other) |
| Arabic | 6 (zero, one, two, few, many, other) |
| Japanese | 1 (no plural) |

**Bad**:
```javascript
count + " item" + (count !== 1 ? "s" : "")
```

**Good**: Use localization library with proper plural rules
```javascript
t('items', { count: 5 }) // Handles all forms
```

---

## Cultural Considerations

### Colors

| Color | Western | China | Middle East |
|-------|---------|-------|-------------|
| White | Purity | Mourning | Purity |
| Red | Danger/passion | Good luck | Danger |
| Green | Nature/go | - | Sacred |
| Black | Elegance/death | - | - |

Don't rely on color alone for meaning.

### Symbols and Icons

| Symbol | Be Careful |
|--------|------------|
| Checkmark | Not universal for "correct" |
| Thumbs up | Offensive in some cultures |
| Hand gestures | Vary widely |
| Religious symbols | Sensitive |
| Animals | Different associations |

### Names and Forms

- Not everyone has first/last name structure
- Name order varies (family name first in Asia)
- Titles and honorifics differ
- Some cultures use single names

**Best Practice**: Use "Full name" or allow flexible name fields.

---

## Writing Guidelines

### Do

- Use complete sentences
- Write simply and directly
- Use placeholder tokens for variables
- Plan for text expansion
- Provide context for translators
- Use standard punctuation
- Be culturally neutral

### Don't

- Concatenate strings
- Embed text in images
- Use idioms or slang
- Assume date/number formats
- Use culturally specific references
- Make jokes (they rarely translate)
- Use puns or wordplay

---

## Localization Comments

### Provide Context

Help translators understand:
- Where this text appears
- What the user is doing
- Any character limits
- Whether placeholders can be reordered

**Example**:
```javascript
// Appears on dashboard card
// {count} = number of unread notifications
// Max 50 characters
t('unread_notifications', { count: 5 })
```

---

## Testing Localization

### Pseudo-Localization

Replace text with extended characters to test:
- Text expansion handling
- Special character support
- Layout flexibility

Example: "Settings" → "Šēttîñgš éxtèñdéd"

### Right-to-Left (RTL) Testing

- Arabic, Hebrew, Persian read RTL
- UI must mirror
- Test early and often

### In-Context Review

- Show translators where text appears
- Screenshots help
- Note character limits

---

## Localization Checklist

### Content
- [ ] No concatenated strings
- [ ] No text in images
- [ ] Complete sentences
- [ ] No idioms or puns
- [ ] Culturally neutral
- [ ] Plain language

### Technical
- [ ] Placeholder tokens used
- [ ] Pluralization handled properly
- [ ] Dates/numbers localized
- [ ] Units adaptable
- [ ] RTL considered
- [ ] Text expansion accommodated

### Context
- [ ] Localization comments added
- [ ] Screenshots available
- [ ] Character limits documented
- [ ] Tone/voice guidelines shared
