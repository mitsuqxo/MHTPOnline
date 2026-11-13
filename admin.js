import * as F from "./fb.js";
import {
  TYPES,
  STATUS_OPTIONS,
  escape,
  timestampToDate,
  formatDateTime,
  code,
  getApplicantEmail,
  statusInfo,
  notificationSummary,
  isAuthorizedAdmin
} from "./admin-shared.js";
import {
  DEFAULT_APPS_SCRIPT_URL,
  getAppsScriptUrl,
  saveAppsScriptUrl,
  testAppsScriptConnection,
  buildNotificationEmail,
  sendGmailNotification
} from "./gmail-notify.js";

const { db, st, auth } = F;
const $ = selector => document.querySelector(selector);

let all = [];
let loaded = false;
let currentType = "all";
let currentStatus = "all";
let search = "";

function clearBanner() {
  const banner = $("#admin-status");
  banner.hidden = true;
  banner.className = "msg";
  banner.innerHTML = "";
}

function showBanner(kind, messageHtml) {
  const banner = $("#admin-status");
  banner.className = kind ? `msg ${kind}` : "msg";
  banner.innerHTML = messageHtml;
  banner.hidden = false;
  banner.querySelectorAll("[data-open-gmail-setup]").forEach(btn => {
    btn.addEventListener("click", () => openGmailSetup());
  });
  if (typeof banner.scrollIntoView === "function") {
    banner.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function showNotificationBanner(status, notifyResult, submission) {
  const decisionWord = status === "approved" ? "confirmed" : status === "rejected" ? "declined" : "updated";
  const ref = code(submission);

  if (!notifyResult) {
    showBanner("ok", `Application <strong>${escape(ref)}</strong> ${decisionWord} and saved.`);
    return;
  }

  if (notifyResult.ok) {
    showBanner(
      "ok",
      `Application <strong>${escape(ref)}</strong> ${decisionWord}. Gmail notification sent to <strong>${escape(notifyResult.to)}</strong>.`
    );
    return;
  }

  if (notifyResult.reason === "no_email") {
    showBanner(
      "warn",
      `Application <strong>${escape(ref)}</strong> ${decisionWord}. No email address was provided on this submission, so no Gmail notification was sent.`
    );
    return;
  }

  if (notifyResult.reason === "not_configured") {
    showBanner(
      "warn",
      `<div class="banner-row">
        <span>Application <strong>${escape(ref)}</strong> ${decisionWord}. Automatic Gmail sending is not configured yet.</span>
        <span class="banner-actions">
          <a class="pbtn pbtn-sm" href="${escape(notifyResult.composeUrl)}" target="_blank" rel="noopener">Open in Gmail</a>
          <button type="button" class="pbtn pbtn-sm confirm-btn" data-open-gmail-setup>Gmail setup</button>
        </span>
      </div>`
    );
    return;
  }

  showBanner(
    "err",
    `<div class="banner-row">
      <span>Application <strong>${escape(ref)}</strong> ${decisionWord}, but Gmail notification failed: ${escape(notifyResult.error)}</span>
      <span class="banner-actions">
        ${notifyResult.composeUrl ? `<a class="pbtn pbtn-sm" href="${escape(notifyResult.composeUrl)}" target="_blank" rel="noopener">Open in Gmail</a>` : ""}
        <button type="button" class="pbtn pbtn-sm" data-open-gmail-setup>Gmail setup</button>
      </span>
    </div>`
  );
}

function filtered() {
  const query = search.trim().toLowerCase();
  return all.filter(submission => {
    const matchesType = currentType === "all" || submission.type === currentType;
    const matchesStatus = currentStatus === "all" || submission.status === currentStatus;
    const email = getApplicantEmail(submission);
    const matchesSearch = !query || [
      submission.who,
      submission.contact,
      email,
      submission.id,
      code(submission)
    ].some(value => String(value ?? "").toLowerCase().includes(query));
    return matchesType && matchesStatus && matchesSearch;
  }).sort((a, b) => (timestampToDate(a.createdAt)?.getTime() ?? Infinity) - (timestampToDate(b.createdAt)?.getTime() ?? Infinity));
}

function updateRecordCount(count) {
  $("#record-count").textContent = `${count} record${count === 1 ? "" : "s"}`;
}

function render() {
  const records = filtered();
  updateRecordCount(records.length);
  $("#records").innerHTML = records.length ? records.map((submission, index) => {
    const stInfo = statusInfo(submission);
    const notify = notificationSummary(submission);
    const email = getApplicantEmail(submission);
    const detailHref = `#${submission.type || "records"}/${submission.id}`;
    return `<article class="record-card">
      <div class="record-rank">${index + 1}</div>
      <div class="record-content">
        <div class="record-topline">
          <span class="record-type">${escape(TYPES[submission.type] || "Application")}</span>
          <span class="status-badge ${stInfo.badgeClass}">${escape(stInfo.label)}</span>
          <span class="notify-pill notify-${escape(notify.state)}">${escape(notify.badgeLabel)}</span>
        </div>
        <h2>${escape(submission.who || "Unnamed applicant")}</h2>
        <p>Reference <b>${escape(code(submission))}</b> &middot; ${escape(submission.contact || "No contact provided")}${email ? ` &middot; ${escape(email)}` : ""}<br>Submitted ${escape(formatDateTime(timestampToDate(submission.createdAt)))}</p>
      </div>
      <div class="record-actions">
        <a class="pbtn" href="${escape(detailHref)}">View details</a>
        ${submission.status === "pending" ? `<button class="pbtn confirm-btn" data-action="approve" data-id="${escape(submission.id)}">Confirm</button><button class="pbtn decline-btn" data-action="reject" data-id="${escape(submission.id)}">Decline</button>` : ""}
      </div>
    </article>`;
  }).join("") : `<div class="empty-queue">${loaded ? "No matching submissions." : "Loading submissions..."}</div>`;

  document.querySelectorAll("[data-action]").forEach(button => {
    button.addEventListener("click", () => updateStatus(button.dataset.id, button.dataset.action, button));
  });
}

async function updateStatus(id, action, triggerButton) {
  const submission = all.find(item => item.id === id);
  if (!submission) return;

  const status = action === "approve" ? "approved" : "rejected";
  const email = getApplicantEmail(submission);
  const message = email
    ? (status === "approved"
      ? `Confirm this application and send a Gmail notification to ${email}?`
      : `Decline this application and send a Gmail notification to ${email}?`)
    : (status === "approved" ? "Confirm this application?" : "Decline this application?");
  if (!confirm(message)) return;

  const cardButtons = triggerButton?.closest(".record-actions")?.querySelectorAll("button") || [];
  cardButtons.forEach(btn => { btn.disabled = true; });

  try {
    await F.updateDoc(F.doc(db, "submissions", id), {
      status,
      reviewedAt: F.serverTimestamp()
    });
    const notifyResult = await sendGmailNotification({
      auth,
      db,
      submission: { ...submission, status },
      status
    });
    showNotificationBanner(status, notifyResult, submission);
  } catch (error) {
    cardButtons.forEach(btn => { btn.disabled = false; });
    showBanner("err", `Could not update the application: ${escape(error.message)}`);
  }
}

function renderRecord(id) {
  if (!loaded) {
    $("#record-detail").innerHTML = `<div class="empty-queue">Loading application overview...</div>`;
    return;
  }

  const submission = all.find(item => item.id === id);
  if (!submission) {
    $("#record-detail").innerHTML = `<a class="back-link" href="#records">&larr; Back to records</a><div class="empty-queue">Record not found.</div>`;
    return;
  }

  const files = submission.files || [];
  const stInfo = statusInfo(submission);
  const email = getApplicantEmail(submission);
  const notify = notificationSummary(submission);
  const submittedDate = timestampToDate(submission.createdAt);
  const reviewedDate = timestampToDate(submission.reviewedAt);
  const previewStatus = submission.status === "rejected" ? "rejected" : "approved";
  const { gmailComposeUrl } = buildNotificationEmail(submission, previewStatus);
  const isFinalDecision = submission.status === "approved" || submission.status === "rejected";
  const shouldAutoCheckNotify = Boolean(email && isFinalDecision && notify.state !== "sent");

  $("#record-detail").innerHTML = `
    <a class="back-link" href="#records">&larr; Back to records</a>
    <div class="detail-heading">
      <div>
        <span class="record-type">${escape(TYPES[submission.type] || "Application")}</span>
        <h1>${escape(submission.who || "Unnamed applicant")}</h1>
        <p>Reference ${escape(code(submission))} &middot; Submitted ${escape(formatDateTime(submittedDate))}</p>
      </div>
      <span class="status-badge ${stInfo.badgeClass}">${escape(stInfo.label)}</span>
    </div>

    <section class="panel overview-panel" aria-labelledby="overview-heading">
      <div class="overview-header">
        <h2 id="overview-heading">Status &amp; notification overview</h2>
        <span class="notify-pill notify-${escape(notify.state)}">${escape(notify.badgeLabel)}</span>
      </div>
      <dl class="overview-grid">
        <div>
          <dt>Current status</dt>
          <dd><span class="status-badge ${stInfo.badgeClass}">${escape(stInfo.label)}</span></dd>
        </div>
        <div>
          <dt>Submitted on</dt>
          <dd>${escape(formatDateTime(submittedDate))}</dd>
        </div>
        <div>
          <dt>Reviewed on</dt>
          <dd>${reviewedDate ? escape(formatDateTime(reviewedDate)) : "Not reviewed yet"}</dd>
        </div>
        <div>
          <dt>Contact number</dt>
          <dd>${escape(submission.contact || "Not provided")}</dd>
        </div>
        <div>
          <dt>Email address</dt>
          <dd>${email ? `<a href="mailto:${escape(email)}">${escape(email)}</a>` : "Not provided"}</dd>
        </div>
        <div>
          <dt>Admin note</dt>
          <dd>${submission.note ? escape(submission.note) : "No admin note yet"}</dd>
        </div>
        <div class="overview-wide">
          <dt>Gmail notification</dt>
          <dd class="overview-notify-cell">
            <span>${escape(notify.detail)}</span>
            <span class="overview-notify-actions">
              ${email && isFinalDecision ? `<button type="button" class="pbtn pbtn-sm" id="resend-gmail">${notify.state === "sent" ? "Resend Gmail notification" : "Send Gmail notification"}</button>` : ""}
              ${email ? `<a class="pbtn pbtn-sm" href="${escape(gmailComposeUrl)}" target="_blank" rel="noopener">Open in Gmail</a>` : ""}
              ${notify.state === "not_configured" || notify.state === "failed" ? `<button type="button" class="pbtn pbtn-sm" id="detail-gmail-setup">Gmail setup</button>` : ""}
            </span>
          </dd>
        </div>
      </dl>
    </section>

    <div class="detail-grid">
      <section class="panel">
        <h2>Application details</h2>
        <dl class="dl">${Object.entries(submission.data || {}).map(([key, value]) => `<dt>${escape(key)}</dt><dd>${escape(value)}</dd>`).join("") || "<dt>Details</dt><dd>No details recorded.</dd>"}</dl>
      </section>
      <section class="panel">
        <h2>Uploaded requirements</h2>
        <ul>${files.map((file, index) => `<li>${escape(file.label)}: <a id="file-${index}" target="_blank" rel="noopener">Open file</a></li>`).join("") || "<li>No files uploaded.</li>"}</ul>
      </section>
    </div>

    <section class="panel review-panel">
      <h2>Review decision</h2>
      <label>Status
        <select id="detail-status">
          ${STATUS_OPTIONS.map(option => `<option value="${option.value}"${option.value === submission.status ? " selected" : ""}>${option.label}</option>`).join("")}
        </select>
      </label>
      <label>Admin note
        <textarea id="detail-note" rows="4">${escape(submission.note)}</textarea>
      </label>
      <label class="checkbox-row">
        <input type="checkbox" id="detail-notify"${shouldAutoCheckNotify ? " checked" : ""}${!email || !isFinalDecision ? " disabled" : ""}>
        <span>${email ? `Send Gmail notification to ${escape(email)} on save (Confirmed/Declined)` : "No applicant email on file for Gmail notification"}</span>
      </label>
      <div class="review-actions">
        <button class="pbtn confirm-btn" type="button" id="save-review">Save review</button>
        <button class="pbtn decline-btn" type="button" id="delete-record">Delete record</button>
      </div>
    </section>
  `;

  files.forEach((file, index) => {
    F.getDownloadURL(F.ref(st, file.path))
      .then(url => {
        const link = $(`#file-${index}`);
        if (link) link.href = url;
      })
      .catch(() => {
        const link = $(`#file-${index}`);
        if (link) link.textContent = "File unavailable";
      });
  });

  const detailStatus = $("#detail-status");
  const detailNotify = $("#detail-notify");
  detailStatus.onchange = () => {
    const next = detailStatus.value;
    const eligible = Boolean(email) && (next === "approved" || next === "rejected");
    detailNotify.disabled = !eligible;
    if (!eligible) {
      detailNotify.checked = false;
    } else if (next !== submission.status || notify.state !== "sent") {
      detailNotify.checked = true;
    }
  };

  $("#detail-gmail-setup")?.addEventListener("click", () => openGmailSetup());

  $("#resend-gmail")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Sending...";
    const notifyResult = await sendGmailNotification({
      auth,
      db,
      submission,
      status: submission.status,
      note: submission.note
    });
    showNotificationBanner(submission.status, notifyResult, submission);
    button.disabled = false;
  });

  $("#save-review").onclick = async () => {
    const saveButton = $("#save-review");
    const nextStatus = $("#detail-status").value;
    const nextNote = $("#detail-note").value.trim();
    const shouldSend = $("#detail-notify").checked && (nextStatus === "approved" || nextStatus === "rejected");

    saveButton.disabled = true;
    saveButton.textContent = "Saving...";
    try {
      await F.updateDoc(F.doc(db, "submissions", id), {
        status: nextStatus,
        note: nextNote,
        reviewedAt: F.serverTimestamp()
      });

      let notifyResult = null;
      if (shouldSend) {
        notifyResult = await sendGmailNotification({
          auth,
          db,
          submission: { ...submission, status: nextStatus, note: nextNote },
          status: nextStatus,
          note: nextNote
        });
      }
      showNotificationBanner(nextStatus, notifyResult, submission);
    } catch (error) {
      showBanner("err", `Could not save review: ${escape(error.message)}`);
    } finally {
      if (document.body.contains(saveButton)) {
        saveButton.disabled = false;
        saveButton.textContent = "Save review";
      }
    }
  };

  $("#delete-record").onclick = async () => {
    if (!confirm("Delete this record and its uploaded files permanently?")) return;
    const deleteButton = $("#delete-record");
    deleteButton.disabled = true;
    try {
      await Promise.all(files.map(file => F.deleteObject(F.ref(st, file.path)).catch(() => null)));
      await F.deleteDoc(F.doc(db, "submissions", id));
      showBanner("ok", `Record <strong>${escape(code(submission))}</strong> deleted.`);
      location.hash = "#records";
    } catch (error) {
      deleteButton.disabled = false;
      showBanner("err", `Could not delete record: ${escape(error.message)}`);
    }
  };
}

