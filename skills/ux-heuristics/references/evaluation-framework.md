# UX Heuristic Evaluation Framework

This reference combines Nielsen's 10 Usability Heuristics and the Laws of UX into a structured evaluation framework for reviewing UI designs and implementations.

---

## Part 1: Nielsen's 10 Usability Heuristics

### H1: Visibility of System Status

**Principle:** The design should always keep users informed about what is going on, through appropriate feedback within a reasonable amount of time.

**What to evaluate:**
- Loading states: Are progress indicators shown for operations >400ms?
- Action feedback: Do buttons/controls show visual confirmation when activated (color change, checkmark, animation)?
- State changes: Are external or time-based state changes explained (e.g., "Item no longer available")?
- Real-time feedback: Does drag-and-drop, reordering, or direct manipulation show immediate visual response?
- Voice/non-visual: Do voice-only or non-visual interfaces indicate listening/processing state?
- Scarcity/urgency: Is relevant backend status surfaced when it affects user decisions (low stock, shipping thresholds)?

**Common violations:**
- No loading indicator during async operations
- Form submissions with no success/failure feedback
- Items disappearing from lists without explanation
- File uploads with no progress bar
- Toggle switches with no confirmation of state change
- Disabled buttons with no explanation of why they're disabled

**Severity guidance:** Critical when users can't tell if an action succeeded or the system is responding.

---

### H2: Match Between System and the Real World

**Principle:** The design should speak the users' language. Use words, phrases, and concepts familiar to the user, rather than internal jargon. Follow real-world conventions, making information appear in a natural and logical order.

**What to evaluate:**
- Language: Is copy written in the user's vocabulary, not developer/business jargon?
- Acronyms: Are abbreviations spelled out on first use with context for why they matter?
- Mental models: Do UI metaphors match real-world objects users already understand?
- Natural mapping: Do spatial layouts follow cultural conventions (e.g., "more" = up, volume increase above decrease)?
- Information order: Is content presented in the sequence users expect from the task's real-world equivalent?
- Skeuomorphism: When used, do physical-object metaphors actually aid comprehension or do they confuse?

**Common violations:**
- Error messages with HTTP status codes or stack traces shown to end users
- Internal field names exposed in the UI ("user_id", "org_slug")
- Navigation labels using company-internal terminology
- Controls that don't match their real-world counterparts (e.g., toggle that looks like a button)
- Data sorted by database order rather than logical user order

**Severity guidance:** Major when jargon prevents task completion; Minor when language is merely unclear but tasks remain possible.

---

### H3: User Control and Freedom

**Principle:** Users often perform actions by mistake. They need a clearly marked "emergency exit" to leave the unwanted action without having to go through an extended process.

**What to evaluate:**
- Undo/Redo: Can users reverse actions? Are undo controls visible and discoverable?
- Back navigation: Does the browser Back button work as expected? Can users navigate backwards in multi-step flows without losing data?
- Cancel: Is there a clear, discoverable Cancel option in modals, forms, and multi-step processes?
- Close: Are close/dismiss controls in expected positions (top-right for overlays)?
- Draft saving: When users cancel mid-task, is their work preserved or offered to be saved?
- Destructive actions: Do irreversible actions require confirmation?
- Exit clarity: Is it always clear what X/Close/Cancel will do (dismiss vs. delete vs. save)?

**Common violations:**
- No way to undo a deletion
- Multi-step wizard with no back navigation
- Modal with close button in unexpected position (bottom-left, outside modal)
- Browser Back button breaks the application or causes data loss
- X icon ambiguous between "close" and "cancel entirely"
- Snackbar with undo that disappears too quickly (<5 seconds)
- No confirmation before destructive actions (delete account, remove all items)

**Severity guidance:** Critical when users lose work or can't escape unwanted states.

---

### H4: Consistency and Standards

**Principle:** Users should not have to wonder whether different words, situations, or actions mean the same thing. Follow platform and industry conventions.

**What to evaluate:**

**Internal consistency:**
- Visual: Same icons, colors, and styling for the same functions across all pages
- Layout: Consistent placement of navigation, actions, forms across pages
- Language: Same terms used for same concepts throughout (not "delete" in one place and "remove" in another)
- Behavior: Same components behave identically everywhere (menus, modals, dropdowns)
- Data entry: Consistent input formats and validation patterns

