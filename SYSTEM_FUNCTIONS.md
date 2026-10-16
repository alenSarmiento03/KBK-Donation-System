# KBK Donation System — Function Reference

This document describes the functions currently implemented in the KBK Donation System. It is organized by the work a person is doing rather than by source-file order.

## Application overview

The website is a set of static HTML pages sharing [`script.js`](script.js) and [`style.css`](style.css). Supabase Authentication protects admin pages; Supabase Postgres and Storage hold shared records and private receipt files. Public pages use the `kbk_public_snapshot()` database function, which returns a limited public view. The browser's local storage is a cache and legacy-import source; it is not the authoritative shared database.

The app currently has two page modes:

- **Public/user pages:** visitors have view-only access to published donation totals, donor counts, donation progress, needs, projects, and distribution information. Separate public forms accept Lipa City LGU assistance requests and contact messages; these submissions do not grant access to or permission to change donation records.
- **Admin pages:** active Supabase administrator accounts can manage donations, donors, beneficiaries, projects, inventory, allocations, distributions, expenses, reports, and inbox records.

There is no separate member or staff role in the current setup. Admin authorization is checked in the app and enforced by Supabase Row Level Security (RLS).

## Page directory

| Area | Page files | Purpose |
| --- | --- | --- |
| Public | `index.html` | Overview, transparency figures, published needs, and assistance form |
| Public | `about.html`, `categories.html`, `donate.html` | Organization information, donation categories, and ways to donate |
| Public | `transparency.html`, `impact.html`, `public-projects.html`, `public-distributions.html`, `track-donation.html`, `updates.html` | Published donation, impact, project, distribution, donation-list, and update views |
| Public | `assistance.html`, `contact.html` | Public assistance request and contact/feedback forms |
| Admin | `login.html` | Supabase email/password sign-in |
| Admin | `dashboard.html` | Donation-first overview, verification queue, recent donation records, and workflow shortcuts |
| Admin | `donations.html`, `donors.html`, `beneficiaries.html` | Donation and constituent records |
| Admin | `allocations.html`, `distributions.html`, `expenses.html`, `projects.html`, `inventory.html` | Money allocation, deliveries, expenses, projects, and stock |
| Admin | `requests.html` | Assistance and contact inboxes, with search and status filters |
| Admin | `reports.html`, `admin-transparency.html`, `accounts.html`, `settings.html` | Exports, public-view preview, administrator account information, and system status |

Page mode is declared on each `<body>` using `data-page="public"`, `data-page="dashboard"`, or `data-page="login"`. Admin pages also provide a `data-section` label.

## Function reference

### Startup, Supabase, sync, and access control

| Function | What it does |
| --- | --- |
| `showSystemStatus(message, isError)` | Displays a system notice; offers sync retry or a recovery-file/reload action after a revision conflict. |
| `clearSystemStatus()` | Removes the system notice. |
| `loadScript(src)` | Loads a script resource dynamically and reports load failure. |
| `initializeSupabaseClient()` | Reads the public Supabase config, validates its URL/key, loads the Supabase browser library, and creates the client. |
| `cacheRemoteValue(key, value)` | Saves a remote list into the browser's local cache. |
| `loadAdminSharedData()` | Loads the shared admin lists and revision numbers; creates empty remote lists that are missing. |
| `preserveLegacyBrowserData()` | Backs up existing browser lists before the authenticated admin loads shared lists. |
| `loadPublicSharedData()` | Calls `kbk_public_snapshot()`, caches its filtered data, and records the successful load time. |
| `loadAdminAssistanceRequests()` | Loads private assistance submissions for the active administrator. |
| `loadAdminFeedbackMessages()` | Loads private contact messages for the active administrator. |
| `initializeSupabaseForPage(page)` | Initializes Supabase/session/profile checks and loads the data appropriate to the current page mode. |
| `persistSharedData(key, value)` | Writes one shared list with a revision check to detect concurrent administrator edits. |
| `retryPendingSharedWrites()` | Retries failed writes using the current local copy. |
| `isLoggedIn()` | Checks the page session flag. The Supabase session is checked separately during initialization. |
| `getUserRole()` | Returns the locally cached role for the current session. |
| `clearAuthSession()` | Clears cached authentication/session display values. |
| `requireAuth()` | Redirects visitors without an active admin session to the login page. |
| `logout()` | Records the logout activity, signs out of Supabase, clears local session values, and redirects to login. |
| `handleLogin(event)` | Signs in with Supabase, checks the user's active admin profile, and opens the dashboard. |
| `toggleLoginPassword()` | Toggles password visibility on the login page. |
| `initializeLoginPage()` | Redirects an already signed-in admin and wires login form feedback and controls. |

