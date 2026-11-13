import * as F from "./fb.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export const TYPES = {
  wedding: "Wedding (Kasal)",
  baptism: "Baptism (Binyag)",
  confirmation: "Confirmation (Kumpil)",
  funeral: "Funeral Mass (Libing)",
  masses: "Masses (Pamisa)"
};

export const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Confirmed" },
  { value: "rejected", label: "Declined" }
];

export const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
}[character]));

export const timestampToDate = value => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatDateTime = date => (
  date ? date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Date unavailable"
);

export const code = submission => String(submission?.id ?? "").slice(0, 8).toUpperCase();

export const ageInDays = date => (
  date ? Math.max(0, Math.floor((Date.now() - date.getTime()) / DAY_MS)) : 0
);

export const getApplicantEmail = submission => String(
  submission?.email || submission?.data?.["Email address"] || submission?.data?.email || ""
).trim();

export function statusInfo(submission) {
  const status = submission?.status || "pending";
  if (status === "approved") {
    return { key: "approved", label: "Confirmed", badgeClass: "confirmed", isDelayed: false };
  }
  if (status === "rejected") {
    return { key: "rejected", label: "Declined", badgeClass: "declined", isDelayed: false };
  }
  const age = ageInDays(timestampToDate(submission?.createdAt));
  if (age >= 3) {
    return { key: "pending", label: `Delayed for ${age} days`, badgeClass: "delayed", isDelayed: true };
  }
  return { key: "pending", label: "Pending review", badgeClass: "pending", isDelayed: false };
}

export function notificationSummary(submission) {
  const email = getApplicantEmail(submission);
  const info = submission?.emailNotification;
  if (!email) {
    return {
      state: "no_email",
      badgeLabel: "No email",
      detail: "No email address was provided with this submission."
    };
  }
  if (info?.status === "sent") {
    const sentDate = timestampToDate(info.sentAt);
    const when = sentDate ? ` on ${formatDateTime(sentDate)}` : "";
    return {
      state: "sent",
      badgeLabel: "Gmail sent",
      detail: `Notification sent to ${info.to || email}${when}.`
    };
  }
  if (info?.status === "failed") {
    return {
      state: "failed",
      badgeLabel: "Gmail failed",
      detail: `Automatic send to ${info.to || email} failed${info.error ? `: ${info.error}` : "."}`
    };
  }
  if (info?.status === "not_configured") {
    return {
      state: "not_configured",
      badgeLabel: "Gmail not connected",
      detail: `Ready to notify ${email} once Gmail auto-send is connected (or use Open in Gmail).`
    };
  }
  if (submission?.status === "pending") {
    return {
      state: "waiting",
      badgeLabel: "Notify on decision",
      detail: `Will notify ${email} when confirmed or declined.`
    };
  }
  return {
    state: "unsent",
    badgeLabel: "Not notified yet",
    detail: `No Gmail notification has been sent to ${email} yet.`
  };
}

export async function isAuthorizedAdmin(db, user) {
  const [admins, admin] = await Promise.all([
    F.getDoc(F.doc(db, "admins", user.uid)).catch(() => null),
    F.getDoc(F.doc(db, "admin", user.uid)).catch(() => null)
  ]);
  return Boolean(admins?.exists() || admin?.exists());
}
