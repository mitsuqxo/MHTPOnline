import * as F from "./fb.js";
import {
  TYPES,
  escape,
  timestampToDate,
  formatDateTime,
  code,
  ageInDays,
  getApplicantEmail,
  statusInfo,
  notificationSummary,
  isAuthorizedAdmin
} from "./admin-shared.js";

const { auth, db } = F;
const $ = selector => document.querySelector(selector);
let submissions = [];

function render() {
  const pending = submissions.filter(submission => submission.status === "pending");
  const delayed = pending.filter(submission => ageInDays(timestampToDate(submission.createdAt)) >= 3);
  const approved = submissions.filter(submission => submission.status === "approved").length;
  const rejected = submissions.filter(submission => submission.status === "rejected").length;
  const reviewed = approved + rejected;
  const progress = submissions.length ? Math.round((reviewed / submissions.length) * 100) : 0;

  $("#total-count").textContent = submissions.length;
  $("#pending-count").textContent = pending.length;
  $("#approved-count").textContent = approved;
  $("#delayed-count").textContent = delayed.length;
  $("#progress-percent").textContent = `${progress}%`;
  $("#progress-fill").style.width = `${progress}%`;
  $("#progress-approved").textContent = approved;
  $("#progress-rejected").textContent = rejected;
  $("#progress-pending").textContent = pending.length;
  $("#last-updated").textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;

  const records = submissions.slice().sort((a, b) => (
    (timestampToDate(a.createdAt)?.getTime() ?? Infinity) -
    (timestampToDate(b.createdAt)?.getTime() ?? Infinity)
  ));

  $("#queues").innerHTML = `<section class="queue-section" aria-labelledby="applications-heading">
    <h2 id="applications-heading">All applications</h2>
    ${records.length ? `<div class="queue-list">${records.map((submission, index) => {
      const stInfo = statusInfo(submission);
      const notify = notificationSummary(submission);
      const email = getApplicantEmail(submission);
      const submittedDate = timestampToDate(submission.createdAt);
      const reviewedDate = timestampToDate(submission.reviewedAt);
      const detailHref = `admin.html#${submission.type || "records"}/${submission.id}`;
      return `<article class="queue-item">
        <span class="queue-number">${index + 1}</span>
        <div>
          <div class="application-type">${escape(TYPES[submission.type] || "Application")}</div>
          <h3>${escape(submission.who || "Unnamed applicant")}</h3>
          <p>Reference: ${escape(code(submission))} &middot; ${escape(submission.contact || "No contact provided")}${email ? ` &middot; ${escape(email)}` : ""}</p>
          ${reviewedDate ? `<p class="queue-review-note">Reviewed ${escape(formatDateTime(reviewedDate))}${submission.note ? ` &middot; Note: ${escape(submission.note)}` : ""}</p>` : ""}
        </div>
        <div class="queue-meta">
          <div class="queue-badges">
            <span class="status-badge ${stInfo.badgeClass}">${escape(stInfo.label)}</span>
            <span class="notify-pill notify-${escape(notify.state)}">${escape(notify.badgeLabel)}</span>
          </div>
          <div class="queue-date">Submitted ${escape(formatDateTime(submittedDate))}</div>
          <a class="pbtn pbtn-sm queue-btn" href="${escape(detailHref)}">Review record</a>
        </div>
      </article>`;
    }).join("")}</div>` : `<p class="empty-queue">No applications yet.</p>`}
  </section>`;
}

F.onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = "index.html#admin-login";
    return;
  }
  if (!await isAuthorizedAdmin(db, user)) {
    await F.signOut(auth);
    window.location.href = "index.html#admin-login";
    return;
  }
  F.onSnapshot(F.query(F.collection(db, "submissions"), F.orderBy("createdAt", "asc")), snapshot => {
    submissions = snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
    render();
  }, error => {
    $("#dashboard-status").hidden = false;
    $("#dashboard-status").className = "msg err";
    $("#dashboard-status").textContent = `Could not load submissions: ${error.message}`;
  });
});

$("#sign-out").addEventListener("click", event => {
  event.preventDefault();
  F.signOut(auth);
});

setInterval(render, 60 * 1000);
