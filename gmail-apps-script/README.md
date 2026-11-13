# Free Gmail Notification Setup (Google Apps Script)

This project sends automatic confirmation and rejection emails from the parish Gmail account (`mhtpbatangas@gmail.com`) **for free** (no Firebase Blaze plan needed) using Google Apps Script.

It verifies the signed-in admin's Firebase ID token and reads the real submission document directly from Firestore before sending, so unauthorized users cannot abuse the endpoint.

## One-time Setup (2 minutes)

1. Sign in to the parish Google / Gmail account (`mhtpbatangas@gmail.com`) and open [https://script.google.com](https://script.google.com).
2. Click **New project**, name it **MHTP Gmail Notifier**, and replace the contents of `Code.gs` with the code from [`Code.gs`](./Code.gs).
3. Save (**Ctrl+S**).
4. Click **Deploy** > **New deployment**.
5. Click the gear icon next to *Select type* and choose **Web app**.
6. Set:
   - **Description:** `MHTP Gmail Notifier v1`
   - **Execute as:** `Me` (the parish Gmail account)
   - **Who has access:** `Anyone`
7. Click **Deploy**, click **Authorize access**, choose the parish Google account, and click **Allow** (if Google shows an unverified app warning, click **Advanced** > **Go to MHTP Gmail Notifier (unsafe)** > **Allow**).
8. Copy the **Web app URL** (it looks like `https://script.google.com/macros/s/.../exec`).
9. Either:
   - Open **Manage records** (`admin.html`) on the site, click **Gmail setup**, paste the Web App URL, click **Test connection**, and click **Save URL**; **or**
   - Paste the URL into `DEFAULT_APPS_SCRIPT_URL` in `gmail-notify.js` and redeploy Firebase Hosting.

> **Important:** Whenever you edit `Code.gs` later, deploy as **Manage deployments > Edit > New version** (or **New deployment**) so changes go live.
