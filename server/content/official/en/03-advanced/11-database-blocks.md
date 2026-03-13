# Database Blocks: Embed Structured Data in Documents

Not everything belongs in paragraphs. Project timelines, reading lists, contact directories, feature trackers -- these are structured data, and they deserve structured presentation. doXmind's database blocks let you embed fully functional tables, boards, and galleries directly inside your documents, blending prose and data in a single workspace.

This guide covers how to create and use database blocks, explores the built-in templates, and shows practical strategies for managing data within your documents.

## What Are Database Blocks?

A database block is a structured data container embedded inline in your document. Unlike a simple markdown table, database blocks support:

- **Multiple views** -- Switch between table, board (Kanban), and gallery layouts for the same data.
- **Column types** -- Text, number, date, select, multi-select, checkbox, URL, and more.
- **Sorting and filtering** -- Organize your data dynamically without rearranging rows manually.
- **Templates** -- Pre-built schemas for common use cases.

Database blocks live inside your document like any other content block. You can add paragraphs above and below them, reference them in your writing, and export them along with the rest of your document.

## Creating Your First Database Block

### Using Slash Commands

The fastest way to insert a database block is with the slash command menu. Type `/database` anywhere in your document and select **Database Block** from the menu. You will see options for:

- **Empty table** -- Start from scratch with a blank table.
- **From template** -- Choose a pre-built template.
- **Board view** -- Start with a Kanban-style board.
- **Gallery view** -- Start with a card-based gallery.

### Using the Block Menu

Click the **+** button in the left margin of any empty line, then select **Database** from the block type menu. This opens the same creation options as the slash command.

### Configuring Columns

Once your database block is created, configure the columns to match your data:

1. Click any column header to rename it or change its type.
2. Click the **+** icon at the right edge of the header row to add a new column.
3. Drag column headers to reorder them.
4. Right-click a column header for options including hide, duplicate, and delete.

Column types determine what kind of data each column accepts:

| Column Type | Best For | Example |
|-------------|----------|---------|
| Text | Names, descriptions, notes | "Redesign homepage header" |
| Number | Quantities, scores, prices | 42, 99.95 |
| Date | Deadlines, events, timestamps | 2025-03-15 |
| Select | Single-choice categories | Priority: High |
| Multi-select | Multiple tags or labels | Tags: Design, Frontend |
| Checkbox | Binary status tracking | Done: Yes/No |
| URL | Links to external resources | https://example.com |
| Person | Team member assignment | @Sarah |

## Switching Between Views

One of the most powerful aspects of database blocks is the ability to view the same data in different layouts.

### Table View

The default view. Rows and columns, similar to a spreadsheet. Best for:

- Data entry and bulk editing.
- Seeing all fields for every record at once.
- Sorting and comparing records by specific columns.

### Board View

A Kanban-style layout that groups records into columns based on a select field. Best for:

- Tracking items through stages (To Do, In Progress, Done).
- Visualizing workflow and bottlenecks.
- Drag-and-drop status updates.

To switch to board view, click the view selector at the top of the database block and choose **Board**. You will be prompted to select which column to group by -- typically a status or category field.

### Gallery View

A card-based layout that shows each record as a visual card. Best for:

- Content with images (mood boards, product catalogs).
- Browsing records visually rather than scanning rows.
- Presentations and reviews.

Gallery view shows a preview image (if the record has one) and a configurable set of fields on each card.

## Built-In Templates

doXmind includes templates for common use cases, so you do not have to build database schemas from scratch.

### Task Tracker

Columns: Task Name, Status (To Do / In Progress / Done / Blocked), Priority (Low / Medium / High / Urgent), Assignee, Due Date, Notes.

Use this template when you are managing a project within a document. For example, an article about a product launch could include a task tracker for all the deliverables, right alongside the narrative content.

**Practical example:** You are writing a quarterly business review. Embed a task tracker listing all action items from the previous quarter, with their current status. Readers can see both the narrative analysis and the concrete deliverables in one place.

### Project Tracker

Columns: Project Name, Owner, Start Date, End Date, Status, Progress (percentage), Description.

