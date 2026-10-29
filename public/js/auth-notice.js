/**
 * auth-notice.js
 * ---------------------------------------------------------------------------------------------
 * The login / register pages are rendered by the server (EJS). When the server wants to tell the
 * user something — "Invalid email or password", "Google sign-in was cancelled", "Account
 * created!" — it puts the text in a hidden <div id="authNotice" data-message="...">.
 * This script reads that div and shows the text as a small toast in the corner, so the page
 * layout itself does not change.
 */
(() => {
  const holder = document.getElementById("authNotice");
  if (!holder) return;

  // A success text (e.g. after registering) wins over an error text.
  const success = holder.dataset.success;
  const message = success || holder.dataset.message;
  if (!message) return;
  const isSuccess = Boolean(success);

  const toast = document.createElement("div");
  toast.setAttribute("role", "alert");
  toast.textContent = message;
  Object.assign(toast.style, {
    position: "fixed", top: "18px", left: "50%", transform: "translate(-50%,-20px)",
    zIndex: "9999", maxWidth: "min(420px, calc(100vw - 28px))", padding: "13px 18px",
    borderRadius: "14px", font: "600 13px Inter, system-ui, sans-serif", textAlign: "center",
    color: "#fff", opacity: "0", transition: "all .35s ease", boxShadow: "0 18px 50px rgba(0,0,0,.45)",
    background: isSuccess ? "rgba(22,120,84,.96)" : "rgba(170,40,70,.96)",
    border: "1px solid rgba(255,255,255,.18)"
  });
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = "1"; toast.style.transform = "translate(-50%,0)"; });
  setTimeout(() => { toast.style.opacity = "0"; setTimeout(() => toast.remove(), 400); }, 5500);

  // Drop ?notice=... from the address bar so a refresh does not show the toast again.
  if (location.search.includes("notice=")) history.replaceState(null, "", location.pathname);
})();