### Shared records, normalization, and formatting

| Function | What it does |
| --- | --- |
| `getDonations()` | Reads and normalizes donation records; public pages return no records when live public data is unavailable. |
| `getDonationDonorName(donation)` | Resolves a donation's linked donor name, falling back to its saved name. |
| `getDonationDonorProfile(donation)` | Finds the donor profile linked to a donation. |
| `populateDonationDonorOptions(selectedValue, searchValue)` | Fills and filters the donor selector on the donation form. |
| `updateDonationDonorFields()` | Updates donor name/link fields from the selected donor. |
| `migrateDonationDonorLinks()` | Links older donations to a unique exact-match donor profile where possible. |
| `resolveDonationDonor(selection, enteredName)` | Resolves the donor profile/name submitted on a donation. |
| `saveDonations(list)` | Saves the donation list through the shared-list save path. |
| `getDonors()` / `saveDonors(list)` | Read and save donor profiles. |
| `getBeneficiaries()` / `saveBeneficiaries(list)` | Read and save beneficiaries and assistance histories. |
| `readStoredList(key, label, defaults)` | Reads a local list, initializes its default when absent, and handles malformed data. Public pages suppress fallback lists when live data is unavailable. |
| `saveStoredList(key, list)` | Saves a local list and starts its shared Supabase write. |
| `getProjects()` | Reads project/activity records. |
| `ensureCommunityFoodPackCampaign()` | Adds the configured campaign project if it is missing from the admin project list. |
| `getDistributions()` / `getExpenses()` | Read distribution and expense records. |
| `getAssistanceRequests()` / `getPublicFeedback()` | Read legacy browser-stored request/message lists. Current submissions use the private Supabase inbox tables. |
| `getActivityLog()` | Reads the activity history. |
| `getInventory()` | Reads inventory and public-need records. |
| `logActivity(action)` | Adds an activity-log entry for the current admin and saves the log. |
| `nextId(list)` | Returns the next numeric record ID for a list. |
| `peso(n)` | Formats a number as Philippine pesos. |
| `formatDate(dateStr)` | Formats a date for display. |
| `normalizeDonationStatus(status)` | Maps donation status values to the supported status vocabulary. |
| `donationReference(id)` | Formats a donation's human-readable reference code. |
| `normalizeInKindDonation(donation)` | Normalizes legacy/current in-kind donation fields. |
| `formatInKindDonation(donation)` | Builds a readable in-kind item/quantity description. |
| `formatInKindTotals(donations)` | Summarizes quantities of in-kind donations. |
| `computeStats(list)` | Computes general donation totals and counts. |
| `computePublicStats(donations)` | Computes the aggregate metrics used by public transparency views. |
| `setText(id, value)` | Sets an element's text safely when it exists. |
| `capitalize(s)` | Capitalizes a string for labels. |
| `escapeHtml(str)` | Escapes text before inserting it into HTML templates. |
| `promptRecordUpdate(record, fields)` | Collects and validates edits using prompts for the supplied fields. |
| `promptRelatedRecordId(label, currentId, records, allowNone)` | Prompts for a linked record ID and validates the selection. |

### Public pages and public submissions

