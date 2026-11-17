# Changelog

All notable changes to this widget are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-11-17

First Marketplace release. It includes everything built so far: a zoomable timeline next to an editable task list,
groups and multi-project portfolios with summary bars and WBS numbers, dependencies (FS, SS, FF, SF) with lags,
constraints, split tasks, the critical path and total float, up to ten named baselines, auto-scheduling on a working
calendar, resource assignments with a histogram and levelling, cost and earned value with an S-curve, configured
columns and custom fields, a portfolio timeline look with a Year zoom, undo and redo, search and filters, drag and
keyboard rescheduling written back to the objects, and PNG, CSV, Excel and MS Project export and import. The internal
builds that led up to it are listed below; their version numbers were never released.

The widget's own code is licensed under Apache-2.0. The only bundled third-party package is `classnames` (MIT); see
THIRD-PARTY-LICENSES.md.

## Development history (internal builds before 1.0.0)

### Internal build 1.3.0 (2026-11-04)

A portfolio timeline: a multi-year view of many projects with their baseline, forecast and business need. Every new
property is optional and off by default, so pages look the same after Update widget. No new dependency.

#### Added

-   **Year** zoom level (toolbar, Ctrl + wheel, Fit and the Zoom property): years with decades above them, about 130
    pixels a year.
-   **Code** and **Second line** (Tasks): a short code before the name (such as 01.01) and a smaller line under it (such
    as the project manager and grade). Rows with a second line are at least 52 pixels high. Both are searched.
-   **Status** and **Status colours** (Structure): an Enumeration, String or Boolean attribute; each listed value gives
    the bar its colour (the finished part in the colour, the rest in a lighter tint) and, with a legend text, a line in
    the legend. Status colours come before the Colour attribute.
-   **Bar label**: Name and progress (as before), Finish and progress (such as 05.2027 · 45 %, with **Bar label date
    format** dd, MM, MMM, MMMM, yy, yyyy), Custom (**Bar label text**) or None. The label starts after the bar and
    after a baseline frame or deadline diamond behind it.
-   **Baseline style** Dashed outline: a dashed frame around the baseline dates, so a late task sticks out of it.
-   **Deadline style** Diamond: a diamond on the row, such as a business need date (the red missed-deadline outline and
    warning are left out, the diamond shows it).
-   **Today line style** Dashed with label: a dashed line with the Today text in the header.
-   **Look** Portfolio: slim bars in tall rows, group headings in capitals without summary bars, no colour swatches in
    the list, quieter bar labels.
-   **Bar legend**: progress, remaining, baseline and deadline (texts Legend progress, Legend remaining, Legend baseline
    and Legend deadline, in the style the bars use) and the Status colours that have a legend text.
-   Studio Pro hides the settings that do not apply (Status colours without Status, Bar label text unless Custom, the
    date format unless Finish and progress, the deadline, baseline and today styles without their attributes) and
    warns about Custom without a text, Status without colours and colours without a value or colour.
-   New CSS custom properties `--mxgantt-code`, `--mxgantt-need` and `--mxgantt-baseline-frame`; classes
    `.mxgantt--portfolio`, `.mxgantt--two-line`, `.mxgantt-code`, `.mxgantt-subtitle`, `.is-outline`, `.is-diamond`.

#### Changed

-   Fit picks Year when a plan is too long for the quarter zoom.

### Internal build 1.2.0 (2026-11-04)

Configured task list columns. Task name stays mandatory and always first; the developer lists any number of columns
after it. Every new property is optional: while the new **Columns** list is empty the chart shows the same columns as
1.1, so pages look and behave the same after Update widget. No new dependency.

#### Added

-   **Columns** (Task list tab): built-in columns (WBS number, Start, End, Duration, Done, Assigned to, Resources,
    Predecessors, Baseline start, Baseline end, Variance, and each cost and earned value measure) and attribute columns
    (String, Integer, Long, Decimal, Auto number, Boolean, Date and time, Enumeration), shown in the order of the list.
    A WBS number column sits right before Task name.
-   Per column: caption, header tooltip, format (Mendix, number, currency, percent, date, date and time, with decimals),
    width, minimum width, fill free space, alignment, wrap text, dynamic cell class (an expression per task), group and
    project totals (sum, average, lowest, highest, count), shown at first, users can hide, sortable and editable.
