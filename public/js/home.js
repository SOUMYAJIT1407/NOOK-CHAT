/* =========================================================
   NOOK HOME PAGE INTERACTIONS
   - Smooth section navigation
   - Scroll reveal animations
   - Scroll progress bar
   - Back-to-top button
   - Mouse glow
   - Call placeholder
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    const progress = document.getElementById("scrollProgress");
    const backToTop = document.getElementById("backToTop");
    const scrollCue = document.getElementById("scrollCue");
    const callButton = document.getElementById("callComingSoon");
    const cursorGlow = document.getElementById("cursorGlow");

    // Smooth scrolling for every internal #section link.
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
        link.addEventListener("click", (event) => {
            const targetId = link.getAttribute("href");
            const target = document.querySelector(targetId);

            if (!target) return;

            event.preventDefault();
            target.scrollIntoView({ behavior: "smooth", block: "start" });
            history.replaceState(null, "", targetId);
        });
    });

    // Dedicated scroll cue.
    scrollCue?.addEventListener("click", () => {
        document.getElementById("about")?.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    });

    // Scroll progress + back-to-top.
    const updateScrollUI = () => {
        const scrollTop = window.scrollY;
        const scrollable = document.documentElement.scrollHeight - window.innerHeight;
        const percentage = scrollable > 0 ? (scrollTop / scrollable) * 100 : 0;

        if (progress) progress.style.width = `${percentage}%`;
        backToTop?.classList.toggle("visible", scrollTop > 700);
    };

    window.addEventListener("scroll", updateScrollUI, { passive: true });
    updateScrollUI();

    backToTop?.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    });

    // Reveal sections/cards as they enter the viewport.
    const revealItems = document.querySelectorAll(".reveal");

    if ("IntersectionObserver" in window) {
        const revealObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("is-visible");
                observer.unobserve(entry.target);
            });
        }, {
            threshold: 0.12,
            rootMargin: "0px 0px -60px 0px"
        });

        revealItems.forEach((item) => revealObserver.observe(item));
    } else {
        revealItems.forEach((item) => item.classList.add("is-visible"));
    }

    // Subtle pointer glow on desktop.
    if (cursorGlow && window.matchMedia("(pointer: fine)").matches) {
        window.addEventListener("pointermove", (event) => {
            cursorGlow.style.left = `${event.clientX}px`;
            cursorGlow.style.top = `${event.clientY}px`;
            cursorGlow.style.opacity = "1";
        });

        document.addEventListener("mouseleave", () => {
            cursorGlow.style.opacity = "0";
        });
    }

    // Call is intentionally not implemented yet; Messenger is the current focus.
    callButton?.addEventListener("click", () => {
        window.alert("Voice & Video Call is coming soon. Messenger is available now.");
    });
});