| Function | What it does |
| --- | --- |
| `updatePublicDataStatus()` | Shows whether public data loaded from Supabase, including the last successful load time, or explains that figures are hidden due to load failure. |
| `renderPublicPage()` | Updates the public transparency/impact components from the filtered public records. |
| `publicCampaignProgressMarkup(project, donations)` | Builds campaign progress display markup. |
| `renderPublicCampaignProgress(donations)` | Renders active public campaign progress. |
| `getProjectFundingSummary(projectId, donations)` | Calculates project-linked donations, allocations, and verified expense totals. |
| `renderPublicProjectTransparency(donations)` | Renders public project funding summaries. |
| `renderPublicNeeds()` | Renders inventory items explicitly marked as public needs. |
| `publicDonorDisplayName(donation)` | Returns an anonymous label or approved first-name/last-initial donor label. |
| `renderPublicDonationList(donations)` | Renders the approved donation list without private donor contact information. |
| `renderPublicDonorRecognition(donations)` | Renders public donor recognition for eligible donations. |
| `renderPublicProjects()` | Renders project/activity information approved for the public snapshot. |
| `renderPublicNews()` | Builds announcements from scheduled distributions and completed activities. |
| `renderPublicImpact(donations)` | Renders project-linked impact aggregates. |
| `renderPublicDistributions()` | Renders completed public distribution summaries. |
| `publicDistributionCategory(distribution)` | Maps a distribution record to a public category label. |
| `publicDistributionQuantity(value)` | Formats the public quantity text for a distribution. |
| `handlePublicAssistanceSubmit(event)` | Starts public assistance form submission. |
| `submitPublicAssistanceRequest(event)` | Validates the form and submits through the public Edge Function after the visitor passes Turnstile. |
| `handlePublicFeedbackSubmit(event)` | Starts public contact-message submission. |
| `submitPublicFeedback(event)` | Validates the form and submits through the public Edge Function after the visitor passes Turnstile. |
| `initializePublicSubmissionProtection()` | Loads the Cloudflare Turnstile widget and keeps public submit buttons disabled until a valid challenge token is ready. |
| `getPublicSubmissionToken(form)` | Reads the current one-time Turnstile token from a public form. |
| `resetPublicSubmissionChallenge(form)` | Resets the one-time token after an attempted submission. |
| `getPublicSubmissionError(error, fallback)` | Reads a safe server error message returned by the public Edge Function. |
| `renderReplyLink(contact, subject)` | Builds an email or SMS link for an administrator to contact a submitter. It opens the user's mail or messaging app; it does not send automatically. |
| `renderPublicPageLayout(publicMenu)` | Applies the shared public page layout and heading structure. |
| `initializePublicNavigation(nav)` | Sets up the responsive public navigation, including keyboard and mobile-menu behavior. |
| `selectCategory(category)` | Filters public needs by the selected donation category. |

### Admin requests, contact inbox, inventory, and settings

| Function | What it does |
| --- | --- |
| `renderAssistanceRequests()` | Renders the assistance inbox, including the admin-side search, status filter, and status counts. |
| `updateRemoteAssistanceRequest(request, changes, activityMessage)` | Saves an admin edit to an assistance request in Supabase. |
| `deleteRemoteAssistanceRequest(request)` | Deletes an assistance request after confirmation in the UI. |
| `updateAssistanceRequest(id, status)` | Approves or declines a pending assistance request in Supabase. |
| `renderPublicFeedback()` | Renders the contact inbox with its search, status filter, and status counts. |
| `updateRemoteFeedbackMessage(id, changes)` | Updates a contact message's follow-up status in Supabase. |
| `deleteRemoteFeedbackMessage(item)` | Deletes a contact message after confirmation in the UI. |
| `renderInventory()` | Renders inventory and its public-need indicators/actions. |
| `renderSystemSettings()` | Shows session/data/storage information on the system settings page. |
| `handleInventorySubmit(event)` | Creates or updates an inventory item. |

### Admin navigation, page layout, and dashboard