-   Sorting: a click on a sortable header (or Enter on it) sorts ascending, descending, then back to the data source
    order, within groups, empty values last, announced to screen readers and marked with `aria-sort`; kept with
    Remember view. **Sortable task name** for the Task header.
-   Inline editing of attribute columns: number, date and text inputs, and a list of the values for Enumeration and
    Boolean attributes; whole numbers only for Integer and Long; negative numbers allowed. Saved through the existing
    write path (commit or change only, On task changed, rollback and Retry, undo and redo, what-if scenarios).
    Optional **Attribute name** for the Mendix client write.
-   Studio Pro: the design preview and a new structure-mode preview show Task name and the configured columns with
    `[Attribute]` placeholders, sort marks and faded hidden columns, and each column can be selected in structure
    mode. Settings that do not apply to a column's kind are hidden; checks report duplicated built-in columns, missing
    attributes, captions, widths, decimals and columns users can never show. Plain string operations only (Jint).
-   Seven translatable texts (sorting announcements, the numbered column caption and three edit messages).
-   Tests: 50 new jest tests (301 in total) and a browser suite `harness/test-layout.mjs` (45 checks, screenshots at
    1600 and 1024 px in light and dark in `harness/dist/shots/layout/`); the harness has a `?layout=1` plan.

#### Changed

-   Task name is now always the first column (after WBS): dragging another column in front of it puts that column right
    after it. Columns that cannot be hidden are locked in the Columns panel and have no Hide in their header menu.
-   The header menu button lies over the right edge of the header on hover instead of taking room, so narrow columns
    keep their title.
-   Remember view also keeps the sort and which configured columns existed, so columns added later start the way the
    developer set them.
-   A single click on an editable task list cell no longer runs **On task click** (the click starts a double-click
    edit); clicks on other cells and on bars still do. With configured columns Task name keeps at least 180 px.
-   A cell with a Dynamic cell class takes its text colour from that class (such as Atlas `text-danger`).

#### Fixed

-   The keys in the keyboard shortcut list were unreadable in Bootstrap and Atlas themes (white `kbd` text).

### Internal build 1.1.0 (2026-10-31)

Custom fields. The widget was renumbered 1.0.0 for its Marketplace release (the same code as 2.3.1); this is the first
minor release on that line. Every new property is optional and off by default, so pages look and behave the same after
Update widget. Written from scratch, no new dependency.

#### Added

-   **Custom fields** (General > Custom fields): users add task list columns in the running app with the **+** at the end
    of the header: name, ten types with icons (text, number as plain / currency / percent, date, single and
    multi-select with coloured choices, checkbox, person with avatar, link, rating, formula), type options and a live
    preview. Definitions live as JSON in a String attribute of the data view object (**Fields**), values as JSON in a
    String attribute of each task (**Task values**); the README documents both. Also **Users can manage fields** (an
    expression), **On fields changed**, **On field values changed**, **Most fields**, **First-time hint** and **Task values
    attribute name**.
-   Inline editing of custom field values with the keyboard (typed values, a searchable choice list, one-click checkboxes
    and stars), written through the existing save path (commit or change only, rollback and Retry on failure, undo,
    what-if scenarios). Values can be edited whenever the task is editable, also without **Edit in task list**.
-   Header menu per custom field: edit (rename, change the type with a preview of how many values convert or are cleared,
    then one batch conversion), show on bars, show in tooltip, hide, delete with confirmation (the values stay on the
    tasks and come back with a field of the same name).
-   **Columns panel**, replacing the plain column menu whenever Column chooser or Custom fields is on: every column with
    a checkbox, search, drag (or Alt + arrows) to reorder, Show all, Reset and Add field. Column headers can be dragged
    too, and the + stays at the right edge of the header. The column order is kept with **Remember view**.
-   Custom field values in the bar tooltip and the accessible bar labels, as chips on the bars, in the search, as a
    field filter, and in the CSV, Excel (typed cells) and print / image exports.
-   Studio Pro: a sample custom field column in the design preview; the custom field properties are hidden while the
    feature is off; checks for missing attributes and a missing save action (no regular expressions, safe for Jint).
-   106 translatable texts in a new Custom fields group.
-   Tests: 38 new jest tests (251 in total) for the field model, JSON parsing, conversions, formulas, filters, column
    order, persistence, editorConfig and the UI; a new browser suite `harness/test-fields.mjs` (36 checks, screenshots
    at 1600 and 1024 px in light and dark in `harness/dist/shots/fields/`).

#### Changed

