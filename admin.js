import * as F from "./fb.js";

const { db, st, auth } = F;
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
const statuses = ["pending", "approved", "rejected"];
const day = 24 * 60 * 60 * 1000;
let all = [];
let currentType = "all";
let currentStatus = "all";
let search = "";

const dateOf = submission => submission.createdAt?.toDate ? submission.createdAt.toDate() : null;
const dateText = date => date ? date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Date unavailable";
const code = submission => submission.id.slice(0, 8).toUpperCase();
const age = submission => dateOf(submission) ? Math.floor((Date.now() - dateOf(submission).getTime()) / day) : 0;
const labelStatus = submission => submission.status === "pending" && age(submission) >= 3 ? `Delayed for ${age(submission)} days` : submission.status;
const isAuthorizedAdmin = async user => {
  const [admins, admin] = await Promise.all([
    F.getDoc(F.doc(db, "admins", user.uid)).catch(() => null),
    F.getDoc(F.doc(db, "admin", user.uid)).catch(() => null)
  ]);
  return admins?.exists() || admin?.exists();
};

function filtered() {
  const query = search.toLowerCase();
  return all.filter(submission => {
    const matchesType = currentType === "all" || submission.type === currentType;
    const matchesStatus = currentStatus === "all" || submission.status === currentStatus;
    const matchesSearch = !query || [submission.who, submission.contact, submission.id].some(value => String(value ?? "").toLowerCase().includes(query));
    return matchesType && matchesStatus && matchesSearch;
  }).sort((a, b) => (dateOf(a)?.getTime() ?? Infinity) - (dateOf(b)?.getTime() ?? Infinity));
}

function render() {
  const records = filtered();
  $("#record-count").textContent = `${records.length} record${records.length === 1 ? "" : "s"}`;
  $("#records").innerHTML = records.length ? records.map((submission, index) => {
    const delayed = labelStatus(submission).startsWith("Delayed");
    return `<article class="record-card">
      <div class="record-rank">${index + 1}</div>
      <div class="record-content"><div class="record-topline"><span class="record-type">${escape(types[submission.type])}</span><span class="status-badge${delayed ? " delayed" : ""}">${escape(labelStatus(submission))}</span></div>
      <h2>${escape(submission.who || "Unnamed applicant")}</h2>
      <p>Reference <b>${code(submission)}</b> &middot; ${escape(submission.contact || "No contact provided")}<br>Submitted ${escape(dateText(dateOf(submission)))}</p></div>
      <div class="record-actions"><a class="pbtn" href="#${submission.type}/${submission.id}">View details</a>${submission.status === "pending" ? `<button class="pbtn confirm-btn" data-action="approve" data-id="${submission.id}">Confirm</button><button class="pbtn decline-btn" data-action="reject" data-id="${submission.id}">Decline</button>` : ""}</div>
    </article>`;
  }).join("") : `<div class="empty-queue">No matching submissions.</div>`;
  document.querySelectorAll("[data-action]").forEach(button => button.addEventListener("click", () => updateStatus(button.dataset.id, button.dataset.action)));
}

async function updateStatus(id, action) {
  const status = action === "approve" ? "approved" : "rejected";
  const message = status === "approved" ? "Confirm this application?" : "Decline this application?";
  if (!confirm(message)) return;
  try {
    await F.updateDoc(F.doc(db, "submissions", id), { status, reviewedAt: F.serverTimestamp() });
  } catch (error) {
    alert(`Could not update the application: ${error.message}`);
  }
}

function renderRecord(id) {
  const submission = all.find(item => item.id === id);
  if (!submission) {
    $("#record-detail").innerHTML = "<p>Record not found.</p>";
    return;
  }
  const files = submission.files || [];
  $("#record-detail").innerHTML = `<a class="back-link" href="#records">&larr; Back to records</a><div class="detail-heading"><div><span class="record-type">${escape(types[submission.type])}</span><h1>${escape(submission.who || "Unnamed applicant")}</h1><p>Reference ${code(submission)} &middot; Submitted ${escape(dateText(dateOf(submission)))}</p></div><span class="status-badge">${escape(labelStatus(submission))}</span></div><div class="detail-grid"><section class="panel"><h2>Application details</h2><dl class="dl">${Object.entries(submission.data || {}).map(([key, value]) => `<dt>${escape(key)}</dt><dd>${escape(value)}</dd>`).join("")}</dl></section><section class="panel"><h2>Uploaded requirements</h2><ul>${files.map((file, index) => `<li>${escape(file.label)}: <a id="file-${index}" target="_blank" rel="noopener">Open file</a></li>`).join("") || "<li>No files uploaded.</li>"}</ul></section></div><section class="panel review-panel"><h2>Review decision</h2><label>Status<select id="detail-status">${statuses.map(status => `<option value="${status}"${status === submission.status ? " selected" : ""}>${status}</option>`).join("")}</select></label><label>Admin note<textarea id="detail-note" rows="4">${escape(submission.note)}</textarea></label><button class="pbtn" id="save-review">Save review</button> <button class="pbtn decline-btn" id="delete-record">Delete record</button><span id="review-message" class="note"></span></section>`;
  files.forEach((file, index) => F.getDownloadURL(F.ref(st, file.path)).then(url => $(`#file-${index}`).href = url).catch(() => $(`#file-${index}`).textContent = "File unavailable"));
  $("#save-review").onclick = async () => {
    await F.updateDoc(F.doc(db, "submissions", id), { status: $("#detail-status").value, note: $("#detail-note").value, reviewedAt: F.serverTimestamp() });
    $("#review-message").textContent = "Review saved.";
  };
  $("#delete-record").onclick = async () => {
    if (!confirm("Delete this record and its uploaded files permanently?")) return;
    await Promise.all(files.map(file => F.deleteObject(F.ref(st, file.path)).catch(() => null)));
    await F.deleteDoc(F.doc(db, "submissions", id));
    location.hash = "#records";
  };
}

function route() {
  const [view, id] = (location.hash || "#records").slice(1).split("/");
  document.querySelectorAll(".side a[href^='#']").forEach(link => link.classList.toggle("on", link.hash === `#${view}`));
  $("#record-list").hidden = view !== "records" || Boolean(id);
  $("#record-detail").hidden = view !== "records" || !id;
  if (id) renderRecord(id); else render();
}

$("#record-type").onchange = event => { currentType = event.target.value; render(); };
$("#record-status").onchange = event => { currentStatus = event.target.value; render(); };
$("#record-search").oninput = event => { search = event.target.value; render(); };
$("#out").onclick = event => { event.preventDefault(); F.signOut(auth); };

F.onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = "index.html#admin-login"; return; }
  if (!await isAuthorizedAdmin(user)) { await F.signOut(auth); window.location.href = "index.html#admin-login"; return; }
  F.onSnapshot(F.query(F.collection(db, "submissions"), F.orderBy("createdAt", "asc")), snapshot => {
    all = snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
    route();
  }, error => { $("#records").innerHTML = `<div class="msg err">Could not load submissions: ${escape(error.message)}</div>`; });
});
addEventListener("hashchange", route);