**External consistency:**
- Platform conventions: Does the UI follow OS/platform patterns (e.g., mobile nav bars, swipe gestures)?
- Industry conventions: Logo top-left, search with magnifying glass, cart icon for e-commerce, blue underlined links
- Standard controls: Are checkboxes, radio buttons, toggles used for their conventional purposes?

**Design system consistency:**
- Are design system components used correctly per their documented purpose?
- Is tone of voice consistent across all content including error states?

**Common violations:**
- Different words for the same action across pages ("Save" vs "Submit" vs "Apply")
- Inconsistent button placement (primary action left on some pages, right on others)
- Menu/hamburger opens differently on different pages (modal vs slide-in)
- Tone shift between marketing copy and error messages
- Form validation that works differently across forms

**Severity guidance:** Major when inconsistency causes confusion about how to complete a task.

---

### H5: Error Prevention

**Principle:** Good error messages are important, but the best designs carefully prevent problems from occurring in the first place.

**What to evaluate:**

**Slip prevention (autopilot errors):**
- Constraints: Are inputs limited to valid options where possible (date pickers, dropdowns, sliders)?
- Suggestions: Does search offer autocomplete/suggestions to prevent typos?
- Good defaults: Are reasonable starting values pre-filled for repetitive or precision tasks?
- Forgiving formatting: Does the system accept flexible input formats and auto-format (phone numbers, dates, currency)?
- Confirmation: Do high-stakes actions (send payment, delete data, publish) require explicit confirmation?

**Mistake prevention (mental model errors):**
- Guard rails: Are impossible or illogical selections prevented (return date before departure)?
- Inline validation: Do forms validate in real-time rather than only on submit?
- Contextual help: Is guidance provided at the point of potential confusion?
- Progressive disclosure: Are complex features revealed gradually to prevent overwhelm?

**Common violations:**
- Free-text input where a constrained picker would work (typing dates instead of date picker)
- No autocomplete on search, especially on mobile where typing is error-prone
- Allowing users to select contradictory options
- No confirmation before sending/publishing/deleting
- Forms that only validate on submit, wasting user effort
- No character counter on length-limited fields

**Severity guidance:** Critical for errors with financial, data-loss, or privacy consequences. Major for workflow-disrupting errors.

---

### H6: Recognition Rather Than Recall

**Principle:** Minimize the user's memory load by making elements, actions, and options visible. Users should not have to remember information from one part of the interface to another.

**What to evaluate:**
- Visibility: Are available actions visible rather than hidden behind memorized commands or gestures?
- Context preservation: When users navigate between screens, is relevant context carried forward (selected filters, comparison data)?
- History: Are recently viewed items, past searches, or previous selections accessible?
- Labels: Do all icons have text labels, or are tooltips provided? Are icon meanings obvious without labels?
- Navigation: Can users see where they are (breadcrumbs, active states) and where they can go?
- Favorites/recents: Can users save and quickly access frequently-used items?
- Progressive disclosure: Is complex information revealed contextually rather than in upfront tutorials?

**Common violations:**
- Icon-only toolbars with no labels or tooltips
- Multi-step processes where you can't see previous selections
- Search with no recent/saved searches
- Forms requiring users to remember information from a previous screen
- Gestural interfaces (swipe, shake) with no visible indicators
- Long onboarding tutorials that users must memorize before using the app

**Severity guidance:** Major when users must recall information to complete core tasks.

---

### H7: Flexibility and Efficiency of Use

**Principle:** Shortcuts — hidden from novice users — may speed up the interaction for the expert user so that the design can cater to both inexperienced and experienced users.

**What to evaluate:**
- Accelerators: Are keyboard shortcuts available for frequent actions? Are they discoverable (shown in menus/tooltips)?
- Bulk actions: Can users perform operations on multiple items at once (select all, bulk edit, bulk delete)?
- Customization: Can users configure their workspace, dashboard, or frequently-used tools?
- Personalization: Does the system adapt to user behavior (remembering sort preferences, last-used settings)?
- Multiple paths: Can the same task be accomplished through different methods suited to different expertise levels?
- Macros/automation: Can repetitive sequences be automated?

**Common violations:**
- No keyboard shortcuts for common actions
- No way to select/act on multiple items simultaneously
- Expert features that are visible and confusing to beginners
- Wizard-only flows with no way to skip steps for experienced users
- No way to save or reuse common configurations
- Identical functionality duplicated in too many UI locations