-   Header titles of custom fields are cut with an ellipsis (full name in the tooltip); the built-in headers are unchanged.

### Internal build 2.3.1 (2026-10-17)

#### Fixed

-   **Status date** stays visible in Studio Pro when **Earned value** or **Cost columns** is on (it was only shown with
    the status line or Behind schedule, so update-widgets cleared it although earned value is measured at that date).

### Internal build 2.3.0 (2026-10-17)

No property, enumeration key or action was removed or renamed and no default changed. Every new option is off by
default and the new attributes are optional, so pages built with 2.2 look and behave the same after Update widget.
Benchmarks were the Bryntum-based Ultimate Gantt, Gantt Chart Pro, MS Project and DHTMLX Gantt PRO (see
COMPETITIVE.md); everything is written from scratch, no new dependency.

#### Added

-   Resources: **Assignments** (`Ann:50, Bob`) with units per task, an optional **Resources** data source (name, **Max
    units (%)**, **Cost rate per hour**), an editable Resources column, and the **Resource usage panel**: load as a
    share of each resource's maximum per day or busiest day per week, over-allocation in red on the panel and as a
    dotted underline on the task bars, tooltip lines, click a resource to highlight its tasks.
-   **Resource levelling**: delays tasks (never splits or shortens them) until no resource is over-allocated - tasks
    with total float first, **Priority** 0-1000 respected (1000 never moves), started, read-only and "must" tasks
    stay, successors follow. Previewed on the chart with a summary (moved, new finish, beyond float, unresolved),
    applied as one change and one undo step.
-   Named baselines: **Baselines (JSON)** holds up to ten per task. A Baselines panel shows one (Baseline shown sets
    the first), compares two (twin bars, start / finish / cost variance table) and saves or deletes them (**Save
    baselines**). Baseline start / end keep working as "Baseline (attributes)".
-   Split tasks: **Segments** (`0-2, 4-7`). Split task and Join segments in the task menu, drag a segment, Alt + Left /
    Right moves the last one; moves keep segments, resizes keep them in place; workload, levelling and cost count only
    the work.
-   Constraints: **Constraint type** (ASAP, ALAP, SNET, SNLT, FNET, FNLT, MSO, MFO in short, long or numeric form) and
    **Constraint date**, a lock indicator (red when broken), tooltip and screen reader text. Auto-scheduling honours
    them; the **Schedule plan button** runs a full forward pass with links, lags, calendar and constraints plus an
    as-late-as-possible backward pass, previewed and applied as one undo step.
-   Cost and earned value: **Fixed cost**, **Actual cost**, **Hours per working day**, **Currency**; the **Earned value
    panel** with BAC, PV, EV, AC, CV, SV, CPI, SPI, EAC, ETC, VAC and an SVG S-curve (crosshair tooltip by pointer or
    arrow keys, a table of the numbers, validated colour-blind-safe series in light and dark); **Cost columns** in the
    task list with group and project totals.
-   MS Project XML import: **On import** + **Import: JSON** - the file is read in the browser (no external entities, size
    and task limits), previewed and handed to a microflow as documented JSON (tasks, outline, links with lags, calendar,
    resources, assignments, all baselines, constraints, deadlines, priorities, fixed costs). The export now also writes
    units, resource maximums and rates, constraints, deadlines, priorities, fixed costs and every named baseline; export
    and import are round-trip tested.
-   Portfolio: **Project** (a text template, so it can follow an association) gives collapsible project summary rows,
    per-project WBS numbers and key lookup, dashed cross-project links, and the **Portfolio summary** health table.
-   Reliability: a failed commit is rolled back in the client and shown in a banner with Retry and Dismiss (no silent
    loss); slow saves show "Saving…"; every panel has its own error boundary; the time axis stays left to right in RTL
    apps and mixed text uses its own direction; memoised panels keep scrolling smooth.
-   **Assignments / Segments / Baselines attribute name** properties for attributes whose names do not say what they are.
-   148 translatable texts in eight new groups; `npm run sbom` (CycloneDX 1.5 SBOM in `dist/2.3.0/`) and
    `npm run generate:typings`.
-   Tests: 57 new unit and component tests (210 in total, was 153), a new browser suite `harness/test-v23.mjs` (52
    checks: every feature, save failures, contrast in both themes, focus order, 200% zoom, RTL, 5,000-task performance,
    a 30-cycle mount / unmount memory check) next to the 33 checks of 2.2.

#### Changed

