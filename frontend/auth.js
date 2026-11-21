async function readResponse(response) {
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "The request could not be completed.");
  }
  return result;
}

function showAuthMessage(message) {
  const messageElement = document.querySelector("#auth-message");
  if (messageElement) messageElement.textContent = message;
}

async function handleAuthSubmit(event, endpoint) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]');
  const body = Object.fromEntries(new FormData(form));

  showAuthMessage("");
  submitButton.disabled = true;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    await readResponse(response);
    window.location.assign("/app.html");
  } catch (error) {
    showAuthMessage(
      error instanceof TypeError
        ? "Could not connect to the planner server. Please try again."
        : error.message,
    );
    submitButton.disabled = false;
  }
}

const signInForm = document.querySelector("#signinform");
if (signInForm) {
  signInForm.addEventListener("submit", (event) => {
    handleAuthSubmit(event, "/api/auth/signin");
  });
}

const signUpForm = document.querySelector("#signupform");
if (signUpForm) {
  signUpForm.addEventListener("submit", (event) => {
    handleAuthSubmit(event, "/api/auth/signup");
  });
}

const signOutButton = document.querySelector("#signout-button");
if (signOutButton) {
  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Could not sign out. Please try again.");
      window.location.assign("/signin.html");
    } catch (error) {
      const notice = document.querySelector("#app-notice");
      notice.textContent =
        error instanceof TypeError
          ? "Could not connect to the planner server. Please try again."
          : error.message;
      notice.hidden = false;
      signOutButton.disabled = false;
    }
  });
}

