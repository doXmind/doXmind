# Presentation Mode: Turn Documents into Slides

You have just finished writing a thorough project proposal in doXmind. Now your manager wants you to present it at the team meeting. Normally, this means recreating your content in a slide tool -- copying text, reformatting layouts, and inevitably losing the nuance of your written document. doXmind's presentation mode eliminates that extra step entirely. Your document becomes your presentation.

This guide explains how presentation mode works, how to structure your documents for effective presentations, and practical tips for creating slides that communicate clearly.

## How Presentation Mode Works

Presentation mode transforms your document into a sequence of slides based on its heading structure. Each top-level section (H2 heading) becomes a separate slide. The content beneath each heading becomes the slide's body.

### Entering Presentation Mode

To start a presentation, open the document menu (the three-dot icon in the top toolbar) and select **Presentation Mode**. Alternatively, use the keyboard shortcut `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac).

Your document immediately transforms into a full-screen slide view. The first slide shows your document's H1 title as the presentation title.

### Navigating Slides

Move between slides using:

- **Arrow keys** -- Right or Down to advance, Left or Up to go back.
- **Spacebar** -- Advance to the next slide.
- **Click** -- Click anywhere on the right side of the slide to advance, left side to go back.
- **Slide counter** -- Click the slide number indicator at the bottom to jump to a specific slide.

Press **Escape** to exit presentation mode and return to the normal editor.

### Slide Structure

doXmind converts your document to slides using these rules:

| Document Element | Slide Behavior |
|-----------------|----------------|
| H1 heading | Title slide |
| H2 heading | New slide with section title |
| H3 heading | Sub-section within the current slide |
| Paragraphs | Slide body text |
| Bullet lists | Bullet points on the slide |
| Numbered lists | Numbered points on the slide |
| Images | Displayed on the slide, scaled to fit |
| Code blocks | Formatted code display |
| Callout blocks | Highlighted callout box |
| Database blocks | Compact table view |
| Blockquotes | Styled quote display |

## Structuring Documents for Presentations

The best presentation-ready documents follow a structure that works both as a written piece and as a slide deck. Here are the principles.

### One Idea Per H2 Section

Each H2 section becomes one slide. If a section covers multiple ideas, it will produce a cluttered slide. Keep each section focused on a single point.

**Too much for one slide:**

```markdown
## Project Update
The frontend redesign is 80% complete. We shipped the new navigation
last week and are now working on the settings page. Backend migration
is on track, with database schema changes deployed to staging. The QA
team has logged 23 bugs, 18 of which are resolved. We need to discuss
the launch timeline because marketing wants to coordinate with the
email campaign scheduled for March 15.
```

**Better -- split into multiple slides:**

```markdown
## Frontend Progress
The redesign is 80% complete. New navigation shipped last week.
Settings page is the current focus.

## Backend Migration
Database schema changes deployed to staging. On track for
production migration next sprint.

## QA Status
- 23 bugs logged
- 18 resolved, 5 remaining
- No blockers for launch

## Launch Timeline Discussion
Marketing wants to coordinate with the March 15 email campaign.
Need alignment on release date.
```

### Use Bullet Points for Key Takeaways

Slides communicate best through concise points, not dense paragraphs. When writing sections you know will be presented, use bullet lists for the main points and keep explanatory prose brief.

```markdown
## Why We Should Invest in Automation

