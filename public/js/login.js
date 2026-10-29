document.addEventListener("DOMContentLoaded", () => {

    const form =
        document.getElementById("loginForm");

    const email =
        document.getElementById("email");

    const password =
        document.getElementById("password");

    const passwordToggle =
        document.getElementById("passwordToggle");

    const loginButton =
        document.getElementById("loginButton");

    const forgotPassword =
        document.getElementById("forgotPassword");


    /* =====================================================
       SHOW / HIDE PASSWORD
    ===================================================== */

    passwordToggle.addEventListener("click", () => {

        if (password.type === "password") {

            password.type = "text";

            passwordToggle.textContent =
                "Hide";

        } else {

            password.type = "password";

            passwordToggle.textContent =
                "Show";

        }

    });



    /* =====================================================
       ERROR
    ===================================================== */

    function showError(field, message) {

        const error =
            document.querySelector(
                `[data-error-for="${field.id}"]`
            );

        if (error) {

            error.textContent =
                message;

        }

    }



    /* =====================================================
       CLEAR ERROR
    ===================================================== */

    function clearError(field) {

        const error =
            document.querySelector(
                `[data-error-for="${field.id}"]`
            );

        if (error) {

            error.textContent = "";

        }

    }



    /* =====================================================
       CLEAR ERROR WHILE TYPING
    ===================================================== */

    email.addEventListener("input", () => {

        clearError(email);

    });


    password.addEventListener("input", () => {

        clearError(password);

    });



    /* =====================================================
       LOGIN VALIDATION
    ===================================================== */

    form.addEventListener("submit", (event) => {

        let valid = true;


        const identifier =
            email.value.trim();

        const passwordValue =
            password.value;


        /* USERNAME / EMAIL */

        if (!identifier) {

            showError(
                email,
                "Please enter your username or email."
            );

            valid = false;

        }


        /* PASSWORD */

        if (!passwordValue) {

            showError(
                password,
                "Please enter your password."
            );

            valid = false;

        }
        else if (passwordValue.length < 6) {

            showError(
                password,
                "Password must contain at least 6 characters."
            );

            valid = false;

        }


        /* STOP */

        if (!valid) {

            event.preventDefault();

            return;

        }


        /* =================================================
           LOADING STATE
        ================================================== */

        loginButton.disabled = true;

        loginButton.style.cursor =
            "wait";

        loginButton.style.opacity =
            "0.75";


        loginButton.querySelector(
            ".button-text"
        ).textContent =
            "Logging in...";


        loginButton.querySelector(
            ".button-arrow"
        ).textContent =
            "•••";

    });



    /* =====================================================
       FORGOT PASSWORD
    ===================================================== */

    forgotPassword.addEventListener(
        "click",
        (event) => {

            event.preventDefault();

            alert(
                "Password recovery will be added soon."
            );

        }
    );

});