**Severity guidance:** Minor for missing accelerators in simple apps. Major for power-user tools lacking efficiency features.

---

### H8: Aesthetic and Minimalist Design

**Principle:** Interfaces should not contain information that is irrelevant or rarely needed. Every extra unit of information competes with relevant information and diminishes its relative visibility.

**What to evaluate:**

**Signal-to-noise ratio:**
- Is every visible element contributing to the user's current task or goal?
- Are rarely-needed features hidden behind progressive disclosure?
- Is content hierarchy clear (visual weight guides the eye to what matters most)?
- Are decorative elements adding brand value or just noise?

**Visual communication:**
- Is visual hierarchy (scale, contrast, whitespace) used effectively to guide attention?
- Does negative space serve a purpose (breathing room, grouping)?
- Are Gestalt principles applied correctly (proximity, similarity, common region)?

**Content quality:**
- Is copy concise and scannable?
- Are labels high in information scent (clear about what they lead to)?
- Is technical jargon avoided in user-facing content?

**Common violations:**
- Dashboard showing all possible metrics when user needs only 3-4
- Marketing content mixed into task-oriented interfaces
- Excessive visual decoration that doesn't aid comprehension
- Too many competing calls-to-action on one screen
- Overly sparse design that removes necessary information
- Multiple font sizes, weights, and colors without clear hierarchy purpose

**Severity guidance:** Major when noise prevents users from finding critical information. Minor for purely aesthetic clutter.

---

### H9: Help Users Recognize, Diagnose, and Recover from Errors

**Principle:** Error messages should be expressed in plain language (no error codes), precisely indicate the problem, and constructively suggest a solution.

**What to evaluate:**

**Visibility:**
- Are errors displayed adjacent to the source of the problem?
- Do error indicators use redundant cues (color + icon + text), not color alone?
- Is error styling bold, high-contrast, and immediately noticeable?
- Are progress-blocking errors shown in modals vs. informational errors in toasts/banners?
- Are errors timed appropriately (not shown prematurely during exploratory interactions)?

**Communication:**
- Is the error message in plain, human language (no error codes, no jargon)?
- Does the message precisely describe what went wrong (not generic "An error occurred")?
- Does it constructively suggest what the user should do next?
- Is tone positive and non-blaming (avoiding "invalid", "illegal", "you failed")?
- Is humor avoided (becomes stale with repeated errors)?

**Recovery:**
- Is user input preserved so they can edit rather than re-enter?
- For guessable corrections, does the system offer a clickable fix?
- For catastrophic errors, is the experience handled gracefully (friendly error page, apology)?
- Can users easily retry or take an alternative path?

**Common violations:**
- "Error 500" or "Something went wrong" with no guidance
- Error message far from the field that caused it
- Red color as sole error indicator (inaccessible to colorblind users)
- Errors that clear the form, forcing users to start over
- Premature validation (showing errors before user finishes typing)
- No suggested fix when the system could infer the correct action
- Error messages with puns or jokes instead of clear communication

**Severity guidance:** Critical when errors prevent task completion and offer no recovery path.

---

### H10: Help and Documentation

**Principle:** Even though it is better if the system can be used without documentation, it may be necessary to provide help and documentation. Such information should be easy to search, focused on the user's task, list concrete steps, and not be too large.

**What to evaluate:**

**Proactive help (before problems occur):**
- Onboarding: Are new users guided contextually rather than with a wall of tutorial screens?
- Tooltips: Is complex functionality explained at the point of interaction?
- Templates: Are starting templates offered for common tasks?
- Pull vs. push: Is help triggered by user context (pull) rather than random interruptions (push)?
- Dismissability: Can experienced users skip/dismiss onboarding easily?
- Later access: Can dismissed help materials be found again later?

**Reactive help (when users seek it):**
- Searchable: Can users search help documentation effectively?
- Scannable: Is help content structured with headings, lists, and numbered steps (not walls of text)?
- Contextual: Does the help system know what page/feature the user is on?
- Comprehensive: Does documentation go beyond the obvious and cover edge cases?
- Multimedia: Are videos/images supplemented with text alternatives?
- Categorized: Is help organized logically, with frequently-accessed topics highlighted?