| Function | What it does |
| --- | --- |
| `renderSiteNavigation()` | Builds the public and admin menus and marks the active page. |
| `insertAdminPageChrome(section)` | Adds shared admin context/navigation elements to admin pages. |
| `insertAdminPageGuide()` | Adds page-specific admin guidance. |
| `toggleSidebar(forceOpen)` | Opens or closes the admin mobile sidebar. |
| `renderDashboard()` | Renders the donation table and overview widgets on dashboard-backed pages. |
| `renderAdminOverview()` | Updates admin dashboard totals, recent donations, activity, and allocation data. |
| `renderAdminTable(list)` | Renders and wires the donation tracking table and its actions. |
| `renderActivityLog()` | Renders the activity history table. |

### Donations, receipts, allocations, and migration

| Function | What it does |
| --- | --- |
| `uploadDonationReceipt(file, donationId)` | Uploads private donation proof to Supabase Storage. |
| `deleteStoredDonationReceipt(proof)` | Deletes a stored donation proof file. |
| `openDonationReceipt(path)` | Opens/downloads a private donation proof file through a short-lived signed URL. |
| `createDonationAcknowledgement(donation)` | Opens a printable KBK donation acknowledgment. |
| `renderLegacyReceiptMigrationButton()` | Shows the migration action when embedded legacy receipt files exist. |
| `migrateLegacyDonationReceipts()` | Moves legacy embedded donation proof into private Storage and updates donation records. |
| `renderAllocationTable(donations)` | Displays cash donations and their allocation records. |
| `updateDonationStatus(id, status, rejectionReason)` | Changes a donation's review status and rejection reason. |
| `openAllocationModal(id)` / `closeAllocationModal()` | Open or close the donation allocation dialog. |
| `handleAllocationSubmit(event)` | Validates and saves an allocation for a cash donation. |
| `openAddModal()` / `openEditModal(id)` / `toggleModal(show)` | Open/close the donation form modal and prepare it for create/edit. |
| `handleFormSubmit(event)` | Validates and saves a donation record, including optional receipt handling. |
| `deleteDonation(id)` | Deletes a donation after confirmation and updates its related records. |
| `updateTypeFields()` | Shows the donation fields appropriate to cash or in-kind donations. |

### Donor and beneficiary management

| Function | What it does |
| --- | --- |
| `renderDonorTable()` | Renders donor profiles using the current search and status filters. |
| `renderDonorContributions()` | Shows donation history for the selected donor. |
| `populateDonorForm(donor)` | Loads a donor's data into the edit form. |
| `resetDonorForm()` | Clears the donor form and exits edit mode. |
| `toggleDonorStatus(donorId)` | Activates or deactivates a donor profile. |
| `deleteDonor(donorId)` | Deletes a donor profile after confirmation while retaining saved donation names. |
| `showDonorProfile(donorId)` | Shows donor details and contribution history. |
| `syncDonorFromDonation(donation)` | Creates/updates donor profile details from a saved donation. |
| `handleDonorSubmit(event)` | Validates and saves a donor profile. |
| `renderBeneficiaryTable()` | Renders beneficiary records and their available actions. |
| `showBeneficiaryProfile(id)` | Shows beneficiary information and assistance history. |
| `handleBeneficiarySubmit(event)` | Validates and saves a beneficiary profile. |
| `resetBeneficiaryForm()` | Clears the beneficiary form and exits edit mode. |
| `editBeneficiary(id)` | Loads a beneficiary into the edit form. |
| `deleteBeneficiary(id)` | Deletes a beneficiary after confirmation and handles related distribution links. |
| `openAssistanceModal(id)` / `closeAssistanceModal()` | Open or close the beneficiary assistance-history dialog. |
| `handleAssistanceSubmit(event)` | Adds an assistance-history entry for a beneficiary. |

### Projects, distributions, and expenses

