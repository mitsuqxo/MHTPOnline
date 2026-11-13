const FIREBASE_PROJECT_ID = "mhtponline";
const FIREBASE_API_KEY = "AIzaSyASBs58EY0ueodazpG1EH_RH5wisP-r1l4";

const PARISH_NAME = "Parish of the Most Holy Trinity, Shrine of the Glorious Cross";
const PARISH_ADDRESS = "Pastor Village, Pallocan West, Batangas City";
const PARISH_CONTACT = "(043) 773-3988 / 0956-029-3744";
const PARISH_EMAIL = "mhtpbatangas@gmail.com";

const APPLICATION_TYPES = {
  wedding: "Wedding (Kasal)",
  baptism: "Baptism (Binyag)",
  confirmation: "Confirmation (Kumpil)",
  funeral: "Funeral Mass (Libing)",
  masses: "Masses (Pamisa)"
};

function doGet() {
  return jsonResponse({
    ok: true,
    service: "MHTP Online Gmail Notification Service",
    message: "Deploy is active. Use POST requests from the Parish Admin portal."
  });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: "Empty request body." });
    }

    const payload = JSON.parse(e.postData.contents);
    const idToken = String(payload.idToken || "").trim();
    if (!idToken) {
      return jsonResponse({ ok: false, error: "Missing Firebase authentication token." });
    }

    const uid = verifyFirebaseToken(idToken);
    if (!isAuthorizedAdmin(uid, idToken)) {
      return jsonResponse({ ok: false, error: "Access denied. Only authorized parish admins can send notifications." });
    }

    if (payload.action === "test") {
      return jsonResponse({
        ok: true,
        message: "Connected to Parish Gmail notification service.",
        remainingQuota: MailApp.getRemainingDailyQuota()
      });
    }

    if (payload.action === "notify") {
      const submissionId = String(payload.submissionId || "").trim();
      if (!submissionId) {
        return jsonResponse({ ok: false, error: "Missing submissionId." });
      }
      return jsonResponse(sendSubmissionNotification(submissionId, idToken));
    }

    return jsonResponse({ ok: false, error: "Unsupported action." });
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