-   The MS Project export keeps writing Start No Earlier Than for tasks without a constraint, but uses the task's own
    constraint when one is set, and writes Units from Assignments (1 for everyone in Assigned to, as before).
-   The harness builds a production bundle as well (`index.html?prod=1`) for performance measurements.

#### Fixed

-   Long text in right-to-left pages (dates, negative amounts) no longer reorders; the toolbar's end group uses logical
    margins.

#### Performance (5,000 tasks, 50 resources, two years, working calendar)

Chrome 154, production React (`harness/test-v23.mjs`): first render including page load 2.2 s; a vertical scroll step
(two animation frames) median 36 ms, 95th percentile 47 ms; Level resources proposal 0.23 s; Schedule plan 0.15 s;
reading and previewing a 5,000-task MS Project file 1.8 s; 30 mount / unmount cycles grow the heap by 0.3 MB (no
leak). Jest in jsdom (busy machine, three runs): links + critical path 0.1-0.5 s, auto-schedule push 23-160 ms, resource
usage 0.2-0.5 s, levelling 0.4-2.7 s, Schedule plan 0.05-0.14 s, project earned value 0.13-0.47 s, S-curve 0.19-0.6 s,
MSPDI export 0.4-1.1 s, MSPDI import 2.8-7 s (jsdom's XML parser; 1.8 s in Chrome), first render with every 2.3 panel
1.4-3 s, re-render after a change 0.7-1.3 s.

#### Upgrading

Update widget in Studio Pro. To use the new features add the attributes you need to the task entity (String,
unlimited length for Assignments, Segments and Baselines; String or Enumeration for Constraint type; DateTime for
Constraint date; Integer for Priority; Decimal for Fixed cost / Actual cost), optionally a Resource entity, and switch
the panels on. For import, add a String (unlimited) attribute to the page's data view object and an import microflow.

#### Known limitations

-   One working calendar for the whole plan: no resource or task calendars, no working hours within a day.
-   Levelling is a heuristic (serial schedule generation, minimum-float rule), works in whole days and only delays;
    it does not split tasks or change units, and it is not guaranteed optimal.
-   No effort-driven scheduling: changing units does not change durations.
-   Earned value has no stored progress history, so EV and AC before the status date are reconstructed from the current
    schedule (exact at the status date).
-   MS Project baseline names are not part of MSPDI: named baselines export as Baseline 1-10 and import as "Baseline",
    "Baseline 1"...; split segments are not exported or imported (MSPDI keeps them in timephased data); percent lags
    are dropped on import; links to summary tasks are skipped.
-   A portfolio export re-imports groups that sit outside a project as projects (MSPDI has only one kind of summary).
-   Cross-browser: only Chrome was run (Playwright browsers are not installed here).
-   The jsdom render budget tests are generous because the shared build machine is slow; the Chrome numbers above are
    the reference.

### Internal build 2.2.0 (2026-10-09)

No property, enumeration key or action was removed or renamed and no default changed. Every new option is off by
default; the new Motion property defaults to Full, which is the 2.1 behaviour with Animations on.

#### Added

-   Deadlines (`deadlineAttr`): a flag on the row at the deadline, bars that end later outlined in red with a warning
    beside the name, and Deadline plus "Misses its deadline by N days" (working days with a calendar) in the tooltip.
-   Total float (`showSlack`): a dotted tail from each bar to its latest finish and a Total float tooltip line. It uses
    the same backward pass as the critical path (now shared as `backwardPass`), so all link types, lags and the working
    calendar count.
-   Progress line (`progressLine`): the zig-zag from the status date through each task's progress point, drawn in on
    load.
-   Timeline markers (`markers`: `markerDate`, `markerLabel`, `markerColor`): labelled flags in the header and lines
    through the chart for go-lives, freezes and audits; a design-time warning for colours that are not CSS colours.
-   Zoom to fit (`zoomToFit`): a Fit toolbar button and the F key pick the most detailed zoom that shows the whole plan
    and scroll to its start, with the usual smooth zoom.
-   Project health (`showHealth`): a region under the toolbar with duration-weighted complete against planned at the
    status date, the schedule performance index (SPI, coloured green / amber / red), the forecast finish against the
    latest baseline end, and the numbers of tasks behind schedule, on the critical path and with missed deadlines.
    Count-up animation; a plain sentence for screen readers.
-   Motion (`motion`: full / subtle / off) on top of Animations; subtle replaces growing bars and drawing arrows with
    fades. A skeleton timeline while the first tasks load, and an illustrated empty state with an Add task button when
    there are none.
-   Legend entries for total float, the progress line and deadlines.
-   26 translatable texts in the new group Planning aids and health.
-   A browser harness (`npm run harness`, 33 checks), component and unit tests for every 2.2 feature, `COMPETITIVE.md`,
    `THIRD-PARTY-LICENSES.md` and `npm run licenses` (only MIT and Apache-2.0 code is shipped).

#### Changed

-   TypeScript helpers are inlined (`importHelpers: false`), so no tslib code can end up in the bundle.

### Internal build 2.1.0 (2026-10-07)

Every new option except Animations is off by default. Animations is on, so existing pages get the intro, smooth zoom and
hover highlights after Update widget; switch it off for the 2.0 look. Nothing about editing or saving changes.

#### Added

-   Export to Excel (Excel export): an .xlsx workbook of the task list as shown, with groups as bold summary rows and
    their tasks indented and outlined under them (foldable in Excel), WBS numbers, keys, real dates and numbers,
    duration in (working) days, progress as a percentage, predecessors, assignees, baseline start and end and the
    variance in days, a frozen header row and filters. Written by a small built-in xlsx and zip writer, so no new
    dependency.
-   Export to MS Project (MS Project export): Microsoft Project XML (MSPDI) that Microsoft Project and ProjectLibre
    open, with a calendar matching Working days and Holidays, groups as summary tasks, WBS and outline numbers,
    predecessor links with their type (FS, SS, FF, SF) and lag (days, weeks or elapsed hours), Start No Earlier Than
    constraints so the planned dates are kept, progress, baselines, and one resource per person in Assigned to with
    their assignments.
-   What-if scenarios (What-if scenarios): a Plan a scenario toggle. While it is on, drags, resizes, keyboard moves,
    edits in the task list and auto-scheduling only change a copy inside the widget; changed bars are outlined and a bar
    under the toolbar gives the new end date against the current one and how many tasks moved. Apply writes every change
    in one batch through the normal save path (Save changes and On task changed as usual, one undo step); Discard throws
    them away. Undo and redo work inside the scenario. Adding and deleting tasks is paused while a scenario is open.
-   Status date: a dashed Status date line, and Highlight behind schedule, which colours the bars of tasks whose
    progress is below the share of their working time before the status date. A legend under the chart names the colours
    and counts the tasks behind; the tooltip and screen reader label give done against expected. The Status date
    expression defaults to the start of today. Printed charts include the line, the colour and the legend entries.
-   Animations (on by default): zoom changes scale smoothly around the pointer or the middle of the view, bars grow in
    and dependency arrows draw in when the chart first shows tasks, hovering a task highlights its whole dependency
    chain and dims the rest, and Today scrolls smoothly. Always off when the operating system asks for reduced motion.
-   30 new translatable texts, and the colour properties `--mxgantt-behind`, `--mxgantt-status` and
    `--mxgantt-scenario`.

#### Changed

-   The File name property now also names the CSV, Excel and MS Project files.

### Internal build 2.0.1 (2026-09-26)

#### Fixed

-   Theme Automatic now follows the page the widget sits on instead of the operating system: the nearest mostly opaque
    background around the widget (then body and html) decides, with the `mx-theme-dark` class and `data-theme="dark"`
    still forcing dark. The operating system setting is only used when no background is set anywhere, so a light app on
    a PC in Windows dark mode no longer gets a dark chart. The theme is settled before the first paint and re-checked
    when the OS setting or the class, style or data-theme of html or body changes.
-   Text contrast of filled badges and bars (conflict "!", overload badge, workload bar numbers, validation messages and
    the danger button) now meets 4.5:1 in both themes: darker fills with white text in light, dark text on the bright
    fills in dark. New custom properties `--mxgantt-danger-fill` and `--mxgantt-on-fill`; the light `--mxgantt-load`
    default is now `#3565d6`.

### Internal build 2.0.0 (2026-09-26)

Every new option is off by default, so existing pages look and behave exactly as before after Update widget.

#### Added

-   Baselines: Baseline start and Baseline end attributes draw a thin bar under each task. The tooltip and the bar label
    give the variance (days late or early, in working days with a calendar), and an optional Variance column shows it
    signed.
-   Dependency types and lags in the Depends on attribute: `3` (finish to start, as before), `5SS`, `7FF+2d`, `9SF-1d`,
    `4FS+3h`, `8SS+1w`. Arrows leave and enter the right ends for each type, conflicts are detected per type (and named
    in the tooltip), and the critical path follows all four types with their lags.
-   Dependency editing: drag from the dot at the end of a bar onto another bar, or press L and then Enter on the other
    task; remove dependencies from the task menu (right-click, the context menu key or Shift+F10). Writes the Depends on
    attribute; an optional Depends on attribute name covers plans where no task has a dependency yet.
-   Auto-scheduling (None / Off / On with a toolbar toggle): when a task moves later its successors are pushed so no
    link is broken, respecting types, lags and working days. The pushed tasks are previewed while dragging and saved
    with the moved task in one commit.
-   Working calendar: Working days (such as 1-5 or Mon-Thu, Sat) and a Holidays text template of yyyy-mm-dd dates and
    ranges. Durations and lags count working days, non-working days are shaded, and Skip non-working days keeps dragged
    and nudged tasks off them while keeping their working duration.
-   Undo and redo for every change (toolbar, Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z), including auto-scheduled batches.
-   Editing in the task list: name (with the new Name attribute), start, end, duration (working days), progress and
    predecessors, by double-click or F2, with Tab to the next cell, validation messages and Escape to cancel.
-   On add task (toolbar button and Insert) writes a suggested start and end to attributes of the data view object
    first; On delete task (toolbar, task menu and Delete) asks for confirmation.
-   Task list columns: extra columns from an attribute or a text template with caption, width and alignment, a WBS
    column (1, 1.1, 1.2), Assigned to, Baseline start and end, Variance and Predecessors, a column chooser, resizable
    columns (mouse and keyboard), and horizontal scrolling when the columns are wider than the list.
-   Resources: an Assigned to attribute (several people separated by commas), a resource workload histogram under the
    chart (per day at day zoom, busiest day per week otherwise, over-allocation in red, a capacity line and a screen
    reader summary per person), and bar colours by assignee with the colours in the print legend.
-   Search and filters: a search box (name, group, assignee, key, WBS number and extra columns) and Critical only, Late
    only and My tasks toggles; the timeline scrolls to the first match.
-   Remember view: collapsed groups, shown columns and column widths are kept per user in the browser.
-   Load at most: loads the first N tasks with a Load more button, through the data source limit.
-   Export CSV (Excel-friendly: UTF-8 with BOM, ISO dates, plain numbers, formula-safe cells) of the task list as shown,
    and Print title and legend: printed charts get a title, the date range and a legend on landscape pages.
-   Keyboard shortcut list on ? (and a toolbar button when any 2.0 feature is on).
-   96 new translatable texts for all of the above.

#### Changed

-   Writes are batched: several tasks are fetched once and committed in one call. Attribute detection samples more
    objects and, when two attributes hold the same values (a freshly baselined plan), prefers the one whose name fits
    and is not a baseline or planned copy.
-   The critical path is calculated in linear time, so 5,000 tasks with a working calendar take milliseconds.

### Internal build 1.0.0 (2026-09-26)

#### Added

-   Gantt chart over a list data source: task list (name, start, end, duration, % done) next to a timeline with day,
    week, month and quarter zoom (toolbar buttons and Ctrl + mouse wheel), month/year and day/week/month/quarter header
    scales, today line, weekend shading and a Today button.
-   Collapsible groups from a String or Enumeration attribute, with duration-weighted summary bars; Expand all /
    Collapse all.
-   Milestones from a Boolean attribute or a zero-length task, drawn as diamonds.
-   Finish-to-start dependency arrows from a Key and a comma-separated Depends on attribute; conflicts (a successor
    starting before its predecessor ends) are flagged on the bar, the arrow and in the tooltip. Optional critical path
    highlight.
-   Rescheduling by dragging a bar (move), its ends (resize) or its progress handle, snapping to days or hours. Values
    are written through the Mendix client API, optionally committed, then On task changed runs. On task click runs on
    click or Enter.
-   Keyboard: roving focus over the bars, Up/Down/Home/End to move between tasks, Left/Right and Page Up/Down to move,
    Shift + arrows to resize, + and - for progress, Enter to open, Escape to cancel; changes are announced to screen
    readers.
-   Resizable task list, scroll-synchronised panes, row virtualisation for large plans.
-   Save as PNG and Print.
-   Light and dark theme (automatic, light or dark), CSS custom properties for colours, and translatable texts for
    everything the widget shows.