**Common violations:**
- Tutorial overlays that highlight every UI element indiscriminately
- Help docs with undefined technical terms
- No search in the help/support section
- Video-only tutorials with no text alternative
- Onboarding that can't be skipped or re-accessed later
- Help content in paragraph form instead of scannable steps
- Contextual tips for features that are already self-evident

**Severity guidance:** Major when users can't find help for non-obvious features. Minor when documentation exists but is poorly organized.

---

## Part 2: Laws of UX

### Category A: Decision & Cognitive Load

#### Hick's Law
**Principle:** The time to make a decision increases with the number and complexity of choices.

**What to evaluate:**
- Are options minimized in time-sensitive contexts (checkout, search results, onboarding)?
- Are complex processes broken into manageable steps (wizard pattern)?
- Are preferred/recommended options visually emphasized?
- Is progressive onboarding used instead of presenting all features at once?

**Common violations:**
- Navigation with 15+ top-level items
- Settings page showing every option at once without grouping
- Onboarding that exposes all features simultaneously
- Dropdowns with 50+ ungrouped options

---

#### Choice Overload
**Principle:** People get overwhelmed when presented with a large number of options, reducing decision quality and satisfaction.

**What to evaluate:**
- Are comparison tools provided when users must evaluate similar options (pricing tiers, products)?
- Are filtering and search tools prominent to narrow choices upfront?
- Is a featured/recommended option highlighted?
- Is content prioritized by relevance at any given moment?

**Common violations:**
- Product listing with no filtering or sorting
- Pricing page with 6+ plans and no comparison matrix
- Form with too many optional fields presented at once

---

#### Cognitive Load
**Principle:** The mental effort required to understand and interact with an interface. Becomes problematic when it exceeds available mental capacity.

**What to evaluate:**
- **Intrinsic load:** Is goal-relevant information presented clearly without requiring external reference?
- **Extraneous load:** Are decorative or superfluous elements consuming mental resources without aiding comprehension?
- Is information chunked into digestible groups?
- Are complex interactions broken into sequential steps?

**Common violations:**
- Dense data tables with no visual grouping or hierarchy
- Forms requiring users to hold information in memory between steps
- Animations that distract from content rather than guiding attention

---

#### Miller's Law
**Principle:** The average person can keep 7 (plus or minus 2) items in working memory.

**What to evaluate:**
- Is content chunked into groups of ~5-9 items?
- Are navigation menus organized within working memory limits?
- Are long lists broken into meaningful categories?
- Note: Don't use "7 items" as a rigid design rule — the principle is about chunking, not a magic number.

**Common violations:**
- Phone numbers or account numbers displayed as unbroken strings of digits
- Navigation with too many ungrouped items at one level

---

#### Working Memory
**Principle:** A cognitive system that temporarily holds and manipulates information. Capacity: 4-7 chunks, each fading after 20-30 seconds.

**What to evaluate:**
- Is displayed information both necessary and relevant to the current task?
- Does the system support recognition over recall (e.g., visited link styling, breadcrumbs)?
- Are comparison tasks supported with side-by-side views rather than requiring memory?
- Is critical context carried across screens rather than requiring users to remember it?

**Common violations:**
- Product comparison requiring users to remember specs from separate pages
- Multi-step form with no summary of previous entries

---

#### Chunking
**Principle:** Breaking information into grouped, meaningful units to aid scanning and comprehension.

**What to evaluate:**
- Is content broken into visually distinct groups with clear hierarchy?
- Do groupings reveal underlying connections between items?
- Are long-form inputs (phone numbers, credit cards, dates) auto-formatted into chunks?

**Common violations:**
- Wall-of-text content with no headings or visual breaks
- Credit card number input as a single 16-digit field

---

### Category B: Interaction & Performance

#### Fitts's Law
**Principle:** The time to acquire a target is a function of the distance to and size of the target.

**What to evaluate:**
- Are primary action buttons large enough for easy targeting (minimum 44x44px touch targets)?
- Is there sufficient spacing between adjacent interactive elements?
- Are frequently-used actions positioned in easy-to-reach areas (thumb zones on mobile, screen edges on desktop)?
- Are destructive actions (delete) distanced from constructive actions (save)?

**Common violations:**
- Tiny close buttons or action icons (<32px)
- Touch targets too close together on mobile (adjacent links in a list)
- Primary actions placed far from where the user's cursor/finger naturally rests
- Important actions in hard-to-reach corners of large screens

---

