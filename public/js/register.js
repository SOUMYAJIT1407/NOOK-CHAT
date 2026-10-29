// =========================================
// NOOK - REGISTRATION JAVASCRIPT
// =========================================


// =========================================
// GET FORM ELEMENTS
// =========================================

const form = document.getElementById("registerForm");

const usernameInput =
    document.getElementById("username");

const emailInput =
    document.getElementById("email");

const passwordInput =
    document.getElementById("password");

const confirmPasswordInput =
    document.getElementById("confirmPassword");

const termsInput =
    document.getElementById("terms");


// =========================================
// ERROR MESSAGE FUNCTION
// =========================================

function showError(id, message) {

    const element =
        document.querySelector(
            `[data-error-for="${id}"]`
        );

    if (element) {

        element.textContent = message;

    }

}


// =========================================
// CLEAR ERROR MESSAGES
// =========================================

function clearErrors() {

    document
        .querySelectorAll("[data-error-for]")
        .forEach(element => {

            element.textContent = "";

        });

}


// =========================================
// SHOW / HIDE PASSWORD
// =========================================

const toggleButtons =
    document.querySelectorAll(".toggle");


toggleButtons.forEach(button => {

    button.addEventListener("click", function () {

        const targetId =
            this.getAttribute("data-target");


        const input =
            document.getElementById(targetId);


        if (!input) {

            return;

        }


        // Password → Text

        if (input.type === "password") {

            input.type = "text";

            this.textContent = "Hide";

        }


        // Text → Password

        else {

            input.type = "password";

            this.textContent = "Show";

        }

    });

});


// =========================================
// PASSWORD REQUIREMENT ELEMENTS
// =========================================

const ruleLetters =
    document.getElementById("rule-letters");

const ruleCapital =
    document.getElementById("rule-capital");

const ruleSpecial =
    document.getElementById("rule-special");


// =========================================
// UPDATE PASSWORD RULE UI
// =========================================

function updatePasswordRule(
    element,
    valid
) {

    if (!element) {

        return;

    }


    const icon =
        element.querySelector(".rule-icon");


    if (valid) {

        element.classList.add("valid");

        if (icon) {

            icon.textContent = "✓";

        }

    }

    else {

        element.classList.remove("valid");

        if (icon) {

            icon.textContent = "✕";

        }

    }

}


// =========================================
// PASSWORD STRENGTH METER
// =========================================
//
// Turns a password into a level from 0 to 4 and paints the 4-bar meter:
//   0 = empty, 1 = Weak, 2 = Fair, 3 = Good, 4 = Strong
//
// Points are earned for length (6 / 10 / 14+ characters) and for mixing character types
// (lowercase, uppercase, digits, symbols). Obvious patterns (aaa, 1234, "password"...) lose
// points. A password that does not yet satisfy the three required rules can never rate above
// "Fair", so the meter never says "Strong" for something the server would reject.

const strengthMeter =
    document.getElementById("strengthMeter");

const strengthLabel =
    document.getElementById("strengthLabel");

const STRENGTH_LABELS =
    ["Enter a password", "Weak", "Fair", "Good", "Strong"];


function getStrengthLevel(password, meetsRequiredRules) {

    if (!password) {

        return 0;

    }

    let points = 0;

    // Length
    if (password.length >= 6) points++;
    if (password.length >= 10) points++;
    if (password.length >= 14) points++;

    // Variety of character types (each extra type adds a point)
    const types = [
        /[a-z]/.test(password),
        /[A-Z]/.test(password),
        /[0-9]/.test(password),
        /[^A-Za-z0-9]/.test(password)
    ].filter(Boolean).length;

    points += types - 1;

    // Penalties: the same character 3+ times in a row, or very common patterns
    if (/(.)\1{2,}/.test(password)) points--;

    if (/password|qwerty|letmein|12345|abcde|iloveyou/i.test(password)) {

        points = Math.min(points, 1);

    }

    // Points -> level
    let level =
        points <= 2 ? 1 :
        points === 3 ? 2 :
        points === 4 ? 3 : 4;

    // Required rules not met yet -> cap at "Fair"
    if (!meetsRequiredRules) {

        level = Math.min(level, 2);

    }

    return level;

}


function updateStrengthMeter(password, meetsRequiredRules) {

    if (!strengthMeter) {

        return;

    }

    const level =
        getStrengthLevel(password, meetsRequiredRules);

    // The CSS reads data-level to colour the bars
    strengthMeter.dataset.level = level;

    strengthLabel.textContent = STRENGTH_LABELS[level];

}


// =========================================
// CHECK PASSWORD REQUIREMENTS
// =========================================

