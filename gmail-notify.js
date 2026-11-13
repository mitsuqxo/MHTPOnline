import * as F from "./fb.js";
import { TYPES, code, getApplicantEmail } from "./admin-shared.js";

/**
 * Optional hardcoded Google Apps Script Web App URL.
 * Leave empty to configure via the Admin "Gmail setup" button (saved to Firestore / localStorage),
 * or paste your deployed https://script.google.com/macros/s/.../exec URL here to apply globally.
 */
export const DEFAULT_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyJ6BY-zVoPR-zJL7cBV9xUaCFEM8gUFnTAtUuGXbTf7tFokTHPAz2y7g9ZziVj_sYo/exec";

const STORAGE_KEY = "mhtp_gmail_apps_script_url";
const PARISH_NAME = "Parish of the Most Holy Trinity, Shrine of the Glorious Cross";
const PARISH_CONTACT = "(043) 773-3988 / 0956-029-3744";
const PARISH_EMAIL = "mhtpbatangas@gmail.com";

let cachedFirestoreUrl;

export function isValidAppsScriptUrl(url) {
  return /^https:\/\/script\.google\.com\/(macros\/s\/|a\/macros\/[^/]+\/s\/).+\/exec(\?.*)?$/i.test(url.trim());
}

export async function getAppsScriptUrl(db) {
  if (cachedFirestoreUrl === undefined) {
    try {
      const snap = await F.getDoc(F.doc(db, "settings", "email"));
      const remoteUrl = snap.exists() ? String(snap.data()?.appsScriptUrl || "").trim() : "";
      cachedFirestoreUrl = remoteUrl;
    } catch {
      cachedFirestoreUrl = "";
    }
  }
  if (cachedFirestoreUrl) return cachedFirestoreUrl;

  try {
    const localUrl = String(localStorage.getItem(STORAGE_KEY) || "").trim();
    if (localUrl) return localUrl;
  } catch {
    // Ignore storage access errors.
  }

  return DEFAULT_APPS_SCRIPT_URL.trim();
}

export async function saveAppsScriptUrl(db, rawUrl) {
  const cleanUrl = String(rawUrl || "").trim();
  if (cleanUrl && !isValidAppsScriptUrl(cleanUrl)) {
    throw new Error("Please enter a valid Google Apps Script Web App URL ending in /exec.");
  }

  try {
    if (cleanUrl) localStorage.setItem(STORAGE_KEY, cleanUrl);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage quota / privacy mode errors.
  }

  cachedFirestoreUrl = cleanUrl;
  let savedToFirestore = false;
  try {
    await F.setDoc(
      F.doc(db, "settings", "email"),
      { appsScriptUrl: cleanUrl, updatedAt: F.serverTimestamp() },
      { merge: true }
    );
    savedToFirestore = true;
  } catch {
    savedToFirestore = false;
  }

  return { url: cleanUrl, savedToFirestore };
}

export function buildNotificationEmail(submission, status, noteOverride) {
  const to = getApplicantEmail(submission);
  const typeLabel = TYPES[submission?.type] || "Application";
  const refCode = code(submission);
  const applicant = submission?.who || "Applicant";
  const note = String(noteOverride ?? submission?.note ?? "").trim();
  const isApproved = status === "approved";
  const decisionWord = isApproved ? "Confirmed" : "Declined";

  const subject = `[${refCode}] ${typeLabel} Application ${decisionWord} - Parish of the Most Holy Trinity`;
  const lines = [
    `Dear ${applicant},`,
    "",
    isApproved
      ? `Peace be with you! We are pleased to inform you that your ${typeLabel} application (Reference: ${refCode}) has been CONFIRMED by the Parish Office.`
      : `Peace be with you. Thank you for submitting your ${typeLabel} application (Reference: ${refCode}). After review, your application has been DECLINED at this time.`,
  ];

  if (note) {
    lines.push("", "Parish Office Note:", note);
  }

  lines.push(
    "",
    isApproved
      ? "Please keep your reference code and bring any required original documents when visiting the parish office."
      : "If you have questions or wish to resubmit requirements, please reach out to the parish office.",
    "",
    "Parish Office Contact:",
    PARISH_NAME,
    `Phone: ${PARISH_CONTACT}`,
    `Email: ${PARISH_EMAIL}`,
    "Pastor Village, Pallocan West, Batangas City"
  );

  const textBody = lines.join("\n");
  const gmailComposeUrl = to
    ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(textBody)}`
    : "";

  return { to, subject, textBody, gmailComposeUrl };
}

async function callAppsScript(auth, url, payload) {
  const user = auth.currentUser;
  if (!user) throw new Error("Admin session expired. Please sign in again.");
  const idToken = await user.getIdToken();

  const response = await fetch(url, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...payload, idToken })
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "Apps Script returned an unexpected response. Ensure Web App access is set to 'Anyone' and a new deployment version is published."
    );
  }

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Email service error (HTTP ${response.status}).`);
  }
  return data;
}

export async function testAppsScriptConnection({ auth, url }) {
  const cleanUrl = String(url || "").trim();
  if (!isValidAppsScriptUrl(cleanUrl)) {
    throw new Error("Please enter a valid Google Apps Script Web App URL ending in /exec.");
  }
  return callAppsScript(auth, cleanUrl, { action: "test" });
}

async function saveNotificationMeta(db, submissionId, meta) {
  try {
    await F.updateDoc(F.doc(db, "submissions", submissionId), {
      emailNotification: meta
    });
  } catch {
    // Non-fatal if metadata update fails after primary status update.
  }
}

export async function sendGmailNotification({ auth, db, submission, status, note }) {
  if (status !== "approved" && status !== "rejected") {
    return { ok: false, reason: "invalid_status", message: "Notifications only apply to Confirmed or Declined applications." };
  }

  const { to, gmailComposeUrl } = buildNotificationEmail(submission, status, note);
  if (!to) {
    await saveNotificationMeta(db, submission.id, {
      status: "no_email",
      notifiedStatus: status,
      updatedAt: F.serverTimestamp()
    });
    return { ok: false, reason: "no_email", message: "No email address on file for this application." };
  }

  const url = await getAppsScriptUrl(db);
  if (!url) {
    await saveNotificationMeta(db, submission.id, {
      status: "not_configured",
      to,
      notifiedStatus: status,
      updatedAt: F.serverTimestamp()
    });
    return {
      ok: false,
      reason: "not_configured",
      to,
      composeUrl: gmailComposeUrl,
      message: "Automatic Gmail sending is not configured yet."
    };
  }

  try {
    const result = await callAppsScript(auth, url, {
      action: "notify",
      submissionId: submission.id
    });
    await saveNotificationMeta(db, submission.id, {
      status: "sent",
      to: result.to || to,
      notifiedStatus: status,
      sentAt: F.serverTimestamp(),
      method: "apps-script"
    });
    return {
      ok: true,
      to: result.to || to,
      composeUrl: gmailComposeUrl,
      remainingQuota: result.remainingQuota
    };
  } catch (error) {
    const errorMessage = error?.message || "Failed to reach Gmail notification service.";
    await saveNotificationMeta(db, submission.id, {
      status: "failed",
      to,
      notifiedStatus: status,
      error: errorMessage,
      updatedAt: F.serverTimestamp()
    });
    return {
      ok: false,
      reason: "send_error",
      to,
      composeUrl: gmailComposeUrl,
      error: errorMessage
    };
  }
}