| Function | What it does |
| --- | --- |
| `populateProjectOptions()` | Fills project selectors in admin forms. |
| `renderProjectTable()` | Renders projects with funding, expense, beneficiary, and distribution summaries. |
| `handleProjectSubmit(event)` | Creates or updates a project/activity. |
| `populateDistributionOptions()` | Fills project and beneficiary selectors for distributions. |
| `renderDistributionTable()` | Renders distributions and status/edit/delete actions. |
| `handleDistributionSubmit(event)` | Validates and saves a distribution. |
| `updateExpenseFundingPreview()` | Shows the funding/budget preview for the selected project and expense amount. |
| `uploadExpenseReceipt(file, expenseId)` | Uploads an expense receipt into private Storage. |
| `openExpenseReceipt(path)` | Opens an expense receipt using a short-lived signed URL. |
| `deleteStoredExpenseReceipt(proof)` | Deletes an expense receipt from private Storage. |
| `replaceExpenseReceipt(expenseId, fileInput)` | Replaces an existing expense receipt with a validated upload. |
| `renderExpenseTable()` | Renders expenses, verification state, receipts, and available admin actions. |
| `handleExpenseReceiptReplace(event)` | Starts receipt replacement for the selected expense. |
| `handleExpenseSubmit(event)` | Validates and saves an expense and optional receipt. |

### Reports, accounts, and page startup

| Function | What it does |
| --- | --- |
| `buildReportData(type, from, to)` | Builds report rows for a report type and date range. |
| `describeReportDateScope(from, to)` | Produces a human-readable description of the selected date scope. |
| `updateReportPreview()` | Refreshes the report preview when report options change. |
| `downloadReport()` | Downloads the selected report or combined CSV export. |
| `renderAccounts()` | Displays the administrator-account management guidance. Actual credentials are managed by Supabase Authentication. |
| `importLegacyBrowserData()` | Imports selected legacy browser lists into shared Supabase data after administrator confirmation. |
| `DOMContentLoaded` handler | Initializes page navigation and Supabase; gates admin pages; loads public/admin data; wires page forms, filters, buttons, and modal controls. |

### Supabase Edge Function

| Function | What it does |
| --- | --- |
| `public.kbk_public_snapshot()` in `supabase-setup.sql` | Runs as a restricted database function and returns only approved public summaries and fields; excludes private donor contacts, beneficiary names, receipts, and non-public inventory details. |
| `Deno.serve(request)` in `supabase/functions/public-submit/index.ts` | Validates Turnstile server-side, validates the form data, applies a per-IP limit of 10 submissions per form type per UTC hour when an IP is available, and inserts into the private inbox using a Supabase secret key stored only on the server. |
| `Deno.serve(request)` in `supabase/functions/notify-inbox/index.ts` | Receives configured Supabase database-webhook events and sends a minimal email notification through the configured provider. Full message contents remain in the private Supabase inbox. This requires Edge Function secrets and database webhooks to be configured; it is not a browser function. |
| `public.kbk_consume_submission_limit()` in `supabase-setup.sql` | Atomically counts submission attempts in a one-hour window for each hashed IP and form type. The table is private to the server. |
| `public.kbk_purge_expired_inbox()` in `supabase-setup.sql` | Deletes assistance and contact submissions older than 180 days and clears old rate-limit fingerprints. Supabase Cron is scheduled to run it daily. |

## Operational notes

- Public display functions consume the filtered `kbk_public_snapshot()` response. If that request fails, public figures and records are hidden instead of being replaced with local sample/cache values.
- Admin changes are cached locally and synchronized by list. Revision conflicts require review; the recovery download is a local JSON copy and does not merge changes automatically.
- Public request/contact submissions are protected by a Turnstile-verified Edge Function and per-IP rate limiting. The site key, secret key, hostname allow-list, SQL setup, and function deployment must all be configured before the forms can accept submissions.
- Assistance requests and contact messages are scheduled for deletion 180 days after submission. The scheduled job is created by the updated SQL setup; verify that it is active in Supabase Cron after applying the SQL.
- Function names and behavior can change as the implementation evolves. Update this reference when pages or application behavior change.