function parseRoute() {
  const raw = (location.hash || "#records").replace(/^#/, "");
  const parts = raw.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return { mode: "detail", id: parts[1] };
  }
  return { mode: "list", section: parts[0] || "records" };
}

function route() {
  const parsed = parseRoute();
  const isDetail = parsed.mode === "detail";

  $("#records-header").hidden = isDetail;
  $("#record-list").hidden = isDetail;
  $("#record-detail").hidden = !isDetail;

  if (isDetail) {
    renderRecord(parsed.id);
  } else {
    render();
    if (parsed.section === "gmail-setup") {
      openGmailSetup();
    }
  }
}

async function refreshGmailSetupIndicator() {
  const url = await getAppsScriptUrl(db);
  const button = $("#gmail-setup-btn");
  if (!button) return;
  button.textContent = url ? "Gmail connected" : "Gmail setup";
  button.classList.toggle("connected", Boolean(url));
}

async function openGmailSetup() {
  const modal = $("#gmail-setup-modal");
  const input = $("#gmail-script-url");
  const msg = $("#gmail-setup-msg");
  modal.classList.remove("is-closing");
  modal.hidden = false;
  document.body.classList.add("modal-open");
  msg.textContent = "Checking current configuration...";
  input.value = await getAppsScriptUrl(db);
  msg.textContent = input.value
    ? "Automatic Gmail notifications are configured."
    : "Paste your deployed Google Apps Script Web App URL to enable automatic Gmail sending.";
  input.focus();
}