#### Doherty Threshold
**Principle:** Productivity soars when computer-user interaction stays under 400ms response time.

**What to evaluate:**
- Does the system respond to user actions within 400ms?
- Are perceived-performance strategies used (skeleton screens, optimistic UI, animations during loading)?
- Do progress indicators appear for operations that exceed the threshold?
- Are strategic delays used to enhance perceived value when appropriate?

**Common violations:**
- Page transitions with no loading state
- Button clicks with no immediate visual feedback
- API calls that block the UI with no indicator
- Instant completions that feel "too easy" for important actions (no perceived processing)

---

#### Flow
**Principle:** The mental state of full immersion in a task — energized focus, involvement, and enjoyment.

**What to evaluate:**
- Is the challenge level matched to user skill (not too hard, not too easy)?
- Does the system provide clear feedback on actions and accomplishments?
- Are friction points and unnecessary obstacles removed?
- Is responsiveness fast enough to maintain immersion?
- Are interruptions (popups, notifications, tooltips) minimized during focused tasks?

**Common violations:**
- Popups or modals interrupting a focused workflow (e.g., newsletter signup during checkout)
- Slow transitions that break task momentum
- Confusing UI that repeatedly pulls users out of their task to figure out the interface

---

#### Parkinson's Law
**Principle:** Any task will inflate until all available time is spent.

**What to evaluate:**
- Are task completion timelines set to match user expectations?
- Are autofill, smart defaults, and pre-populated fields used to reduce effort?
- Does the design encourage efficient completion rather than providing excessive open-ended space?

**Common violations:**
- Unnecessarily long forms with no autofill support
- Open-ended text fields where structured input would suffice
- Multi-step processes with no sense of expected duration

---

### Category C: Visual Perception (Gestalt Principles)

#### Law of Proximity
**Principle:** Objects near each other are perceived as grouped together.

**What to evaluate:**
- Are related items closer together than unrelated items?
- Does spacing between groups clearly delineate separate sections?
- Are form labels positioned closer to their field than to adjacent fields?

**Common violations:**
- Form labels equidistant from two fields (ambiguous which field they belong to)
- Cards or list items with inconsistent spacing that creates false groupings
- Section headers that are closer to the previous section than to their own content

---

#### Law of Similarity
**Principle:** Similar-looking elements are perceived as related and sharing functionality.

**What to evaluate:**
- Do elements with the same function share consistent visual treatment (color, shape, size)?
- Are links visually differentiated from non-clickable text?
- Are interactive elements visually distinct from static content?
- Is the same visual treatment NOT applied to elements with different functions?

**Common violations:**
- Clickable text styled identically to non-clickable text
- Different button styles used for the same type of action
- Status indicators using the same color for different statuses

---

#### Law of Common Region
**Principle:** Elements sharing a clearly bounded area are perceived as grouped.

**What to evaluate:**
- Are cards, borders, or background colors used to group related elements?
- Do visual containers correctly reflect the logical grouping of content?
- Are boundaries clear without being heavy-handed?

**Common violations:**
- Related items split across different visual containers
- Unrelated items grouped within the same card/container
- Overuse of borders creating visual noise

---

#### Law of Uniform Connectedness
**Principle:** Visually connected elements are perceived as more related than disconnected elements.

**What to evaluate:**
- Are connecting lines, arrows, or shared backgrounds used to show relationships?
- Are related items in lists/grids visually tied together?
- Do step indicators use connecting lines to show sequence?

**Common violations:**
- Multi-step flows with no visual connection between steps
- Related data points in dashboards with no visual link

---

#### Law of Pragnanz (Simplicity)
**Principle:** People interpret complex images as the simplest form possible to reduce cognitive effort.

**What to evaluate:**
- Are visual elements as simple as they can be while still communicating effectively?
- Can the user quickly parse the overall layout structure?
- Are complex data visualizations simplified to their essential message?

**Common violations:**
- Overly complex icons that are hard to parse at small sizes
- Dashboard layouts that require significant effort to understand the structure
- Charts with too many data series or visual encodings

---

#### Law of Similarity (see above)

---

### Category D: Memory & Attention

#### Serial Position Effect
**Principle:** Users best remember the first and last items in a series.

**What to evaluate:**
- Are the most important items placed first or last in lists and navigation?
- Are key actions positioned at the edges of navigation bars (far left and far right)?
- Is less critical content placed in the middle of sequences?

