# MHTP Online

MHTP Online is the public website and online application portal for the Parish of
the Most Holy Trinity, Shrine of the Glorious Cross. It is a static website
hosted by Firebase Hosting. The browser uses Firebase client SDK modules for
authentication, Firestore, and Storage.

## Website structure

### Public pages

- **`index.html`** - Main parish website. It contains the parish history,
  announcements, Mass and sacrament schedules, shrine information, ministries,
  staff directory, photo gallery, contact form, FAQ, and links to online
  applications.
- **`apply.html`** - Online application page. The URL hash selects the
  application type:
  `#wedding`, `#baptism`, `#confirmation`, `#funeral`, or `#masses`.
- **`images/`** - Parish logo, church photo, and responsive navigation image.
- **`styles.css`** - Shared responsive styling for public pages and admin
  pages.

### JavaScript modules

- **`script.js`** - Public-page interactions: responsive navigation, gallery
  rotation, and the contact inquiry mail link.
- **`apply.js`** - Builds the selected application form, displays requirements,
  validates submissions, uploads files, and creates Firestore submission
  records.
- **`fb.js`** - Initializes Firebase and exports the Firestore, Storage, and
  Authentication helpers used by the modules.
- **`admin-login.js`** - Opens the admin sign-in dialog and signs in users with
  Firebase email/password authentication.
- **`dashboard.html` / `dashboard.js`** - Admin summary dashboard showing
  submission counts, review progress, delayed applications, and the application
  queue.
- **`admin.html` / `admin.js`** - Admin record management. Admins can search and
  filter submissions, view uploaded documents, add notes, confirm or decline
  applications, configure Gmail notifications, and resend notifications.
- **`admin-shared.js`** - Shared admin constants and helpers for statuses,
  reference codes, dates, escaping, authorization, and notification labels.
- **`gmail-notify.js`** - Connects the admin portal to the Google Apps Script
  web app. It creates email content, sends authenticated notification requests,
  stores notification results, and provides a Gmail compose fallback.

## Application flow

1. A visitor opens **Apply Online** and chooses an application type.
2. The browser stores uploaded documents in Firebase Storage under
   `submissions/{submissionId}/`.
3. The form creates a Firestore document in `submissions` with the applicant
   details, application type, uploaded-file metadata, `pending` status, and
   creation timestamp.
4. An authorized parish administrator signs in and opens the dashboard or
   Manage Records page.
5. The administrator reviews the record and changes its status to `approved`
   (shown as **Confirmed**) or `rejected` (shown as **Declined**).
6. After a decision, the admin portal calls the Google Apps Script web app to
   send an email. The result is stored in the submission's
   `emailNotification` field. If automatic sending is unavailable, the admin
   can open a pre-filled Gmail compose window.

## Firebase configuration

Firebase is initialized in [`fb.js`](./fb.js) using the `mhtponline` project.
The module uses Firebase Web SDK version 10.12.2 and initializes:

- **Firebase Authentication** - Admin email/password sign-in.
- **Cloud Firestore** - Application records and settings.
- **Cloud Storage** - Uploaded application documents.
- **Firebase Analytics** - Initialized when the browser supports it.

The main Firestore documents used by the site are:

| Path | Purpose |
| --- | --- |
| `submissions/{id}` | Applicant data, application type, status, files, timestamps, and notification metadata |
| `admins/{uid}` | Authorized admin marker |
| `admin/{uid}` | Backward-compatible authorized admin marker |
| `settings/payment` | Optional payment instructions displayed for Mass applications |
| `settings/email` | Saved Google Apps Script web app URL |

The application record stores general fields such as `type`, `status`, `who`,
`contact`, `email`, `data`, `files`, `createdAt`, and `reviewedAt`. Uploaded
files are not embedded in Firestore; only their Storage paths and labels are
stored in the `files` array.

### Firebase Hosting

[`firebase.json`](./firebase.json) configures Firebase Hosting to serve the
repository root (`"."`) as the public directory. Clean URLs are enabled.
The Firebase configuration files, hidden files, dependencies, and
`gmail-apps-script/` are excluded from deployment. The Apps Script source is
kept in the repository for maintenance and is deployed separately to Google.

Before deploying, confirm in the Firebase Console that:

1. Email/password Authentication is enabled.
2. Firestore is enabled and its rules allow only the intended public
   submission operations and authorized admin operations.
3. Storage is enabled with rules appropriate for application documents.
4. At least one admin user has a document at `admins/{firebaseUserUid}` or
   `admin/{firebaseUserUid}`.

## Google Gmail notification script

The Gmail service is a separate Google Apps Script web app:

- Source: [`gmail-apps-script/Code.gs`](./gmail-apps-script/Code.gs)
- Setup guide: [`gmail-apps-script/README.md`](./gmail-apps-script/README.md)
- Browser client: [`gmail-notify.js`](./gmail-notify.js)

The script sends confirmation or rejection emails from the parish Gmail
account. It does not trust a submission supplied by the browser. Instead, it:

1. Receives a POST request containing an action, Firebase ID token, and (for
   notifications) a submission ID.
2. Verifies the Firebase ID token through the Firebase Identity Toolkit API.
3. Checks that the authenticated Firebase user has an `admins/{uid}` or
   `admin/{uid}` document in Firestore.
4. Reads the requested submission directly from Firestore using the token.
5. Confirms that the submission status is `approved` or `rejected`.
6. Builds a plain-text and HTML email and sends it with `MailApp.sendEmail`.
7. Returns JSON containing the send result and remaining daily Gmail quota.

### Deploying the Apps Script

1. Sign in to the parish Google account and open
   [Google Apps Script](https://script.google.com/).
2. Create a project and copy the contents of
   [`gmail-apps-script/Code.gs`](./gmail-apps-script/Code.gs) into it.
3. Deploy it as a **Web app**.
4. Set **Execute as** to **Me** and **Who has access** to **Anyone**.
5. Authorize the requested permissions and copy the URL ending in `/exec`.
6. In `admin.html`, open **Gmail setup**, paste the URL, test the connection,
   and save it.

The URL is saved in `settings/email` and in browser `localStorage`. A default
URL can also be set in `gmail-notify.js` through
`DEFAULT_APPS_SCRIPT_URL`. When `Code.gs` changes, create a new Apps Script
deployment version so the web app uses the updated code.

## Local development and deployment

This project has no build step or package manifest. During development, serve
the repository through a local HTTP server rather than opening HTML files
directly, because the JavaScript modules use browser imports.

For Firebase deployment, authenticate with the Firebase CLI, select the
`mhtponline` project, and deploy Hosting using the repository's
`firebase.json` configuration. Do not deploy the `gmail-apps-script/` folder as
part of Hosting; it is intentionally excluded.

## Security notes

- Firebase web configuration values are client-side values and are not
  substitutes for Firestore, Storage, or Authentication rules.
- Keep the Google Apps Script deployment URL and Google account permissions
  controlled by parish administrators.
- The Apps Script endpoint requires a valid Firebase ID token and an authorized
  admin record before it can read submissions or send mail.
- Never add service-account private keys, passwords, or other server-side
  credentials to this repository.
