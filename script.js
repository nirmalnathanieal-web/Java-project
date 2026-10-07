const THEME_KEY = "mediReminderTheme";

const state = {
  medicines: [],
  profile: {},
  user: null,
  currentEditId: null,
  deleteId: null
};
let saveQueue = Promise.resolve();

async function requestApi(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const result = response.status === 204 ? {} : await response.json();
  if (!response.ok) {
    const error = new Error(result.error || "The request could not be completed.");
    error.status = response.status;
    throw error;
  }
  return result;
}

function showAppError(message) {
  console.error(message);
  const errorMessage = document.getElementById("appError");
  if (errorMessage) {
    errorMessage.textContent = message;
    errorMessage.classList.remove("hidden");
  } else {
    window.alert(message);
  }
}

function saveAppData() {
  const snapshot = {
    medicines: state.medicines.map((medicine) => ({ ...medicine })),
    profile: { ...state.profile }
  };
  saveQueue = saveQueue.catch(() => {}).then(() => requestApi("/api/data", {
    method: "PUT",
    body: JSON.stringify(snapshot)
  }));
  saveQueue = saveQueue.catch((error) => {
    showAppError(`Could not save your data: ${error.message}`);
  });
  return saveQueue;
}

function formatDisplayDate(dateString) {
  if (!dateString) return "-";
  const date = new Date(dateString + "T00:00:00");
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatDisplayTime(timeString) {
  if (!timeString) return "-";
  const [hours, minutes] = timeString.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function padTimeValue(value) {
  return String(value).padStart(2, "0");
}

function addMinutesToTime(timeString, minutesToAdd) {
  if (!timeString) return "08:00";
  const [hours, minutes] = timeString.split(":").map(Number);
  const totalMinutes = hours * 60 + minutes + minutesToAdd;
  const normalizedMinutes = ((totalMinutes % 1440) + 1440) % 1440;
  const newHours = Math.floor(normalizedMinutes / 60);
  const newMinutes = normalizedMinutes % 60;
  return `${padTimeValue(newHours)}:${padTimeValue(newMinutes)}`;
}

function getScheduleTimes(medicine) {
  const base = medicine?.time || "08:00";
  const frequency = medicine?.frequency || "Once daily";

  if (frequency === "Twice daily") {
    return [base, addMinutesToTime(base, 12 * 60)];
  }

  if (frequency === "Thrice daily") {
    return [
      base,
      addMinutesToTime(base, 6 * 60),
      addMinutesToTime(base, 12 * 60)
    ];
  }

  return [base];
}

function getDisplayTimeLabel(medicine) {
  const doses = getScheduledDoseDateTimes(medicine);
  if (!doses.length) return "-";
  const startDate = medicine?.date;
  return doses.map((dose) => {
    const time = `${padTimeValue(dose.getHours())}:${padTimeValue(dose.getMinutes())}`;
    const nextDay = getLocalDateKey(dose) !== startDate ? " (next day)" : "";
    return `${formatDisplayTime(time)}${nextDay}`;
  }).join(" • ");
}

function toDateTime(dateString, timeString) {
  return new Date(`${dateString}T${timeString || "00:00"}:00`);
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTodayKey() {
  return getLocalDateKey();
}

function getScheduleOffsets(medicine) {
  if (medicine?.frequency === "Twice daily") return [0, 12 * 60];
  if (medicine?.frequency === "Thrice daily") return [0, 6 * 60, 12 * 60];
  return [0];
}

function getScheduledDoseDateTimes(medicine) {
  const firstDose = toDateTime(medicine.date, medicine.time);
  return getScheduleOffsets(medicine).map((offset) => new Date(firstDose.getTime() + offset * 60000));
}

function getMedicineStatus(medicine) {
  if (medicine.taken) return "taken";

  const now = new Date();
  return getScheduledDoseDateTimes(medicine).some((dose) => dose > now)
    ? "upcoming"
    : "missed";
}

function updateMedicineStatuses() {
  let changed = false;
  state.medicines = state.medicines.map((medicine) => {
    const status = getMedicineStatus(medicine);
    if (medicine.status === status) return medicine;
    changed = true;
    return { ...medicine, status };
  });
  if (changed) saveAppData();
}

function updateHomeStats() {
  const homeStats = document.getElementById("homeStats");
  if (!homeStats) return;

  const total = state.medicines.length;
  const today = getTodayKey();
  const dueToday = state.medicines.filter((item) => item.date === today).length;
  const takenToday = state.medicines.filter((item) => item.date === today && item.taken).length;
  const upcomingCount = state.medicines.filter((item) => getMedicineStatus(item) === "upcoming").length;

  homeStats.innerHTML = `
    <div class="stat-box">
      <span class="stat-label">Total medicines</span>
      <span class="stat-value">${total}</span>
    </div>
    <div class="stat-box">
      <span class="stat-label">Due today</span>
      <span class="stat-value">${dueToday}</span>
    </div>
    <div class="stat-box">
      <span class="stat-label">Taken today</span>
      <span class="stat-value">${takenToday}</span>
    </div>
    <div class="stat-box">
      <span class="stat-label">Upcoming</span>
      <span class="stat-value">${upcomingCount}</span>
    </div>
  `;
}

function renderMedicineCards() {
  const container = document.getElementById("medicineCards");
  const emptyList = document.getElementById("emptyListMsg");
  const searchValue = document.getElementById("searchInput")?.value.trim().toLowerCase() || "";
  const filterDate = document.getElementById("filterDate")?.value || "";

  if (!container) return;

  let filtered = [...state.medicines];

  if (searchValue) {
    filtered = filtered.filter((item) => item.name.toLowerCase().includes(searchValue));
  }

  if (filterDate) {
    filtered = filtered.filter((item) => item.date === filterDate);
  }

  filtered.sort((a, b) => new Date(a.date + "T" + a.time) - new Date(b.date + "T" + b.time));

  if (!filtered.length) {
    container.innerHTML = "";
    emptyList?.classList.remove("hidden");
    return;
  }

  emptyList?.classList.add("hidden");

  container.innerHTML = filtered.map((medicine) => {
    const status = getMedicineStatus(medicine);
    const statusText = status.charAt(0).toUpperCase() + status.slice(1);
    return `
      <article class="medicine-card">
        <div class="medicine-top">
          <div>
            <h3>${medicine.name}</h3>
            <div class="medicine-meta">
              ${medicine.dosage} · ${medicine.type}<br>
              ${formatDisplayDate(medicine.date)} at ${getDisplayTimeLabel(medicine)}
            </div>
          </div>
          <span class="badge ${status}">${statusText}</span>
        </div>

        <div class="medicine-meta" style="margin-top: 14px;">
          <strong>Frequency:</strong> ${medicine.frequency}<br>
          <strong>Notes:</strong> ${medicine.notes || "No additional notes"}
        </div>

        <div class="card-actions">
          <button class="btn btn-primary" data-action="taken" data-id="${medicine.id}">Mark Taken</button>
          <button class="btn btn-ghost" data-action="edit" data-id="${medicine.id}">Edit</button>
          <button class="btn btn-danger" data-action="delete" data-id="${medicine.id}">Delete</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderDashboard() {
  const totalEl = document.getElementById("statTotal");
  const takenEl = document.getElementById("statTaken");
  const upcomingEl = document.getElementById("statUpcoming");
  const missedEl = document.getElementById("statMissed");
  const scheduleList = document.getElementById("todayScheduleList");

  if (!totalEl || !scheduleList) return;

  const todayKey = getTodayKey();
  const todays = state.medicines.filter((item) => item.date === todayKey);
  const taken = todays.filter((item) => item.taken).length;
  const missed = todays.filter((item) => !item.taken && toDateTime(item.date, item.time) < new Date()).length;
  const upcoming = todays.length - taken - missed;

  totalEl.textContent = String(state.medicines.length);
  takenEl.textContent = String(taken);
  upcomingEl.textContent = String(upcoming);
  missedEl.textContent = String(missed);

  if (!todays.length) {
    scheduleList.innerHTML = '<p class="page-subtext">No medicines scheduled for today.</p>';
    return;
  }

  scheduleList.innerHTML = `
    <div class="todays-list">
      ${todays.map((item) => `
        <div class="schedule-item">
          <div>
            <strong>${item.name}</strong>
            <small>${item.dosage} · ${getDisplayTimeLabel(item)}</small>
          </div>
          <span class="badge ${getMedicineStatus(item)}">${getMedicineStatus(item).charAt(0).toUpperCase() + getMedicineStatus(item).slice(1)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function getHistoryEntries() {
  return state.medicines.map((item) => ({
    id: item.id,
    date: item.date,
    name: item.name,
    dosage: item.dosage,
    type: item.type,
    time: item.time,
    frequency: item.frequency,
    status: getMedicineStatus(item)
  }));
}

function renderHistoryPage() {
  const tableBody = document.getElementById("historyTableBody");
  const emptyMsg = document.getElementById("historyEmptyMsg");
  const historySearch = document.getElementById("historySearch")?.value.trim().toLowerCase() || "";
  const historyStatus = document.getElementById("historyStatusFilter")?.value || "all";
  const historyDate = document.getElementById("historyDateFilter")?.value || "";

  if (!tableBody) return;

  const rows = getHistoryEntries().filter((item) => {
    const matchesSearch = !historySearch || item.name.toLowerCase().includes(historySearch);
    const matchesStatus = historyStatus === "all" || item.status === historyStatus;
    const matchesDate = !historyDate || item.date === historyDate;
    return matchesSearch && matchesStatus && matchesDate;
  });

  const totalEl = document.getElementById("historyTotal");
  const takenEl = document.getElementById("historyTaken");
  const missedEl = document.getElementById("historyMissed");
  const upcomingEl = document.getElementById("historyUpcoming");

  const allEntries = getHistoryEntries();
  totalEl && (totalEl.textContent = String(allEntries.length));
  takenEl && (takenEl.textContent = String(allEntries.filter((item) => item.status === "taken").length));
  missedEl && (missedEl.textContent = String(allEntries.filter((item) => item.status === "missed").length));
  upcomingEl && (upcomingEl.textContent = String(allEntries.filter((item) => item.status === "upcoming").length));

  if (!rows.length) {
    tableBody.innerHTML = "";
    emptyMsg?.classList.remove("hidden");
    return;
  }

  emptyMsg?.classList.add("hidden");
  tableBody.innerHTML = rows.map((item) => {
    const badgeClass = item.status === "taken" ? "taken" : item.status === "missed" ? "missed" : "upcoming";
    return `
      <tr>
        <td style="padding:12px; border-bottom:1px solid var(--border);">${formatDisplayDate(item.date)}</td>
        <td style="padding:12px; border-bottom:1px solid var(--border);"><strong>${item.name}</strong></td>
        <td style="padding:12px; border-bottom:1px solid var(--border);">${item.dosage}</td>
        <td style="padding:12px; border-bottom:1px solid var(--border);">${item.type}</td>
        <td style="padding:12px; border-bottom:1px solid var(--border);">${getDisplayTimeLabel({ time: item.time, frequency: item.frequency })}</td>
        <td style="padding:12px; border-bottom:1px solid var(--border);"><span class="badge ${badgeClass}">${item.status.charAt(0).toUpperCase() + item.status.slice(1)}</span></td>
      </tr>
    `;
  }).join("");
}

function loadProfileData() {
  const profile = state.profile;
  const profileName = document.getElementById("profileName");
  const profileEmail = document.getElementById("profileEmail");
  const profilePhone = document.getElementById("profilePhone");
  const profileDob = document.getElementById("profileDob");
  const profileGender = document.getElementById("profileGender");
  const profileBloodGroup = document.getElementById("profileBloodGroup");
  const profileAddress = document.getElementById("profileAddress");
  const profileEmergency = document.getElementById("profileEmergency");
  const profileCaregiver = document.getElementById("profileCaregiver");
  const avatar = document.getElementById("profileAvatar");
  const displayName = document.getElementById("profileDisplayName");
  const displayEmail = document.getElementById("profileDisplayEmail");

  if (!profileName) return;

  profileName.value = profile.name || "";
  profileEmail.value = profile.email || "";
  profilePhone.value = profile.phone || "";
  profileDob.value = profile.dob || "";
  profileGender.value = profile.gender || "";
  profileBloodGroup.value = profile.bloodGroup || "";
  profileAddress.value = profile.address || "";
  profileEmergency.value = profile.emergency || "";
  profileCaregiver.value = profile.caregiver || "";

  const name = profile.name || "User";
  const email = profile.email || "user@example.com";
  displayName.textContent = name;
  displayEmail.textContent = email;
  avatar.textContent = name.charAt(0).toUpperCase();
}

function saveProfileData() {
  state.profile = {
    ...state.profile,
    name: document.getElementById("profileName")?.value.trim() || state.user.name,
    phone: document.getElementById("profilePhone")?.value || "",
    dob: document.getElementById("profileDob")?.value || "",
    gender: document.getElementById("profileGender")?.value || "",
    bloodGroup: document.getElementById("profileBloodGroup")?.value || "",
    address: document.getElementById("profileAddress")?.value || "",
    emergency: document.getElementById("profileEmergency")?.value || "",
    caregiver: document.getElementById("profileCaregiver")?.value || ""
  };
  state.user.name = state.profile.name;
  loadProfileData();
  saveAppData();
}

function resetProfileData() {
  state.profile = {
    name: state.user.name,
    email: state.user.email,
    phone: "",
    dob: "",
    gender: "",
    bloodGroup: "",
    address: "",
    emergency: "",
    caregiver: ""
  };
  loadProfileData();
  saveAppData();
}

function renderAll() {
  updateMedicineStatuses();
  updateHomeStats();
  renderMedicineCards();
  renderDashboard();
  renderHistoryPage();
  loadProfileData();
}

function setPage(pageName) {
  document.querySelectorAll(".page").forEach((page) => page.classList.toggle("active", page.id === pageName));
  document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.page === pageName));
}

function clearForm() {
  state.currentEditId = null;
  document.getElementById("medicineForm").reset();
  document.getElementById("medicineId").value = "";
  document.getElementById("formTitle").textContent = "Add a New Medicine";
  document.getElementById("saveBtn").textContent = "Save Medicine";
  document.getElementById("cancelEditBtn").classList.add("hidden");
}

function fillFormForEdit(id) {
  const medicine = state.medicines.find((item) => item.id === id);
  if (!medicine) return;

  state.currentEditId = id;
  document.getElementById("medicineId").value = medicine.id;
  document.getElementById("medName").value = medicine.name;
  document.getElementById("medDosage").value = medicine.dosage;
  document.getElementById("medType").value = medicine.type;
  document.getElementById("medDate").value = medicine.date;
  document.getElementById("medTime").value = medicine.time;
  document.getElementById("medFrequency").value = medicine.frequency;
  document.getElementById("medNotes").value = medicine.notes || "";
  document.getElementById("formTitle").textContent = "Edit Medicine";
  document.getElementById("saveBtn").textContent = "Update Medicine";
  document.getElementById("cancelEditBtn").classList.remove("hidden");
  setPage("add");
}

function handleMedicineSubmit(event) {
  event.preventDefault();

  const id = document.getElementById("medicineId").value || crypto.randomUUID();
  const existingIndex = state.medicines.findIndex((item) => item.id === id);
  const formData = {
    id,
    name: document.getElementById("medName").value.trim(),
    dosage: document.getElementById("medDosage").value.trim(),
    type: document.getElementById("medType").value,
    date: document.getElementById("medDate").value,
    time: document.getElementById("medTime").value,
    frequency: document.getElementById("medFrequency").value,
    notes: document.getElementById("medNotes").value.trim(),
    taken: existingIndex >= 0 ? state.medicines[existingIndex].taken : false,
    status: "upcoming"
  };

  if (!formData.name || !formData.dosage || !formData.type || !formData.date || !formData.time || !formData.frequency) {
    return;
  }

  if (existingIndex >= 0) {
    state.medicines[existingIndex] = { ...state.medicines[existingIndex], ...formData };
  } else {
    state.medicines.push(formData);
  }

  saveAppData();
  renderAll();
  clearForm();
  setPage("list");
}

function handleMedicineAction(event) {
  const target = event.target.closest("button[data-action]");
  if (!target) return;

  const { action, id } = target.dataset;
  const medicine = state.medicines.find((item) => item.id === id);
  if (!medicine) return;

  if (action === "edit") {
    fillFormForEdit(id);
  }

  if (action === "delete") {
    state.deleteId = id;
    document.getElementById("confirmModal").classList.remove("hidden");
  }

  if (action === "taken") {
    medicine.taken = true;
    medicine.status = "taken";
    saveAppData();
    renderAll();
  }
}

function confirmDelete() {
  if (!state.deleteId) return;
  state.medicines = state.medicines.filter((item) => item.id !== state.deleteId);
  state.deleteId = null;
  saveAppData();
  renderAll();
  document.getElementById("confirmModal").classList.add("hidden");
}

function cleanupReminderBanner() {
  const reminderBanner = document.getElementById("reminderBanner");
  if (!reminderBanner) return;
  reminderBanner.classList.add("hidden");
  document.getElementById("reminderText").textContent = "";
}

function triggerReminderCheck() {
  const reminderBanner = document.getElementById("reminderBanner");
  if (!reminderBanner) return;

  const now = new Date();
  const reminderWindowStart = now.getTime() - 600000;
  let dueDose = null;
  for (const medicine of state.medicines) {
    if (medicine.taken) continue;
    const scheduledDose = getScheduledDoseDateTimes(medicine).find((dose) => {
      const scheduledAt = dose.getTime();
      return getLocalDateKey(dose) === getTodayKey()
        && scheduledAt <= now.getTime()
        && scheduledAt > reminderWindowStart;
    });
    if (scheduledDose) {
      dueDose = { medicine, time: `${padTimeValue(scheduledDose.getHours())}:${padTimeValue(scheduledDose.getMinutes())}` };
      break;
    }
  }

  if (dueDose) {
    document.getElementById("reminderText").textContent = `Reminder: ${dueDose.medicine.name} at ${formatDisplayTime(dueDose.time)}`;
    reminderBanner.classList.remove("hidden");
  } else {
    reminderBanner.classList.add("hidden");
  }
}

function loadTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY) || "light";
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches && savedTheme !== "light";
  const theme = savedTheme === "dark" || prefersDark ? "dark" : "light";
  document.body.classList.toggle("dark-mode", theme === "dark");
  const toggle = document.getElementById("themeToggle");
  if (toggle) toggle.textContent = theme === "dark" ? "☀️" : "🌙";
}

function toggleTheme() {
  const isDark = document.body.classList.toggle("dark-mode");
  localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
  document.getElementById("themeToggle").textContent = isDark ? "☀️" : "🌙";
}

async function initializeApp() {
  try {
    const session = await requestApi("/api/session");
    state.user = session.user;
    const data = await requestApi("/api/data");
    state.medicines = data.medicines;
    state.profile = data.profile;
  } catch (error) {
    if (error.status === 401) {
      window.location.href = "/login.html";
    } else {
      showAppError(`Could not load your account data: ${error.message}. Make sure the app server is running.`);
    }
    return;
  }

  loadTheme();

  document.getElementById("medicineForm")?.addEventListener("submit", handleMedicineSubmit);
  document.getElementById("cancelEditBtn")?.addEventListener("click", () => {
    clearForm();
    setPage("list");
  });
  document.getElementById("goToAddBtn")?.addEventListener("click", () => {
    clearForm();
    setPage("add");
  });

  document.getElementById("saveBtn")?.addEventListener("click", () => {});
  document.getElementById("confirmDeleteBtn")?.addEventListener("click", confirmDelete);
  document.getElementById("cancelDeleteBtn")?.addEventListener("click", () => {
    state.deleteId = null;
    document.getElementById("confirmModal").classList.add("hidden");
  });
  document.getElementById("dismissReminder")?.addEventListener("click", cleanupReminderBanner);
  document.getElementById("themeToggle")?.addEventListener("click", toggleTheme);

  document.getElementById("searchInput")?.addEventListener("input", renderMedicineCards);
  document.getElementById("filterDate")?.addEventListener("input", renderMedicineCards);
  document.getElementById("clearFilterBtn")?.addEventListener("click", () => {
    document.getElementById("searchInput").value = "";
    document.getElementById("filterDate").value = "";
    renderMedicineCards();
  });

  document.getElementById("historySearch")?.addEventListener("input", renderHistoryPage);
  document.getElementById("historyStatusFilter")?.addEventListener("change", renderHistoryPage);
  document.getElementById("historyDateFilter")?.addEventListener("input", renderHistoryPage);
  document.getElementById("clearHistoryFilters")?.addEventListener("click", () => {
    document.getElementById("historySearch").value = "";
    document.getElementById("historyStatusFilter").value = "all";
    document.getElementById("historyDateFilter").value = "";
    renderHistoryPage();
  });

  document.getElementById("saveProfileBtn")?.addEventListener("click", saveProfileData);
  document.getElementById("resetProfileBtn")?.addEventListener("click", resetProfileData);
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    try {
      await requestApi("/api/logout", { method: "POST" });
      window.location.href = "/login.html";
    } catch (error) {
      showAppError(`Could not log out: ${error.message}`);
    }
  });

  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const pageName = button.dataset.page;
      if (!pageName) return;
      setPage(pageName);
    });
  });

  document.getElementById("medicineCards")?.addEventListener("click", handleMedicineAction);

  const today = new Date();
  const dateInput = document.getElementById("medDate");
  if (dateInput && !dateInput.value) {
    dateInput.value = getLocalDateKey(today);
  }

  renderAll();
  triggerReminderCheck();
  setInterval(() => {
    renderAll();
    triggerReminderCheck();
  }, 30000);
}

document.addEventListener("DOMContentLoaded", initializeApp);