**Common violations:**
- Most important navigation items buried in the middle
- CTAs placed in the middle of a feature list rather than at the beginning or end

---

#### Von Restorff Effect (Isolation Effect)
**Principle:** The item that differs from the rest in a group is most likely to be remembered.

**What to evaluate:**
- Are primary CTAs visually distinct from surrounding elements?
- Is visual emphasis used with restraint (too many "standout" elements cancel each other out)?
- Does the standout element NOT rely solely on color (accessibility)?
- Is motion used carefully for emphasis (considering motion sensitivity)?

**Common violations:**
- Multiple competing CTAs with equal visual weight
- Recommended pricing tier not visually differentiated
- Important status indicators styled identically to surrounding content

---

#### Selective Attention
**Principle:** People focus on a subset of stimuli relevant to their goals, filtering out the rest.

**What to evaluate:**
- Is the user's attention guided toward task-relevant content?
- Are ad-like patterns avoided for important content (banner blindness)?
- Are simultaneous changes minimized to prevent change blindness?

**Common violations:**
- Important notifications styled like banner ads
- Critical information placed in commonly-ignored zones (right sidebar, bottom of page)
- Multiple UI areas updating simultaneously, causing users to miss changes

---

#### Zeigarnik Effect
**Principle:** People remember uncompleted tasks better than completed tasks.

**What to evaluate:**
- Do progress indicators show how far along users are (and how much remains)?
- Does artificial progress encourage task completion (pre-filling steps, showing partial progress)?
- Are clear signifiers of additional content provided (peek of next item, "..." truncation)?

**Common violations:**
- Multi-step processes with no progress indicator
- Onboarding flows that don't show completion percentage
- Content feeds that don't hint at more content below the fold

---

### Category E: User Psychology & Behavior

#### Jakob's Law
**Principle:** Users spend most of their time on other sites and expect yours to work the same way.

**What to evaluate:**
- Does the UI follow conventions from the category (e-commerce, SaaS, social media)?
- Are standard patterns used for standard functions (cart, checkout, search, settings)?
- When redesigning, is a transition path provided for existing users?

**Common violations:**
- Custom interaction patterns where standard ones exist
- Novel navigation structures that ignore established conventions
- Major redesigns launched with no transition period or option to revert

---

#### Mental Model
**Principle:** Users bring compressed models of how systems work based on prior experience.

**What to evaluate:**
- Does the interface match how users think about the task (not how the system works internally)?
- Are information architectures aligned with user expectations (validated via card sorting, tree testing)?
- Is the gap between the designer's model and the user's model identified and addressed?

**Common violations:**
- Navigation structured by internal departments rather than user goals
- Terminology that reflects the database schema rather than user concepts
- Workflows that follow the system's process rather than the user's mental process

---

#### Aesthetic-Usability Effect
**Principle:** Users perceive aesthetically pleasing designs as more usable, and tolerate minor issues in attractive interfaces.

**What to evaluate:**
- Is the visual design polished enough to inspire confidence?
- Warning: Is attractive design masking usability problems that need fixing?
- Are first impressions considered (users judge within 50ms)?

**Common violations:**
- Beautiful design hiding critical usability issues (discovered only in testing)
- Ugly but functional interfaces that erode user trust and patience
- Over-reliance on aesthetics during user testing (users report it "works great" because it looks great)

---

#### Cognitive Bias
**Principle:** Systematic errors in thinking that affect judgment. Users rely on mental shortcuts that can introduce errors.

**What to evaluate:**
- Is the design exploiting cognitive biases ethically?
- Are defaults set to benefit the user (not dark patterns)?
- Is information framed objectively rather than misleadingly?

**Common violations:**
- Pre-checked opt-in boxes that exploit inattention
- Decoy pricing designed to manipulate rather than inform
- Confirmation bias reinforced by only showing supporting information

---

#### Peak-End Rule
**Principle:** People judge experiences based on how they felt at the peak moment and at the end, not the average.

**What to evaluate:**
- Are the most intense moments (success, completion, delight) designed intentionally?
- Does the experience end on a positive note (confirmation, celebration, clear next steps)?
- Are negative peaks mitigated (long waits, confusing errors, failed transactions)?

**Common violations:**
- Checkout flow that ends with a bland "Order confirmed" page
- Error states that create strong negative peaks with no recovery path
- Onboarding that ends abruptly rather than with a sense of accomplishment

