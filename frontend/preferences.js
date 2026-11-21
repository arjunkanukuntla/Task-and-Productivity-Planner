(function () {
  const storageKey = "taskPlanner.preferences";
  const defaultSort = "deadline";

  function read() {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === null) return { sort: defaultSort, notice: "" };

      const preferences = JSON.parse(saved);
      if (
        preferences &&
        typeof preferences === "object" &&
        ["deadline", "priority"].includes(preferences.sort)
      ) {
        return { sort: preferences.sort, notice: "" };
      }
      return {
        sort: defaultSort,
        notice: "Saved preferences were invalid. The default order is being used.",
      };
    } catch {
      return {
        sort: defaultSort,
        notice: "Saved preferences could not be read. The default order is being used.",
      };
    }
  }

  function save(sort) {
    if (!["deadline", "priority"].includes(sort)) {
      return "Choose a valid task order.";
    }

    try {
      localStorage.setItem(storageKey, JSON.stringify({ sort }));
      return "";
    } catch {
      return "This browser could not save the preference. Check its storage settings and try again.";
    }
  }

  window.taskPlannerPreferences = { read, save };
})();