function verifyFirebaseToken(idToken) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`;
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ idToken }),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const data = JSON.parse(response.getContentText() || "{}");
  if (code !== 200 || !data.users || !data.users.length || !data.users[0].localId) {
    throw new Error("Invalid or expired Firebase admin session.");
  }
  return data.users[0].localId;
}

function firestoreGet(path, idToken) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
  return UrlFetchApp.fetch(url, {
    method: "get",
    headers: { Authorization: `Bearer ${idToken}` },
    muteHttpExceptions: true
  });
}

function isAuthorizedAdmin(uid, idToken) {
  const adminsRes = firestoreGet(`admins/${encodeURIComponent(uid)}`, idToken);
  if (adminsRes.getResponseCode() === 200) return true;
  const adminRes = firestoreGet(`admin/${encodeURIComponent(uid)}`, idToken);
  return adminRes.getResponseCode() === 200;
}

function sendSubmissionNotification(submissionId, idToken) {
  const res = firestoreGet(`submissions/${encodeURIComponent(submissionId)}`, idToken);
  if (res.getResponseCode() !== 200) {
    throw new Error("Could not load submission from Firestore.");
  }

  const rawDoc = JSON.parse(res.getContentText() || "{}");
  const fields = decodeFirestoreMap(rawDoc.fields || {});
  const status = String(fields.status || "pending");
  if (status !== "approved" && status !== "rejected") {
    throw new Error("Application status must be Confirmed or Declined before notifying.");
  }

  const data = fields.data || {};
  const to = String(fields.email || data["Email address"] || data.email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new Error("Applicant does not have a valid email address on file.");
  }

  const applicantName = String(fields.who || "Applicant").trim();
  const typeLabel = APPLICATION_TYPES[fields.type] || "Application";
  const referenceCode = submissionId.slice(0, 8).toUpperCase();
  const note = String(fields.note || "").trim();
  const isApproved = status === "approved";
  const decisionLabel = isApproved ? "Confirmed" : "Declined";

  const subject = `[${referenceCode}] ${typeLabel} Application ${decisionLabel} - Parish of the Most Holy Trinity`;

  const scheduleLines = extractScheduleSummary(data);
  const textParts = [
    `Dear ${applicantName},`,
    "",
    isApproved
      ? `Peace be with you! We are pleased to inform you that your ${typeLabel} application (Reference: ${referenceCode}) has been CONFIRMED by the Parish Office.`
      : `Peace be with you. Thank you for submitting your ${typeLabel} application (Reference: ${referenceCode}). After review, your application has been DECLINED at this time.`
  ];

  if (scheduleLines.length) {
    textParts.push("", "Application Schedule:", ...scheduleLines.map(item => `- ${item.label}: ${item.value}`));
  }

  if (note) {
    textParts.push("", "Parish Office Note:", note);
  }

  textParts.push(
    "",
    isApproved
      ? "Please keep your reference code and bring any required original documents when visiting the parish office."
      : "If you have questions or wish to update and resubmit your requirements, please contact the parish office.",
    "",
    PARISH_NAME,
    PARISH_ADDRESS,
    `Phone: ${PARISH_CONTACT}`,
    `Email: ${PARISH_EMAIL}`
  );

  const htmlBody = buildHtmlEmail({
    applicantName,
    typeLabel,
    referenceCode,
    isApproved,
    decisionLabel,
    note,
    scheduleLines
  });

  MailApp.sendEmail({
    to,
    subject,
    body: textParts.join("\n"),
    htmlBody,
    name: PARISH_NAME,
    replyTo: PARISH_EMAIL
  });

  return {
    ok: true,
    to,
    status,
    referenceCode,
    remainingQuota: MailApp.getRemainingDailyQuota()
  };
}

function extractScheduleSummary(data) {
  const keys = [
    "Appointment date",
    "Appointment time",
    "Date of marriage",
    "Baptism date",
    "Preferred time",
    "Preferred funeral date",
    "Preferred funeral time",
    "Date of Mass",
    "Time of Mass"
  ];
  return keys
    .filter(key => data && data[key])
    .map(key => ({ label: key, value: String(data[key]) }));
}

function buildHtmlEmail({ applicantName, typeLabel, referenceCode, isApproved, decisionLabel, note, scheduleLines }) {
  const badgeBg = isApproved ? "#e6f2eb" : "#fbe8e5";
  const badgeColor = isApproved ? "#2f6b48" : "#9b3928";
  const statusBorder = isApproved ? "#4d8664" : "#a34a3b";

  const scheduleHtml = scheduleLines.length
    ? `<div style="margin:16px 0;padding:14px 16px;background:#faf5ec;border:1px solid #d9c7b5;border-radius:8px;">
        <div style="font-weight:700;color:#6b4129;margin-bottom:8px;">Submitted Schedule</div>
        ${scheduleLines.map(item => `<div style="margin:4px 0;font-size:14px;color:#3a2216;"><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.value)}</div>`).join("")}
      </div>`
    : "";

  const noteHtml = note
    ? `<div style="margin:16px 0;padding:14px 16px;background:#fff8eb;border-left:4px solid #b8892d;border-radius:6px;">
        <div style="font-weight:700;color:#6b4129;margin-bottom:4px;">Parish Office Note</div>
        <div style="white-space:pre-line;color:#3a2216;font-size:14px;">${escapeHtml(note)}</div>
      </div>`
    : "";

  return `
  <div style="margin:0;padding:24px;background:#f6efe3;font-family:Arial,Helvetica,sans-serif;color:#3a2216;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #d9c7b5;border-top:5px solid ${statusBorder};border-radius:10px;padding:28px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#b8892d;">${escapeHtml(PARISH_NAME)}</div>
      <h1 style="margin:8px 0 12px;font-size:24px;color:#6b4129;">Application ${escapeHtml(decisionLabel)}</h1>
      <span style="display:inline-block;padding:5px 12px;border-radius:999px;background:${badgeBg};color:${badgeColor};font-weight:700;font-size:13px;">
        ${escapeHtml(typeLabel)} &middot; Ref ${escapeHtml(referenceCode)}
      </span>
      <p style="margin:18px 0 12px;font-size:15px;line-height:1.6;">Dear <strong>${escapeHtml(applicantName)}</strong>,</p>
      <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">
        ${isApproved
          ? `Peace be with you! We are pleased to inform you that your <strong>${escapeHtml(typeLabel)}</strong> application (Reference: <strong>${escapeHtml(referenceCode)}</strong>) has been <strong>confirmed</strong> by the parish office.`
          : `Peace be with you. Thank you for submitting your <strong>${escapeHtml(typeLabel)}</strong> application (Reference: <strong>${escapeHtml(referenceCode)}</strong>). After review, your application has been <strong>declined</strong> at this time.`}
      </p>
      ${scheduleHtml}
      ${noteHtml}
      <p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#6f5b4d;">
        ${isApproved
          ? "Please keep your reference code and bring any required original documents when visiting the parish office."
          : "If you have any questions or would like to update and resubmit your requirements, please contact our parish office."}
      </p>
      <hr style="border:0;border-top:1px dashed #d9c7b5;margin:22px 0;">
      <div style="font-size:13px;line-height:1.6;color:#6f5b4d;">
        <strong style="color:#6b4129;">${escapeHtml(PARISH_NAME)}</strong><br>
        ${escapeHtml(PARISH_ADDRESS)}<br>
        Phone: ${escapeHtml(PARISH_CONTACT)} &middot; Email: ${escapeHtml(PARISH_EMAIL)}
      </div>
    </div>
  </div>`;
}

function decodeFirestoreMap(fields) {
  const result = {};
  Object.keys(fields || {}).forEach(key => {
    result[key] = decodeFirestoreValue(fields[key]);
  });
  return result;
}

function decodeFirestoreValue(val) {
  if (!val || typeof val !== "object") return null;
  if ("stringValue" in val) return val.stringValue;
  if ("integerValue" in val) return Number(val.integerValue);
  if ("doubleValue" in val) return Number(val.doubleValue);
  if ("booleanValue" in val) return Boolean(val.booleanValue);
  if ("timestampValue" in val) return val.timestampValue;
  if ("nullValue" in val) return null;
  if ("mapValue" in val) return decodeFirestoreMap((val.mapValue && val.mapValue.fields) || {});
  if ("arrayValue" in val) {
    return ((val.arrayValue && val.arrayValue.values) || []).map(decodeFirestoreValue);
  }
  return null;
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