function closeGmailSetup() {
  const modal = $("#gmail-setup-modal");
  if (modal.hidden || modal.classList.contains("is-closing")) return;
  modal.classList.add("is-closing");
  modal.addEventListener("animationend", event => {
    if (event.target !== modal) return;
    modal.hidden = true;
    modal.classList.remove("is-closing");
  }, { once: true });
  document.body.classList.remove("modal-open");
  if (location.hash === "#gmail-setup") {
    history.replaceState(null, "", "#records");
  }
}

$("#gmail-setup-btn").onclick = () => openGmailSetup();
document.querySelectorAll("[data-gmail-close]").forEach(btn => {
  btn.addEventListener("click", closeGmailSetup);
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !$("#gmail-setup-modal").hidden) {
    closeGmailSetup();
  }
});

$("#gmail-test-btn").onclick = async () => {
  const btn = $("#gmail-test-btn");
  const msg = $("#gmail-setup-msg");
  const url = $("#gmail-script-url").value.trim();
  btn.disabled = true;
  msg.textContent = "Testing connection...";
  try {
    const result = await testAppsScriptConnection({ auth, url });
    const quotaText = typeof result.remainingQuota === "number"
      ? ` Remaining daily Gmail quota: ${result.remainingQuota}.`
      : "";
    msg.textContent = `Connected! ${result.message || ""}${quotaText}`;
  } catch (error) {
    msg.textContent = `Connection failed: ${error.message}`;
  } finally {
    btn.disabled = false;
  }
};

