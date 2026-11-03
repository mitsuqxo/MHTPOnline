import { auth, signInWithEmailAndPassword } from "./fb.js";

const modal = document.querySelector("#admin-login");
const form = document.querySelector("#admin-login-form");
const message = document.querySelector("#admin-login-message");
const email = document.querySelector("#admin-email");
const password = document.querySelector("#admin-password");

const open = () => {
  modal.classList.remove("is-closing");
  modal.hidden = false;
  document.body.classList.add("modal-open");
  document.body.style.overflow = "hidden";
  email.focus();
};

const close = () => {
  if (modal.hidden || modal.classList.contains("is-closing")) return;
  modal.classList.add("is-closing");
  modal.addEventListener("animationend", event => {
    if (event.target !== modal) return;
    modal.hidden = true;
    modal.classList.remove("is-closing");
  }, { once: true });
  document.body.classList.remove("modal-open");
  document.body.style.overflow = "";
  message.textContent = "";
};

document.querySelectorAll("[data-admin-login]").forEach(link => {
  link.addEventListener("click", event => {
    event.preventDefault();
    open();
  });
});

document.querySelectorAll("[data-admin-close]").forEach(button => {
  button.addEventListener("click", close);
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  message.textContent = "Signing in...";
  try {
    await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
    window.location.href = "dashboard.html";
  } catch {
    message.textContent = "Sign-in failed. Check your email and password.";
    button.disabled = false;
  }
});

if (location.hash === "#admin-login") open();