---

#### Goal-Gradient Effect
**Principle:** Motivation to complete a task increases with proximity to the goal.

**What to evaluate:**
- Do progress indicators show how close users are to completion?
- Is artificial progress used ethically to boost completion (e.g., profile "already 20% complete")?
- Are multi-step tasks designed to feel progressively easier as users advance?

**Common violations:**
- Long forms with no progress indicator
- Loyalty programs that don't show progress toward rewards
- Multi-step flows where later steps feel harder, not easier

---

#### Paradox of the Active User
**Principle:** Users never read manuals — they start using the software immediately.

**What to evaluate:**
- Is the interface usable without reading documentation?
- Is help integrated contextually (tooltips, inline hints) rather than requiring manual consultation?
- Are multiple paths supported (quick-start vs. guided setup)?

**Common violations:**
- Features that only make sense after reading help docs
- Onboarding that requires completing a full tutorial before accessing the product
- Complex features with no contextual guidance

---

#### Postel's Law (Robustness Principle)
**Principle:** Be liberal in what you accept, and conservative in what you send.

**What to evaluate:**
- Does the system accept varied input formats and normalize them (dates, phone numbers, addresses)?
- Are edge cases and non-standard inputs handled gracefully rather than rejected?
- Is output consistent and well-structured regardless of input variation?

**Common violations:**
- Phone number field that rejects entries with dashes or parentheses
- Date field that only accepts one format (MM/DD/YYYY but not DD/MM/YYYY or natural language)
- Search that returns zero results for minor typos instead of suggesting alternatives

---

#### Pareto Principle (80/20 Rule)
**Principle:** Roughly 80% of effects come from 20% of causes.

**What to evaluate:**
- Are the most-used 20% of features prominently accessible?
- Is design effort focused on the flows that serve the majority of users?
- Are rare-use features appropriately de-emphasized (not cluttering the main interface)?

**Common violations:**
- Edge-case features given equal visual weight as primary features
- Design effort spent optimizing rarely-used admin screens over core user flows
- Settings exposed in the main UI that only 2% of users change

---

#### Tesler's Law (Conservation of Complexity)
**Principle:** Every system has irreducible complexity. The question is whether the system or the user bears it.

**What to evaluate:**
- Has the system absorbed complexity that would otherwise burden users (smart defaults, auto-detection, pre-processing)?
- Are unavoidable complex tasks supported with contextual guidance (tooltips, inline help)?
- Is simplification authentic (not hiding necessary complexity behind extra clicks)?

**Common violations:**
- Oversimplified UI that pushes complexity to a "settings" page users can't find
- Configuration requiring users to understand system internals
- "Simple" interface that requires more steps than a moderately complex one

---

#### Occam's Razor
**Principle:** Among competing approaches that work equally well, the simplest one is best.

**What to evaluate:**
- Could any UI element be removed without reducing functionality?
- Is the simplest interaction pattern used for each task?
- Are there unnecessary steps, screens, or confirmations that could be eliminated?

**Common violations:**
- Multi-step confirmation for low-risk actions
- Features added "just in case" that no one uses
- Redundant paths to the same function that create confusion

---

## Part 3: Evaluation Report Template

```
## UX Heuristic Evaluation: [Screen/Flow Name]

### Summary
| Category | Issues Found |
|----------|-------------|
| Nielsen Heuristics | N |
| Laws of UX | N |
| Total | N |

### Critical Issues
Issues that prevent task completion or cause significant user confusion/frustration.

**[C1] [Heuristic/Law violated] — [Brief description]**
- Location: [Where in the UI]
- Problem: [What's wrong and why it matters]
- Recommendation: [Specific fix]

### Major Issues
Issues that significantly slow users down or cause moderate confusion.

**[M1] [Heuristic/Law violated] — [Brief description]**
- Location: [Where in the UI]
- Problem: [What's wrong and why it matters]
- Recommendation: [Specific fix]

### Minor Issues
Issues that cause slight friction or deviate from best practices.

**[m1] [Heuristic/Law violated] — [Brief description]**
- Location: [Where in the UI]
- Problem: [What's wrong and why it matters]
- Recommendation: [Specific fix]

### Strengths
What the design does well (always include positive findings).

### Prioritized Recommendations
1. [Highest impact fix]
2. [Second highest impact fix]
3. [Third highest impact fix]
```