- Manual processes consume 120 engineer-hours per month
- Error rate on manual deployments: 8%, automated: 0.3%
- Payback period: 4 months based on current team costs
- Competitors have already automated this workflow
```

### Include Visual Anchors

Slides with only text can feel monotonous. Break up text-heavy sections with:

- **Images** -- Charts, diagrams, screenshots, or photos that support your point.
- **Callout blocks** -- Use callouts to highlight key statistics or quotes.
- **Code blocks** -- When presenting technical content, code examples add visual variety.

### Write Speaker Notes in Your Prose

Here is a practical trick: write your presentation as a normal document with full prose, but structure the key points as bullet lists. When presenting, the bullets appear on the slide while the surrounding paragraphs serve as your speaker notes -- they are in the document for readers but are not displayed in the compressed slide view.

## Designing Effective Slides

### The 6-Line Rule

Aim for no more than six bullet points or six lines of text per slide. If a slide has more content than that, consider splitting it into two slides or moving supporting detail into a follow-up slide.

### Titles That Communicate

Do not use generic titles like "Overview" or "Details." Make each slide title a complete thought that communicates your point even if the audience reads nothing else.

| Weak Title | Strong Title |
|------------|-------------|
| Overview | Revenue Grew 24% Year-Over-Year |
| Problem | Manual Deploys Cost 120 Hours Monthly |
| Solution | Automated Pipeline Reduces Errors by 96% |
| Next Steps | Three Actions Needed Before March Launch |

A reader skimming your slides should understand the story from titles alone.

### Progressive Disclosure

Structure your presentation so each slide builds on the previous one. A common pattern:

1. **Context slide** -- Set up the situation or problem.
2. **Tension slide** -- Show why the current state is unsustainable.
3. **Solution slide** -- Present your recommendation.
4. **Evidence slides** -- Support the recommendation with data.
5. **Action slide** -- Define concrete next steps.

This narrative arc keeps the audience engaged and makes your argument persuasive.

## Working With Different Content Types

### Images in Presentations

Images in your document display on slides scaled to fit the available space. For the best results:

- Use images with a landscape orientation (wider than tall).
- Keep images high-resolution -- they will be displayed full-width.
- Place the image immediately after the H2 heading for a visual-first slide, or after a few bullet points as supporting evidence.

### Database Blocks in Presentations

Database blocks render as compact tables in presentation mode. This works well for:

- Comparison matrices.
- Status dashboards.
- Simple data tables.

Keep database blocks small for presentations -- tables with more than 5-6 rows or 4-5 columns become hard to read on a slide. If you have a large dataset, filter it to show only the most relevant records before entering presentation mode.

### Code Blocks in Presentations

Code blocks display with syntax highlighting in presentation mode. They are effective for:

- Showing configuration examples.
- Demonstrating API usage.
- Presenting before/after code changes.

Keep code blocks short -- 10-15 lines maximum. Longer code samples should be split across slides or simplified to show only the relevant portion.

### Callout Blocks

Callouts translate particularly well to slides because they are already visually distinct. Use them for:

- Key statistics that deserve emphasis.
- Important warnings or caveats.
- Memorable quotes.

## Presentation Tips

### Rehearse Using Presentation Mode

Run through your slides in presentation mode before the actual meeting. This reveals:

- Slides that are too dense and need splitting.
- Awkward transitions where you need an additional slide.
- Content gaps where a slide feels unsupported.

### Use the Slide Counter

The slide counter at the bottom of the screen shows your current position (e.g., "7 / 15"). Use it to pace yourself -- if you are on slide 12 of 15 with half your time remaining, you know you can slow down and add more commentary.

### Keep the Document as a Leave-Behind

One of the great advantages of document-based presentations is that your slides and your detailed write-up are the same artifact. After the meeting, export the document or keep it alongside the presentation notes. Attendees can get both the slide-level summary (from the headings and bullets) and the full context (from the prose paragraphs) in one place.

### Combining With Cover Images

If your document has a cover image set, it will appear as the background of your title slide. Choose cover images that are professional and not too visually busy -- the title text needs to remain readable on top of the image.

## Quick Reference: Presentation Mode Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + Shift + P` | Enter presentation mode |
| `Escape` | Exit presentation mode |
| `Right Arrow` / `Space` | Next slide |
| `Left Arrow` | Previous slide |
| `Home` | First slide |
| `End` | Last slide |
| `F` | Toggle fullscreen |

## Next Steps

Presentation mode turns every document into a potential slide deck. Here is how to start using it:

- **Try it now.** Open any existing document and enter presentation mode. See how your current heading structure translates into slides. You might be surprised at how well it works without any changes.
- **Structure your next document** with presentation in mind. Use one H2 section per key point and keep bullet lists concise.
- **Practice the strong-title technique.** Rewrite your H2 headings to communicate complete thoughts instead of generic labels.
- **Experiment with visual elements.** Add images, callouts, or database blocks to create slides with visual variety.
- **Read the next guide**, "Keyboard Shortcuts," to master the key combinations that make you faster across all of doXmind, including presentation mode.
