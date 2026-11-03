import * as F from "./fb.js";

const { auth, db } = F;
const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? "").replace(/[&<>"]/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"
}[character]));
const types = {
  wedding: "Wedding (Kasal)",
  baptism: "Baptism (Binyag)",
  confirmation: "Confirmation (Kumpil)",
  funeral: "Funeral Mass (Libing)",
  masses: "Masses (Pamisa)"
};
const day = 24 * 60 * 60 * 1000;
let submissions = [];

const isAuthorizedAdmin = async user => {
  const [admins, admin] = await Promise.all([
    F.getDoc(F.doc(db, "admins", user.uid)).catch(() => null),
    F.getDoc(F.doc(db, "admin", user.uid)).catch(() => null)
  ]);
  return admins?.exists() || admin?.exists();
};

const submittedAt = submission => submission.createdAt?.toDate ? submission.createdAt.toDate() : null;
const ageInDays = date => date ? Math.floor((Date.now() - date.getTime()) / day) : 0;
const dateText = date => date ? date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Date unavailable";
const statusText = submission => {
  const age = ageInDays(submittedAt(submission));
  if (submission.status === "pending" && age >= 3) return `Delayed for ${age} days`;
  return submission.status === "approved" ? "Approved" : submission.status === "rejected" ? "Rejected" : "Pending review";
};

function render() {
  const pending = submissions.filter(submission => submission.status === "pending");
  const delayed = pending.filter(submission => ageInDays(submittedAt(submission)) >= 3);
  $("#total-count").textContent = submissions.length;
  $("#pending-count").textContent = pending.length;
  $("#approved-count").textContent = submissions.filter(submission => submission.status === "approved").length;
  $("#delayed-count").textContent = delayed.length;
  const approved = submissions.filter(submission => submission.status === "approved").length;
  const rejected = submissions.filter(submission => submission.status === "rejected").length;
  const reviewed = approved + rejected;
  const progress = submissions.length ? Math.round(reviewed / submissions.length * 100) : 0;
  $("#progress-percent").textContent = `${progress}%`;
  $("#progress-fill").style.width = `${progress}%`;
  $("#progress-approved").textContent = approved;
  $("#progress-rejected").textContent = rejected;
  $("#progress-pending").textContent = pending.length;
  $("#last-updated").textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;

  const records = submissions.slice().sort((a, b) => (submittedAt(a)?.getTime() ?? Infinity) - (submittedAt(b)?.getTime() ?? Infinity));
  $("#queues").innerHTML = `<section class="queue-section" aria-labelledby="applications-heading">
    <h2 id="applications-heading">All applications</h2>
    ${records.length ? `<div class="queue-list">${records.map((submission, index) => {
      const status = statusText(submission);
      const isDelayed = status.startsWith("Delayed");
      return `<article class="queue-item">
        <span class="queue-number">${index + 1}</span>
        <div><div class="application-type">${escape(types[submission.type] || "Application")}</div><h3>${escape(submission.who || "Unnamed applicant")}</h3>
        <p>Reference: ${escape(submission.id.slice(0, 8).toUpperCase())} &middot; ${escape(submission.contact || "No contact provided")}</p></div>
        <div class="queue-meta"><span class="status-badge${isDelayed ? " delayed" : ""}">${escape(status)}</span><br>${escape(dateText(submittedAt(submission)))}<br><a class="queue-link" href="admin.html#${submission.type}/${submission.id}">Review record</a></div>
      </article>`;
    }).join("")}</div>` : `<p class="empty-queue">No applications yet.</p>`}
  </section>`;
}

F.onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = "index.html#admin-login";
    return;
  }
  if (!await isAuthorizedAdmin(user)) {
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