function checkPasswordRules() {

    const password =
        passwordInput.value;


    // -------------------------------------
    // COUNT LETTERS
    // -------------------------------------

    const letterCount =
        (
            password.match(/[A-Za-z]/g) || []
        ).length;


    const hasThreeLetters =
        letterCount >= 3;


    // -------------------------------------
    // CAPITAL LETTER
    // -------------------------------------

    const hasCapital =
        /[A-Z]/.test(password);


    // -------------------------------------
    // SPECIAL CHARACTER
    // -------------------------------------

    const hasSpecial =
        /[^A-Za-z0-9]/.test(password);


    // -------------------------------------
    // UPDATE UI
    // -------------------------------------

    updatePasswordRule(
        ruleLetters,
        hasThreeLetters
    );


    updatePasswordRule(
        ruleCapital,
        hasCapital
    );


    updatePasswordRule(
        ruleSpecial,
        hasSpecial
    );


    // -------------------------------------
    // UPDATE STRENGTH METER
    // -------------------------------------

    updateStrengthMeter(
        password,
        hasThreeLetters && hasCapital && hasSpecial
    );


    // -------------------------------------
    // RETURN RESULT
    // -------------------------------------

    return {

        letters: hasThreeLetters,

        capital: hasCapital,

        special: hasSpecial

    };

}


// =========================================
// LIVE PASSWORD CHECK
// =========================================

passwordInput.addEventListener(
    "input",
    function () {

        checkPasswordRules();

        checkConfirmPassword();

    }
);


// =========================================
// CONFIRM PASSWORD CHECK
// =========================================

function checkConfirmPassword() {

    const password =
        passwordInput.value;

    const confirmPassword =
        confirmPasswordInput.value;


    // Don't show anything if empty

    if (!confirmPassword) {

        showError(
            "confirmPassword",
            ""
        );

        return;

    }


    // Password match

    if (password === confirmPassword) {

        showError(
            "confirmPassword",
            ""
        );

    }

    else {

        showError(
            "confirmPassword",
            "Passwords do not match."
        );

    }

}


// =========================================
// LIVE CONFIRM PASSWORD CHECK
// =========================================

confirmPasswordInput.addEventListener(
    "input",
    function () {

        checkConfirmPassword();

    }
);


// =========================================
// USERNAME LIVE CHECK
// =========================================

usernameInput.addEventListener(
    "input",
    function () {

        const username =
            this.value.trim();


        if (
            username.length > 0 &&
            username.length < 3
        ) {

            showError(
                "username",
                "Username must contain at least 3 characters."
            );

        }

        else {

            showError(
                "username",
                ""
            );

        }

    }
);


// =========================================
// EMAIL LIVE CHECK
// =========================================

emailInput.addEventListener(
    "input",
    function () {

        const email =
            this.value.trim();


        const emailPattern =
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


        if (
            email.length > 0 &&
            !emailPattern.test(email)
        ) {

            showError(
                "email",
                "Enter a valid email address."
            );

        }

        else {

            showError(
                "email",
                ""
            );

        }

    }
);


// =========================================
// FORM SUBMIT
// =========================================

form.addEventListener(
    "submit",
    function (event) {

        // Clear previous errors

        clearErrors();


        let valid = true;



        // =================================
        // USERNAME VALIDATION
        // =================================

        const username =
            usernameInput.value.trim();


        if (username.length < 3) {

            showError(
                "username",
                "Username must contain at least 3 characters."
            );

            valid = false;

        }



        // =================================
        // EMAIL VALIDATION
        // =================================

        const email =
            emailInput.value.trim();


        const emailPattern =
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


        if (!emailPattern.test(email)) {

            showError(
                "email",
                "Enter a valid email address."
            );

            valid = false;

        }



        // =================================
        // PASSWORD VALIDATION
        // =================================

        const passwordRules =
            checkPasswordRules();


        if (!passwordRules.letters) {

            showError(
                "password",
                "Password must contain at least 3 letters."
            );

            valid = false;

        }

        else if (!passwordRules.capital) {

            showError(
                "password",
                "Password must contain at least 1 capital letter."
            );

            valid = false;

        }

        else if (!passwordRules.special) {

            showError(
                "password",
                "Password must contain at least 1 special character."
            );

            valid = false;

        }



        // =================================
        // CONFIRM PASSWORD
        // =================================

        if (
            passwordInput.value !==
            confirmPasswordInput.value
        ) {

            showError(
                "confirmPassword",
                "Passwords do not match."
            );

            valid = false;

        }



        // =================================
        // TERMS & CONDITIONS
        // =================================

        if (!termsInput.checked) {

            alert(
                "Please accept the Terms and Privacy Policy."
            );

            valid = false;

        }



        // =================================
        // STOP SUBMISSION
        // =================================

        if (!valid) {

            event.preventDefault();

            return;

        }



        // =================================
        // FORM VALID
        // =================================

        console.log(
            "NOOK registration validation successful."
        );

    }
);


// =========================================
// INITIAL PASSWORD STATE
// =========================================

checkPasswordRules();