This template is designed for tracking multiple projects or workstreams. It works well in board view, where you can see projects flow through stages.

**Practical example:** A team handbook document includes a project tracker showing all active initiatives. New team members can read the handbook and immediately see what the team is working on.

### Reading List

Columns: Title, Author, Genre/Category, Status (Want to Read / Reading / Finished), Rating, Notes, URL.

Keep a curated reading list inside any document. This is particularly useful for research documents where you want to track your sources alongside your writing.

**Practical example:** You are writing a literature review. The database block at the top of the document lists every source with your reading status and notes. Below it, your review synthesizes the key findings.

### Contacts

Columns: Name, Email, Phone, Company, Role, Tags, Notes.

Embed a contact directory in documents where you need to reference people. Meeting notes, project plans, and team directories all benefit from structured contact information.

**Practical example:** A project kickoff document includes a contacts database with every stakeholder, their role, and their preferred communication channel.

## Working With Data

### Adding Records

Click the **+ New** button at the bottom of a table or board to add a record. Fill in the fields using the inline editor -- click any cell in table view, or open the card detail in board and gallery views.

### Sorting

Click any column header and select **Sort ascending** or **Sort descending**. You can apply multiple sort levels by adding additional sort rules. For example, sort by Priority (descending) and then by Due Date (ascending) to see your most urgent, nearest-deadline items first.

### Filtering

Click the **Filter** button above the database block to add filter conditions. Filters let you focus on a subset of your data:

- Show only tasks where Status is "In Progress."
- Show only reading list items where Rating is 4 or above.
- Show only projects where Owner is "Me."

Filters are non-destructive -- they hide rows temporarily without deleting them. Remove the filter to see all records again.

### Bulk Editing

In table view, you can select multiple rows using the checkboxes in the left column, then apply bulk actions:

- Set a field value for all selected records.
- Delete multiple records at once.
- Move records to a different status (in board view, drag multiple cards).

## Embedding Databases in Your Writing Workflow

Database blocks are most powerful when they complement your prose rather than replacing it.

### Pattern: Data-Driven Narratives

Write your analysis in prose, then embed the supporting data as a database block. The reader gets your interpretation and the raw data to verify or explore further.

> In Q3, we completed 85% of planned deliverables, up from 72% in Q2. The improvement was driven primarily by the engineering team, which cleared its entire backlog for the first time this year.

Below this paragraph, embed a task tracker showing the specific deliverables, their status, and completion dates. The narrative tells the story; the database provides the evidence.

### Pattern: Living Documents

Some documents are meant to be updated over time -- project plans, team wikis, process guides. Database blocks make these documents functional rather than static. A team can update task statuses, add new contacts, or log new reading materials without editing the prose sections.

### Pattern: Self-Contained Reports

Combine prose, database blocks, and other content types (images, callouts, code blocks) into a single document that serves as a complete, self-contained report. No need to link to external spreadsheets or project management tools -- everything lives in one place.

## Tips for Effective Database Blocks

1. **Keep schemas simple.** Start with fewer columns and add more as needed. A database with 15 columns is harder to maintain than one with 6 focused columns.
2. **Use select fields for consistency.** Free-text status fields lead to entries like "done," "Done," "DONE," and "completed." A select field enforces consistent options.
3. **Name your views.** If you create multiple views of the same database, give each view a descriptive name ("By Status," "By Due Date," "Completed Only").
4. **Combine with headings.** Place a heading above each database block to label it and make it accessible from the outline view.

## Next Steps

Database blocks open up new possibilities for how you use documents. Here is how to explore further:

- **Create a task tracker** in your next project document. Track deliverables alongside your project narrative.
- **Try switching views** on the same data. Create a table, then switch to board view to see how the Kanban layout changes your perspective.
- **Build a reading list** for a research project. Use the reading list template and add your sources as you find them.
- **Experiment with filters and sorts** to create focused views of your data -- for example, a "This Week" filter showing only tasks due in the next seven days.
- **Read the next guide**, "Presentation Mode," to learn how to turn your documents -- including those with database blocks -- into slide presentations.