$("#gmail-setup-form").onsubmit = async event => {
  event.preventDefault();
  const saveBtn = $("#gmail-save-btn");
  const msg = $("#gmail-setup-msg");
  const url = $("#gmail-script-url").value.trim();
  saveBtn.disabled = true;
  msg.textContent = "Saving...";
  try {
    const res = await saveAppsScriptUrl(db, url);
    await refreshGmailSetupIndicator();
    if (!res.url) {
      msg.textContent = DEFAULT_APPS_SCRIPT_URL.trim()
        ? "Cleared custom override; using the default Gmail Web App URL."
        : "Cleared Gmail Web App URL. Manual 'Open in Gmail' remains available.";
    } else if (res.savedToFirestore) {
      msg.textContent = "Saved! Automatic Gmail notifications are active for all admin sessions.";
    } else {
      msg.textContent = "Saved in this browser. (To share across all devices automatically, set DEFAULT_APPS_SCRIPT_URL in gmail-notify.js or allow admin writes to Firestore settings/email.)";
    }
  } catch (error) {
    msg.textContent = error.message;
  } finally {
    saveBtn.disabled = false;
  }
};

$("#record-type").onchange = event => { currentType = event.target.value; render(); };
$("#record-status").onchange = event => { currentStatus = event.target.value; render(); };
$("#record-search").oninput = event => { search = event.target.value; render(); };
$("#out").onclick = event => { event.preventDefault(); clearBanner(); F.signOut(auth); };

F.onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = "index.html#admin-login"; return; }
  if (!await isAuthorizedAdmin(db, user)) { await F.signOut(auth); window.location.href = "index.html#admin-login"; return; }

  refreshGmailSetupIndicator();

  F.onSnapshot(F.query(F.collection(db, "submissions"), F.orderBy("createdAt", "asc")), snapshot => {
    all = snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
    loaded = true;
    route();
  }, error => {
    loaded = true;
    $("#records").innerHTML = `<div class="msg err">Could not load submissions: ${escape(error.message)}</div>`;
  });
});

addEventListener("hashchange", route);
