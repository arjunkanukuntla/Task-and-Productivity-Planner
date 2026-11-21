const profileApp = document.querySelector("#profile-app");
const profileNotice = document.querySelector("#app-notice");
const preferencesForm = document.querySelector("#preferences-form");
const defaultSortInput = document.querySelector("#default-sort");
const preferencesStatus = document.querySelector("#preferences-status");

function showProfileNotice(message) {
  profileNotice.textContent = message;
  profileNotice.hidden = false;
}

function formatMemberSince(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "Not available";
  }
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

async function loadProfile() {
  try {
    const response = await fetch("/api/auth/me", {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    const result = await response.json();
    if (response.status === 401) {
      window.location.replace("/signin.html");
      return;
    }
    if (!response.ok) {
      throw new Error(result.error || "Your account details could not be loaded.");
    }

    const user = result.user;
    document.querySelector("#profile-name").textContent = user.username;
    document.querySelector("#profile-email").textContent = user.email;
    document.querySelector("#profile-member-since").textContent =
      formatMemberSince(user.memberSince);
    document.querySelector("#profile-initials").textContent =
      user.username.trim().slice(0, 1).toUpperCase();
    const preferences = window.taskPlannerPreferences.read();
    defaultSortInput.value = preferences.sort;
    if (preferences.notice) showProfileNotice(preferences.notice);
    profileApp.hidden = false;
  } catch (error) {
    if (error instanceof TypeError) {
      showProfileNotice("Could not connect to the planner server. Please try again.");
    } else {
      showProfileNotice(error.message);
    }
    profileApp.hidden = false;
  }
}

preferencesForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const error = window.taskPlannerPreferences.save(defaultSortInput.value);
  preferencesStatus.textContent = error || "Preference saved for this browser.";
  preferencesStatus.classList.toggle("is-error", Boolean(error));
});

loadProfile();
