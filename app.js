const STORAGE_KEYS = {
  user: "kagami-user",
  account: "kagami-account-v1",
  profile: "kagami-profile",
  onboardingDraft: "kagami-onboarding-draft-v1",
  tracking: "kagami-tracking-v1",
  layout: "kagami-layout-v2",
  theme: "kagami-theme",
  canvasColor: "kagami-canvas-color",
  hiddenPanels: "kagami-hidden-panels-v2",
  minimizedPanels: "kagami-minimized-panels",
  sidebarHidden: "kagami-sidebar-hidden",
  settings: "kagami-settings-v1",
};

const PANEL_IDS = ["health", "study", "finance", "fun"];
const WINDOW_RESIZE_DIRECTIONS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
const CANVAS_COLORS = {
  moonlight: {
    halo: "rgba(255, 230, 160, 0.26)",
    glow: "rgba(255, 240, 168, 0.34)",
    core: "rgba(255, 244, 196, 0.88)",
  },
  lavender: {
    halo: "rgba(183, 162, 255, 0.26)",
    glow: "rgba(193, 165, 255, 0.34)",
    core: "rgba(232, 218, 255, 0.9)",
  },
  starlight: {
    halo: "rgba(105, 202, 255, 0.24)",
    glow: "rgba(135, 220, 255, 0.32)",
    core: "rgba(215, 245, 255, 0.92)",
  },
};
const screens = {
  intro: document.querySelector("#intro"),
  auth: document.querySelector("#auth"),
  onboarding: document.querySelector("#onboarding"),
  dashboard: document.querySelector("#dashboard"),
};

const onboardingSteps = [
  {
    key: "areas",
    label: "Tu vida",
    title: "Configura tu espacio",
    subtitle: "Elige las áreas que quieres tener presentes. Puedes seleccionar varias.",
    options: [
      ["health", "Salud", "Hábitos, bienestar físico y mental, sueño y más.", "heart"],
      ["finance", "Economía", "Gastos, ingresos, ahorro y metas financieras.", "wallet"],
      ["study", "Estudio", "Clases, tareas, exámenes y tiempo de aprendizaje.", "book"],
      ["fun", "Entretenimiento", "Tiempo libre, pasatiempos y momentos para disfrutar.", "sparkles"],
    ],
    multiple: true,
  },
  {
    key: "rhythm",
    label: "Tu ritmo",
    title: "Encuentra tu ritmo",
    subtitle: "Elige cómo quieres organizar tus preguntas y objetivos.",
    options: [
      ["gentle", "Suave: pasos pequeños y sin prisa"],
      ["balanced", "Equilibrado: estructura con espacio para adaptarte"],
      ["focused", "Enfocado: bloques para avanzar con intención"],
    ],
  },
  {
    key: "habit",
    label: "Tus objetivos",
    title: "Construye tu hábito",
    subtitle: "¿Qué hábito te gustaría desarrollar? Escribe un objetivo personal para empezar.",
  },
];

let questionIndex = 0;
let answers = {};
let editingProfile = false;
let authMode = "login";
let toastTimer;
let windowZIndex = 10;
let lastCanvasClearKey = 0;
let canvasContext;
let canvasIsDrawing = false;
let selectedCanvasColor = "moonlight";

function getStored(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    console.error(`No se pudo leer el dato local "${key}".`, error);
    return fallback;
  }
}

function saveStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`No se pudo guardar el dato local "${key}".`, error);
    showToast("No se pudieron guardar los cambios en este dispositivo.");
    return false;
  }
}

function removeStored(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.error(`No se pudo borrar el dato local "${key}".`, error);
    showToast("No se pudo borrar el progreso guardado en este dispositivo.");
    return false;
  }
}

function showScreen(name) {
  Object.entries(screens).forEach(([key, screen]) => {
    screen.classList.toggle("hidden", key !== name);
  });
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

async function derivePasswordHash(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

async function createPasswordCredential(password) {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is unavailable.");
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iterations = 210000;
  return {
    algorithm: "PBKDF2-SHA-256",
    iterations,
    salt: btoa(String.fromCharCode(...salt)),
    hash: await derivePasswordHash(password, salt, iterations),
  };
}

async function verifyPassword(password, credential) {
  if (
    !globalThis.crypto?.subtle ||
    credential?.algorithm !== "PBKDF2-SHA-256" ||
    !Number.isInteger(credential.iterations) ||
    credential.iterations < 100000 ||
    credential.iterations > 1000000 ||
    typeof credential.salt !== "string" ||
    typeof credential.hash !== "string"
  ) return false;
  const salt = Uint8Array.from(atob(credential.salt), (character) => character.charCodeAt(0));
  const actual = await derivePasswordHash(password, salt, credential.iterations);
  if (actual.length !== credential.hash.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ credential.hash.charCodeAt(index);
  }
  return difference === 0;
}

function startAuth() {
  showScreen("auth");
  document.querySelector("#username").focus();
}

document.querySelector("#start-button").addEventListener("click", () => {
  const button = document.querySelector("#start-button");
  button.classList.add("launching");
  document.querySelector(".planet-large").classList.add("launch-planet");
  window.setTimeout(startAuth, 700);
});

function configureAuthMode(mode) {
  authMode = mode;
  const form = document.querySelector("#auth-form");
  const passwordGroup = document.querySelector("#password-group");
  const otpGroup = document.querySelector("#otp-group");
  const title = document.querySelector("#auth-title");
  const subtitle = document.querySelector("#auth-subtitle");
  const submit = document.querySelector("#auth-submit");
  const create = document.querySelector("#create-account");
  const forgot = document.querySelector("#forgot-password");
  document.querySelector("#auth-error").textContent = "";
  passwordGroup.classList.toggle("hidden", mode === "forgot");
  otpGroup.classList.toggle("hidden", mode === "forgot");
  document.querySelector("#password").required = mode !== "forgot";
  document.querySelector("#otp").required = mode !== "forgot";
  if (mode === "signup") {
    title.textContent = "Empecemos por ti.";
    subtitle.textContent = "Crea tu acceso a Kagami.";
    submit.innerHTML = "Crear mi cuenta <span>→</span>";
    create.textContent = "Ya tengo una cuenta";
    forgot.textContent = "¿Necesitas ayuda?";
  } else if (mode === "forgot") {
    title.textContent = "Recuperemos tu acceso.";
    subtitle.textContent = "Te guiaremos para volver a tu espacio.";
    submit.innerHTML = "Continuar <span>→</span>";
    create.textContent = "Volver al inicio";
    forgot.textContent = "Crear una cuenta";
  } else {
    title.textContent = "Qué gusto tenerte aquí.";
    subtitle.textContent = "Ingresa a tu espacio personal.";
    submit.innerHTML = "Entrar a mi espacio <span>→</span>";
    create.textContent = "Crear una cuenta";
    forgot.textContent = "Olvidé mi contraseña";
  }
  form.dataset.mode = mode;
}

document.querySelector("#create-account").addEventListener("click", () => {
  configureAuthMode(authMode === "signup" ? "login" : "signup");
});
document.querySelector("#forgot-password").addEventListener("click", () => {
  configureAuthMode(authMode === "forgot" ? "signup" : "forgot");
});

document.querySelector("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = document.querySelector("#username").value.trim();
  const password = document.querySelector("#password").value;
  const otp = document.querySelector("#otp").value.trim();
  const error = document.querySelector("#auth-error");
  if (authMode === "forgot") {
    error.textContent = "";
    showToast(`Si existe una cuenta para ${username}, recibirás instrucciones de recuperación.`);
    configureAuthMode("login");
    return;
  }
  if (otp !== "123456") {
    error.textContent = "Código de verificación incorrecto. Para esta demo, usa 123456.";
    return;
  }
  if (!username || password.length < 4) {
    error.textContent = "Revisa tu usuario y contraseña para continuar.";
    return;
  }
  if (authMode === "signup" && password.length < 8) {
    error.textContent = "Para crear una cuenta, usa una contraseña de al menos 8 caracteres.";
    return;
  }
  const savedUser = getStored(STORAGE_KEYS.account) || getStored(STORAGE_KEYS.user);
  if (authMode === "login" && savedUser && savedUser.name !== username) {
    error.textContent = "No hay una cuenta local con ese usuario.";
    return;
  }
  let credential;
  try {
    if (authMode === "login" && savedUser?.name === username && savedUser.credential) {
      if (!await verifyPassword(password, savedUser.credential)) {
        error.textContent = "La contraseña no es correcta.";
        return;
      }
      credential = savedUser.credential;
    } else {
      credential = await createPasswordCredential(password);
    }
  } catch (credentialError) {
    console.error("No se pudo verificar o proteger la contraseña local.", credentialError);
    error.textContent = "No se pudo proteger la contraseña en este dispositivo. Inténtalo de nuevo.";
    return;
  }
  const account = {
    ...(savedUser?.name === username ? savedUser : {}),
    name: username,
    created: savedUser?.name === username ? savedUser.created : Date.now(),
    credential,
  };
  if (!saveStored(STORAGE_KEYS.account, account)) {
    error.textContent = "No se pudo guardar la cuenta en este dispositivo.";
    return;
  }
  const sessionUser = { name: account.name, created: account.created };
  if (!saveStored(STORAGE_KEYS.user, sessionUser)) {
    if (savedUser) saveStored(STORAGE_KEYS.account, savedUser);
    else removeStored(STORAGE_KEYS.account);
    error.textContent = "No se pudo iniciar la sesión en este dispositivo.";
    return;
  }
  const profile = getStored(STORAGE_KEYS.profile);
  if (profile && profile.onboardingVersion === 1 && profile.storageConsent) enterDashboard(account, profile);
  else {
    showScreen("onboarding");
    startOnboarding();
  }
});

function startOnboarding(profile = null) {
  const savedDraft = getStored(STORAGE_KEYS.onboardingDraft);
  const source = profile || (savedDraft && savedDraft.version === 1 && savedDraft.answers && savedDraft.answers.storageConsent ? savedDraft.answers : null);
  answers = source
    ? { ...source, areas: [...(source.areas || [])] }
    : { areas: [], rhythm: "balanced", habit: "", storageConsent: false };
  editingProfile = Boolean(profile);
  questionIndex = 0;
  renderQuestion();
}

function saveOnboardingDraft() {
  if (!answers.storageConsent) return false;
  return saveStored(STORAGE_KEYS.onboardingDraft, {
    version: 1,
    answers,
    updatedAt: new Date().toISOString(),
  });
}

function updateConsentVisibility() {
  const label = document.querySelector("#onboarding-consent-label");
  label.classList.toggle("hidden", questionIndex !== 0);
  document.querySelector("#onboarding-consent").checked = Boolean(answers.storageConsent);
}

function renderQuestion() {
  const question = onboardingSteps[questionIndex];
  const content = document.querySelector("#question-content");
  document.querySelector("#question-progress").textContent = `${questionIndex + 1} DE ${onboardingSteps.length}`;
  document.querySelectorAll(".onboarding-step").forEach((step, index) => {
    step.classList.toggle("active", index === questionIndex);
  });
  document.querySelector("#question-back").style.visibility = questionIndex === 0 ? "hidden" : "visible";
  document.querySelector("#question-next").innerHTML = questionIndex === onboardingSteps.length - 1 ? "Crear mi espacio <span>→</span>" : "Continuar <span>→</span>";
  document.querySelector("#question-error").textContent = "";
  content.replaceChildren();
  const title = document.createElement("h1");
  title.textContent = question.title;
  const subtitle = document.createElement("p");
  subtitle.className = "question-subtitle";
  subtitle.textContent = question.subtitle;
  content.append(title, subtitle);

  if (question.options) {
    const options = document.createElement("div");
    options.className = "question-options";
    question.options.forEach(([value, label, description, iconName]) => {
      const selected = question.multiple ? (answers[question.key] || []).includes(value) : answers[question.key] === value;
      const option = document.createElement("button");
      option.type = "button";
      option.className = `question-option${selected ? " selected" : ""}`;
      option.dataset.answer = value;
      option.setAttribute("aria-pressed", String(selected));
      const icon = document.createElement("span");
      icon.className = `area-icon area-icon-${iconName || "default"}`;
      icon.setAttribute("aria-hidden", "true");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "1.6");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      const iconPaths = {
        heart: ["M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"],
        wallet: ["M3.5 6.5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h13", "M3.5 8h17v5h-5a2.5 2.5 0 0 0 0 5h5", "M15.5 15.5h.01"],
        book: ["M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22.5z", "M4 5.5v17", "M8 7h8", "M8 11h7"],
        sparkles: ["m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z", "m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z", "M5 2v3", "M3.5 3.5h3"],
      };
      (iconPaths[iconName] || iconPaths.sparkles).forEach((pathData) => {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", pathData);
        svg.append(path);
      });
      icon.append(svg);
      const copy = document.createElement("span");
      copy.className = "area-copy";
      const heading = document.createElement("span");
      heading.className = "area-title";
      heading.textContent = label;
      const detail = document.createElement("span");
      detail.className = "area-description";
      detail.textContent = description || "";
      copy.append(heading, detail);
      const mark = document.createElement("span");
      mark.className = "option-mark";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = selected ? "✓" : "";
      option.append(icon, copy, mark);
      option.addEventListener("click", () => {
        if (question.multiple) {
          const selectedValues = new Set(answers[question.key] || []);
          if (selectedValues.has(value)) selectedValues.delete(value);
          else selectedValues.add(value);
          answers[question.key] = [...selectedValues];
        } else {
          answers[question.key] = value;
        }
        saveOnboardingDraft();
        renderQuestion();
      });
      options.append(option);
    });
    content.append(options);
  } else {
    const label = document.createElement("label");
    label.className = "question-habit-label";
    label.htmlFor = "habit-input";
    label.textContent = "Mi primer hábito";
    const input = document.createElement("input");
    input.id = "habit-input";
    input.className = "question-input";
    input.type = "text";
    input.maxLength = 140;
    input.placeholder = "Por ejemplo: leer diez minutos cada día";
    input.value = answers.habit || "";
    input.required = true;
    input.addEventListener("input", () => {
      answers.habit = input.value;
      saveOnboardingDraft();
    });
    content.append(label, input);
  }
  updateConsentVisibility();
}

document.querySelector("#question-back").addEventListener("click", () => {
  if (questionIndex > 0) {
    questionIndex -= 1;
    renderQuestion();
  }
});

document.querySelector("#onboarding-consent").addEventListener("change", (event) => {
  answers.storageConsent = event.target.checked;
  if (answers.storageConsent) saveOnboardingDraft();
  else removeStored(STORAGE_KEYS.onboardingDraft);
  document.querySelector("#question-error").textContent = "";
});

document.querySelector("#question-next").addEventListener("click", () => {
  const question = onboardingSteps[questionIndex];
  const answer = answers[question.key];
  if (questionIndex === 0 && !answers.storageConsent) {
    document.querySelector("#question-error").textContent = "Acepta guardar el progreso en este dispositivo para continuar.";
    return;
  }
  if (!answer || (Array.isArray(answer) && answer.length === 0) || (typeof answer === "string" && !answer.trim())) {
    document.querySelector("#question-error").textContent = questionIndex === 0
      ? "Selecciona al menos un espacio para continuar."
      : questionIndex === 1
        ? "Elige el ritmo que mejor se adapte a ti."
        : "Escribe el hábito que quieres desarrollar.";
    return;
  }
  if (questionIndex < onboardingSteps.length - 1) {
    saveOnboardingDraft();
    questionIndex += 1;
    renderQuestion();
    return;
  }
  const user = getStored(STORAGE_KEYS.account) || getStored(STORAGE_KEYS.user) || { name: "U1" };
  const profile = {
    ...answers,
    habit: answers.habit.trim(),
    onboardingVersion: 1,
    completedAt: new Date().toISOString(),
  };
  let tracking = getStored(STORAGE_KEYS.tracking);
  if (!tracking || !Array.isArray(tracking.questions) || !Array.isArray(tracking.records) || !Array.isArray(tracking.goals)) {
    if (editingProfile && tracking) {
      console.error("No se pudo actualizar el perfil porque los datos de seguimiento no tienen un formato válido.");
      showToast("No se pudo guardar el perfil porque el seguimiento local no es válido.");
      return;
    }
    tracking = createTrackingState();
  }
  tracking.preferences = {
    ...createTrackingState().preferences,
    ...(tracking.preferences || {}),
  };
  const existingGoal = editingProfile && profile.goalId
    ? tracking.goals.find((goal) => goal.id === profile.goalId)
    : null;
  const matchingInitialGoal = tracking.goals.find((goal) =>
    goal.type === "habit" && goal.title === profile.habit && !goal.questionId && !goal.target
  );
  const goal = existingGoal || matchingInitialGoal || createHabitGoal(profile.habit);
  goal.title = profile.habit;
  if (!tracking.goals.includes(goal)) tracking.goals.push(goal);
  tracking.preferences.areas = [...profile.areas];
  tracking.preferences.organizationMode = profile.rhythm;
  profile.goalId = goal.id;
  if (!saveStored(STORAGE_KEYS.tracking, tracking) || !saveStored(STORAGE_KEYS.profile, profile)) return;
  removeStored(STORAGE_KEYS.onboardingDraft);
  editingProfile = false;
  enterDashboard(user, profile);
});

function enterDashboard(user, profile) {
  showScreen("dashboard");
  setDrawingMode(false);
  renderProfileButton(user);
  applyWorkspaceImage();
  document.querySelector("#today-label").textContent = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  personalizeDashboard(profile);
  applyTheme(getStored(STORAGE_KEYS.theme, "dark"));
  applyLayout();
  applyHiddenPanels();
  setSidebarHidden(getStored(STORAGE_KEYS.sidebarHidden, false));
  requestAnimationFrame(resizeInkCanvas);
}

function renderProfileButton(user) {
  const button = document.querySelector("#profile-button");
  button.replaceChildren();
  button.setAttribute("aria-label", `Abrir perfil de ${user.name || "usuario"}`);
  if (typeof user.profileImage === "string" && user.profileImage.startsWith("data:image/")) {
    const image = document.createElement("img");
    image.src = user.profileImage;
    image.alt = "";
    button.append(image);
  } else {
    button.textContent = (user.name || "U").slice(0, 1).toUpperCase();
  }
}

function applyWorkspaceImage() {
  const settings = getStored(STORAGE_KEYS.settings, {});
  const image = typeof settings?.canvasImage === "string" && settings.canvasImage.startsWith("data:image/")
    ? settings.canvasImage
    : "Jupiter.png";
  screens.dashboard.style.setProperty("--workspace-image", `url("${image}")`);
  document.querySelector("#canvas-image-preview").style.backgroundImage = `url("${image}")`;
}

function personalizeDashboard(profile) {
  const focus = profile.areas || profile.focus || [];
  const priority = focus[0];
  const healthMessages = {
    health: ["Una pausa también es progreso", "¿Ya tomaste un poco de agua hoy?"],
    balance: ["Regálate un momento de calma", "Respira. No todo tiene que ser ahora."],
    full: ["Tómate un respiro", "Un minuto para ti puede cambiar tu día."],
  };
  const health = healthMessages[priority] || ["Un momento para respirar", "Pausar también es avanzar."];
  document.querySelector("#health-reminder").textContent = health[0];
  document.querySelector("#health-detail").textContent = health[1];
  const studyNames = { language: "Practica un idioma", digital: "Explora algo digital", creative: "Deja fluir tu creatividad", personal: "Una habilidad para tu día" };
  document.querySelector("#study-goal").textContent = studyNames[profile.learning] || "Cada día, un poco más";
  document.querySelector("#study-detail").textContent = profile.pace === "gentle" ? "Con calma, un paso a la vez." : "Aprender a tu manera también cuenta.";
  document.querySelector("#finance-goal").textContent = focus.includes("finance") ? "Una meta a tu medida" : "Un futuro con intención";
  document.querySelector("#finance-detail").textContent = profile.routine === "full" ? "Empieza con un solo hábito que te dé claridad." : "Conocer tus hábitos es el primer paso para elegir.";
  const funCopy = {
    fun: ["Un rato para ti", "¿Qué te gustaría disfrutar hoy?"],
    balance: ["Un descanso que sí cuenta", "Haz espacio para algo que te haga bien."],
  };
  const fun = funCopy[priority] || ["Un rato para ti", "¿Qué te gustaría disfrutar hoy?"];
  document.querySelector("#fun-goal").textContent = fun[0];
  document.querySelector("#fun-detail").textContent = fun[1];
}

function applyTheme(theme) {
  const dashboard = screens.dashboard;
  dashboard.classList.remove("theme-dark", "theme-lavender");
  if (theme === "dark") dashboard.classList.add("theme-dark");
  if (theme === "lavender") dashboard.classList.add("theme-lavender");
  document.querySelector("#theme-select").value = theme;
  saveStored(STORAGE_KEYS.theme, theme);
}

function windowsAreaWidth(area) {
  const areaLeft = area.getBoundingClientRect().left;
  const rightInset = window.matchMedia("(max-width: 620px)").matches
    ? 8
    : window.innerWidth <= 850
      ? 17
      : Math.max(19, Math.min(47, window.innerWidth * 0.033));
  return Math.max(0, Math.min(area.clientWidth, window.innerWidth - areaLeft - rightInset));
}

function applyLayout() {
  const area = document.querySelector("#windows-area");
  const maxWidth = windowsAreaWidth(area);
  const maxHeight = area.clientHeight;
  const layout = getStored(STORAGE_KEYS.layout, {});
  document.querySelectorAll(".widget-window").forEach((windowEl) => {
    const position = layout[windowEl.dataset.window];
    if (!position) return;
    if (position.left != null) {
      const width = Math.min(maxWidth, Math.max(Math.min(280, maxWidth), position.width));
      const height = Math.min(maxHeight, Math.max(Math.min(190, maxHeight), position.height));
      windowEl.style.position = "absolute";
      windowEl.style.left = `${Math.max(0, Math.min(maxWidth - width, position.left))}px`;
      windowEl.style.top = `${Math.max(0, Math.min(maxHeight - height, position.top))}px`;
      windowEl.style.width = `${width}px`;
      windowEl.style.height = `${height}px`;
    }
  });
}

function applyHiddenPanels() {
  const hiddenPanels = getStored(STORAGE_KEYS.hiddenPanels, PANEL_IDS);
  const minimizedPanels = getStored(STORAGE_KEYS.minimizedPanels, []);
  const taskbar = document.querySelector("#window-taskbar");
  taskbar.replaceChildren();
  document.querySelectorAll(".widget-window").forEach((windowEl) => {
    const panelId = windowEl.dataset.window;
    const isClosed = hiddenPanels.includes(panelId);
    const isMinimized = minimizedPanels.includes(panelId) && !isClosed;
    windowEl.hidden = isClosed || isMinimized;
    if (isMinimized) {
      const restoreButton = document.createElement("button");
      restoreButton.className = "taskbar-window";
      restoreButton.type = "button";
      restoreButton.dataset.restore = panelId;
      restoreButton.textContent = windowEl.querySelector("h2").textContent;
      restoreButton.setAttribute("aria-label", `Restaurar ${restoreButton.textContent}`);
      taskbar.append(restoreButton);
    }
    const nav = document.querySelector(`.nav-item[data-panel="${windowEl.dataset.window}"]`);
    nav?.classList.toggle("selected", !isClosed && !isMinimized);
  });
  document.querySelector("#show-all").checked = hiddenPanels.length === 0;
  taskbar.querySelectorAll("[data-restore]").forEach((button) => {
    button.addEventListener("click", () => restoreWindow(button.dataset.restore));
  });
}

function focusWindow(windowEl) {
  document.querySelectorAll(".widget-window").forEach((item) => item.classList.remove("focused"));
  windowEl.classList.add("focused");
  windowEl.style.zIndex = `${++windowZIndex}`;
}

function positionWindow(windowEl, slot) {
  const area = document.querySelector("#windows-area");
  const width = windowsAreaWidth(area);
  const height = area.clientHeight;
  if (!width || !height) return;

  if (window.matchMedia("(max-width: 620px)").matches) {
    const windowWidth = Math.max(0, width - 12);
    const windowHeight = Math.min(height - 16, Math.max(220, Math.min(430, height * 0.72)));
    windowEl.style.left = `${6 + slot * 7}px`;
    windowEl.style.top = `${8 + slot * 24}px`;
    windowEl.style.width = `${windowWidth}px`;
    windowEl.style.height = `${windowHeight}px`;
    return;
  }

  const gap = 12;
  const columns = width >= 600 ? 2 : 1;
  const rows = 2;
  const windowWidth = Math.min(640, (width - gap * (columns - 1)) / columns);
  const windowHeight = Math.min(350, (height - gap * (rows - 1)) / rows);
  const slotInPage = slot % (columns * rows);
  windowEl.style.left = `${(slotInPage % columns) * (windowWidth + gap)}px`;
  windowEl.style.top = `${Math.floor(slotInPage / columns) * (windowHeight + gap)}px`;
  windowEl.style.width = `${windowWidth}px`;
  windowEl.style.height = `${windowHeight}px`;
}

function openWindow(panelId) {
  const windowEl = document.querySelector(`#window-${panelId}`);
  document.querySelectorAll(".widget-window.maximized").forEach((otherWindow) => {
    if (otherWindow !== windowEl) setWindowMaximized(otherWindow, false);
  });
  const hiddenPanels = new Set(getStored(STORAGE_KEYS.hiddenPanels, PANEL_IDS));
  const minimizedPanels = new Set(getStored(STORAGE_KEYS.minimizedPanels, []));
  hiddenPanels.delete(panelId);
  minimizedPanels.delete(panelId);
  if (!windowEl.style.width) {
    const slot = [...document.querySelectorAll(".widget-window")].filter((otherWindow) => otherWindow !== windowEl && !otherWindow.hidden).length;
    positionWindow(windowEl, slot);
  }
  saveStored(STORAGE_KEYS.hiddenPanels, [...hiddenPanels]);
  saveStored(STORAGE_KEYS.minimizedPanels, [...minimizedPanels]);
  windowEl.hidden = false;
  applyHiddenPanels();
  focusWindow(windowEl);
}

function closeWindow(panelId) {
  const windowEl = document.querySelector(`#window-${panelId}`);
  if (windowEl.classList.contains("maximized")) setWindowMaximized(windowEl, false);
  const hiddenPanels = new Set(getStored(STORAGE_KEYS.hiddenPanels, PANEL_IDS));
  const minimizedPanels = new Set(getStored(STORAGE_KEYS.minimizedPanels, []));
  hiddenPanels.add(panelId);
  minimizedPanels.delete(panelId);
  saveStored(STORAGE_KEYS.hiddenPanels, [...hiddenPanels]);
  saveStored(STORAGE_KEYS.minimizedPanels, [...minimizedPanels]);
  applyHiddenPanels();
}

function minimizeWindow(panelId) {
  const minimizedPanels = new Set(getStored(STORAGE_KEYS.minimizedPanels, []));
  minimizedPanels.add(panelId);
  saveStored(STORAGE_KEYS.minimizedPanels, [...minimizedPanels]);
  applyHiddenPanels();
}

function restoreWindow(panelId) {
  const minimizedPanels = new Set(getStored(STORAGE_KEYS.minimizedPanels, []));
  minimizedPanels.delete(panelId);
  saveStored(STORAGE_KEYS.minimizedPanels, [...minimizedPanels]);
  openWindow(panelId);
}

function toggleMaximize(windowEl) {
  const willMaximize = !windowEl.classList.contains("maximized");
  if (willMaximize) {
    document.querySelectorAll(".widget-window.maximized").forEach((otherWindow) => {
      if (otherWindow !== windowEl) setWindowMaximized(otherWindow, false);
    });
  }
  setWindowMaximized(windowEl, willMaximize);
  focusWindow(windowEl);
}

function setWindowMaximized(windowEl, maximized) {
  windowEl.classList.toggle("maximized", maximized);
  const button = windowEl.querySelector("[data-maximize]");
  button.textContent = maximized ? "❐" : "□";
  button.title = maximized ? "Restaurar tamaño" : "Maximizar";
  button.setAttribute("aria-label", `${maximized ? "Restaurar" : "Maximizar"} ${windowEl.querySelector("h2").textContent}`);
}

function setSidebarHidden(hidden) {
  screens.dashboard.classList.toggle("sidebar-hidden", hidden);
  document.querySelector("#sidebar-toggle").setAttribute("aria-expanded", String(!hidden));
  document.querySelector("#sidebar-toggle").setAttribute("aria-label", hidden ? "Mostrar barra lateral" : "Ocultar barra lateral");
  document.querySelector(".sidebar").setAttribute("aria-hidden", String(hidden));
  saveStored(STORAGE_KEYS.sidebarHidden, hidden);
  requestAnimationFrame(fitWindowsToArea);
}

function fitWindowsToArea() {
  const area = document.querySelector("#windows-area");
  const areaWidth = windowsAreaWidth(area);
  if (!areaWidth || !area.clientHeight) return;
  const visibleWindows = [...document.querySelectorAll(".widget-window")].filter((windowEl) => !windowEl.hidden && !windowEl.classList.contains("maximized"));
  const mobile = window.matchMedia("(max-width: 620px)").matches;
  const savedLayouts = getStored(STORAGE_KEYS.layout, {});
  visibleWindows.forEach((windowEl, index) => {
    if (mobile) {
      positionWindow(windowEl, index);
      return;
    }

    const saved = savedLayouts[windowEl.dataset.window];
    if (saved) {
      const width = Math.min(areaWidth, Math.max(Math.min(280, areaWidth), saved.width));
      const height = Math.min(area.clientHeight, Math.max(Math.min(190, area.clientHeight), saved.height));
      windowEl.style.left = `${Math.max(0, Math.min(areaWidth - width, saved.left))}px`;
      windowEl.style.top = `${Math.max(0, Math.min(area.clientHeight - height, saved.top))}px`;
      windowEl.style.width = `${width}px`;
      windowEl.style.height = `${height}px`;
    } else {
      positionWindow(windowEl, index);
    }
  });
}

function resizeInkCanvas() {
  const canvas = document.querySelector("#canvas-ink");
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = window.devicePixelRatio || 1;
  if (canvas.width === Math.round(rect.width * ratio) && canvas.height === Math.round(rect.height * ratio)) return;
  const previous = document.createElement("canvas");
  previous.width = canvas.width;
  previous.height = canvas.height;
  if (canvas.width && canvas.height) previous.getContext("2d").drawImage(canvas, 0, 0);
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  canvasContext = canvas.getContext("2d");
  canvasContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  if (previous.width && previous.height) {
    canvasContext.drawImage(previous, 0, 0, previous.width, previous.height, 0, 0, rect.width, rect.height);
  }
}

function clearInkCanvas() {
  const canvas = document.querySelector("#canvas-ink");
  if (!canvasContext) return;
  canvasContext.clearRect(0, 0, canvas.width, canvas.height);
  showToast("Lienzo limpio. Listo para una nueva idea.");
}

function setDrawingMode(enabled) {
  canvasIsDrawing = enabled;
  document.querySelector("#canvas-sheet").classList.toggle("is-drawing", enabled);
  const button = document.querySelector("#draw-toggle");
  button.setAttribute("aria-pressed", String(enabled));
  button.innerHTML = enabled ? "<span>✎</span> Bloquear dibujo" : "<span>✎</span> Desbloquear dibujo";
  button.setAttribute("aria-label", enabled ? "Bloquear dibujo en el lienzo" : "Desbloquear dibujo en el lienzo");
}

function storeWindowLayout(windowEl) {
  if (windowEl.classList.contains("maximized")) return;
  const area = document.querySelector("#windows-area");
  const layout = getStored(STORAGE_KEYS.layout, {});
  const windowRect = windowEl.getBoundingClientRect();
  const areaRect = area.getBoundingClientRect();
  layout[windowEl.dataset.window] = {
    left: Math.round(windowRect.left - areaRect.left),
    top: Math.round(windowRect.top - areaRect.top),
    width: Math.round(windowRect.width),
    height: Math.round(windowRect.height),
  };
  saveStored(STORAGE_KEYS.layout, layout);
}

function resetLayout() {
  saveStored(STORAGE_KEYS.layout, {});
  saveStored(STORAGE_KEYS.hiddenPanels, PANEL_IDS);
  saveStored(STORAGE_KEYS.minimizedPanels, []);
  document.querySelectorAll(".widget-window").forEach((windowEl) => {
    windowEl.removeAttribute("style");
    windowEl.classList.remove("maximized", "focused");
  });
  applyHiddenPanels();
  showToast("Lienzo y ventanas restablecidos.");
}

document.querySelectorAll(".widget-window").forEach((windowEl) => {
  WINDOW_RESIZE_DIRECTIONS.forEach((direction) => {
    const handle = document.createElement("span");
    handle.className = `window-resize-handle resize-${direction}`;
    handle.dataset.resize = direction;
    handle.setAttribute("aria-hidden", "true");
    windowEl.append(handle);
  });
});

document.querySelectorAll("[data-resize]").forEach((handle) => {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const windowEl = handle.closest(".widget-window");
    if (windowEl.classList.contains("maximized")) return;
    focusWindow(windowEl);

    const area = document.querySelector("#windows-area");
    const areaRect = area.getBoundingClientRect();
    const rect = windowEl.getBoundingClientRect();
    const initial = {
      left: rect.left - areaRect.left,
      top: rect.top - areaRect.top,
      width: rect.width,
      height: rect.height,
    };
    const direction = handle.dataset.resize;
    const areaWidth = windowsAreaWidth(area);
    const minWidth = Math.min(280, areaWidth);
    const minHeight = Math.min(190, area.clientHeight);
    handle.setPointerCapture(event.pointerId);

    const move = (moveEvent) => {
      const deltaX = moveEvent.clientX - event.clientX;
      const deltaY = moveEvent.clientY - event.clientY;
      let left = initial.left;
      let top = initial.top;
      let width = initial.width;
      let height = initial.height;

      if (direction.includes("e")) width = Math.max(minWidth, Math.min(areaWidth - left, initial.width + deltaX));
      if (direction.includes("s")) height = Math.max(minHeight, Math.min(area.clientHeight - top, initial.height + deltaY));
      if (direction.includes("w")) {
        width = Math.max(minWidth, Math.min(initial.left + initial.width, initial.width - deltaX));
        left = initial.left + initial.width - width;
      }
      if (direction.includes("n")) {
        height = Math.max(minHeight, Math.min(initial.top + initial.height, initial.height - deltaY));
        top = initial.top + initial.height - height;
      }

      windowEl.style.left = `${left}px`;
      windowEl.style.top = `${top}px`;
      windowEl.style.width = `${width}px`;
      windowEl.style.height = `${height}px`;
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      storeWindowLayout(windowEl);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  });
});

document.querySelectorAll("[data-drag-handle]").forEach((handle) => {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || window.matchMedia("(max-width: 620px)").matches) return;
    const windowEl = handle.closest(".widget-window");
    if (event.target.closest("button")) return;
    if (windowEl.classList.contains("maximized")) return;
    focusWindow(windowEl);
    const area = document.querySelector("#windows-area");
    const areaRect = area.getBoundingClientRect();
    const rect = windowEl.getBoundingClientRect();
    if (getComputedStyle(windowEl).position !== "absolute") {
      windowEl.style.position = "absolute";
      windowEl.style.left = `${rect.left - areaRect.left}px`;
      windowEl.style.top = `${rect.top - areaRect.top}px`;
      windowEl.style.width = `${rect.width}px`;
      windowEl.style.height = `${rect.height}px`;
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const initialLeft = parseFloat(windowEl.style.left);
    const initialTop = parseFloat(windowEl.style.top);
    const areaWidth = windowsAreaWidth(area);
    windowEl.classList.add("dragging");
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent) => {
      const left = Math.max(0, Math.min(areaWidth - windowEl.offsetWidth, initialLeft + moveEvent.clientX - startX));
      const top = Math.max(0, Math.min(area.clientHeight - 55, initialTop + moveEvent.clientY - startY));
      windowEl.style.left = `${left}px`;
      windowEl.style.top = `${top}px`;
    };
    const end = () => {
      windowEl.classList.remove("dragging");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      storeWindowLayout(windowEl);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  });
  handle.addEventListener("dblclick", (event) => {
    if (event.target.closest("button")) return;
    toggleMaximize(handle.closest(".widget-window"));
  });
});

document.querySelectorAll(".widget-window").forEach((windowEl) => {
  windowEl.addEventListener("pointerdown", () => focusWindow(windowEl));
});

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => {
    closeWindow(button.dataset.close);
  });
});

document.querySelectorAll("[data-minimize]").forEach((button) => {
  button.addEventListener("click", () => minimizeWindow(button.dataset.minimize));
});

document.querySelectorAll("[data-maximize]").forEach((button) => {
  button.addEventListener("click", () => toggleMaximize(button.closest(".widget-window")));
});

document.querySelectorAll(".nav-item[data-panel]").forEach((button) => {
  button.addEventListener("click", () => {
    openWindow(button.dataset.panel);
  });
});

document.querySelector("#customize-button").addEventListener("click", () => {
  document.querySelector("#customize-popover").classList.toggle("hidden");
});
document.querySelector("#close-customize").addEventListener("click", () => document.querySelector("#customize-popover").classList.add("hidden"));
document.querySelector("#theme-select").addEventListener("change", (event) => applyTheme(event.target.value));
document.querySelector("#show-all").addEventListener("change", (event) => {
  const windows = [...document.querySelectorAll(".widget-window")];
  if (event.target.checked) {
    windows.forEach((windowEl, index) => {
      if (!windowEl.style.width) positionWindow(windowEl, index);
    });
  }
  saveStored(STORAGE_KEYS.hiddenPanels, event.target.checked ? [] : PANEL_IDS);
  saveStored(STORAGE_KEYS.minimizedPanels, []);
  applyHiddenPanels();
});
document.querySelector("#reset-layout").addEventListener("click", resetLayout);

document.querySelector("#sidebar-toggle").addEventListener("click", () => {
  setSidebarHidden(!screens.dashboard.classList.contains("sidebar-hidden"));
});
document.querySelector("#logout-button").addEventListener("click", () => {
  if (!removeStored(STORAGE_KEYS.user)) return;
  document.querySelector("#password").value = "";
  document.querySelector("#otp").value = "";
  document.querySelector("#auth-error").textContent = "";
  document.querySelector("#start-button").classList.remove("launching");
  document.querySelector(".planet-large").classList.remove("launch-planet");
  configureAuthMode("login");
  setDrawingMode(false);
  showScreen("intro");
});
document.querySelector("#draw-toggle").addEventListener("click", () => setDrawingMode(!canvasIsDrawing));
document.querySelector("#canvas-tools-toggle").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const actions = document.querySelector("#canvas-actions");
  const expanded = button.getAttribute("aria-expanded") !== "true";
  actions.hidden = !expanded;
  button.setAttribute("aria-expanded", String(expanded));
  button.setAttribute("aria-label", expanded ? "Ocultar herramientas de dibujo" : "Mostrar herramientas de dibujo");
  button.title = expanded ? "Ocultar herramientas de dibujo" : "Mostrar herramientas de dibujo";
});
document.querySelector("#clear-canvas").addEventListener("click", clearInkCanvas);
function selectCanvasColor(color, persist = true) {
  if (!CANVAS_COLORS[color]) return;
  selectedCanvasColor = color;
  document.querySelectorAll("[data-ink-color]").forEach((button) => {
    const selected = button.dataset.inkColor === color;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  if (persist) saveStored(STORAGE_KEYS.canvasColor, color);
}
document.querySelectorAll("[data-ink-color]").forEach((button) => {
  button.addEventListener("click", () => selectCanvasColor(button.dataset.inkColor));
});
const savedCanvasColor = getStored(STORAGE_KEYS.canvasColor, "moonlight");
selectCanvasColor(CANVAS_COLORS[savedCanvasColor] ? savedCanvasColor : "moonlight", false);

function strokeSkyTear() {
  const brushSize = Number(document.querySelector("#brush-size").value);
  const color = CANVAS_COLORS[selectedCanvasColor];
  canvasContext.save();
  canvasContext.lineCap = "round";
  canvasContext.lineJoin = "round";
  canvasContext.strokeStyle = color.halo;
  canvasContext.lineWidth = brushSize * 2;
  canvasContext.shadowColor = color.glow;
  canvasContext.shadowBlur = brushSize * 2;
  canvasContext.stroke();
  canvasContext.strokeStyle = color.core;
  canvasContext.lineWidth = Math.max(1, brushSize * 0.5);
  canvasContext.shadowColor = color.glow;
  canvasContext.shadowBlur = brushSize;
  canvasContext.stroke();
  canvasContext.restore();
}
document.querySelector("#canvas-sheet").addEventListener("pointerdown", (event) => {
  if (!canvasIsDrawing || event.target !== document.querySelector("#canvas-ink")) return;
  const canvas = event.currentTarget.querySelector("#canvas-ink");
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  canvasContext.beginPath();
  canvasContext.moveTo(x, y);
  canvasContext.lineTo(x + 0.01, y + 0.01);
  strokeSkyTear();
  canvas.setPointerCapture(event.pointerId);
  canvas.dataset.drawingPointer = String(event.pointerId);
  canvas.dataset.lastX = String(x);
  canvas.dataset.lastY = String(y);
});
document.querySelector("#canvas-ink").addEventListener("pointermove", (event) => {
  const canvas = event.currentTarget;
  if (!canvasIsDrawing || canvas.dataset.drawingPointer !== String(event.pointerId)) return;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  canvasContext.beginPath();
  canvasContext.moveTo(Number(canvas.dataset.lastX), Number(canvas.dataset.lastY));
  canvasContext.lineTo(x, y);
  strokeSkyTear();
  canvas.dataset.lastX = String(x);
  canvas.dataset.lastY = String(y);
});
function stopCanvasStroke(event) {
  const canvas = document.querySelector("#canvas-ink");
  if (canvas.dataset.drawingPointer !== String(event.pointerId)) return;
  delete canvas.dataset.drawingPointer;
  delete canvas.dataset.lastX;
  delete canvas.dataset.lastY;
  canvasContext.closePath();
}
document.querySelector("#canvas-ink").addEventListener("pointerup", stopCanvasStroke);
document.querySelector("#canvas-ink").addEventListener("pointercancel", stopCanvasStroke);
new ResizeObserver(resizeInkCanvas).observe(document.querySelector("#canvas-sheet"));
window.addEventListener("resize", () => requestAnimationFrame(() => requestAnimationFrame(fitWindowsToArea)));
new ResizeObserver(fitWindowsToArea).observe(document.querySelector("#windows-area"));
document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() !== "p" || event.repeat || event.ctrlKey || event.altKey || event.metaKey) {
    lastCanvasClearKey = 0;
    return;
  }
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select"))) {
    lastCanvasClearKey = 0;
    return;
  }
  if (!canvasIsDrawing) {
    lastCanvasClearKey = 0;
    return;
  }
  const now = Date.now();
  if (now - lastCanvasClearKey <= 500 && lastCanvasClearKey !== 0) {
    event.preventDefault();
    lastCanvasClearKey = 0;
    clearInkCanvas();
    return;
  }
  lastCanvasClearKey = now;
});

document.querySelectorAll("[data-mood]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-mood]").forEach((option) => option.classList.toggle("chosen", option === button));
    document.querySelector("#health-detail").textContent = `${button.dataset.mood}. Gracias por hacer una pausa.`;
    showToast("Tu check-in quedó guardado en tu espacio.");
  });
});
document.querySelector("#study-action").addEventListener("click", () => showToast("Tu sesión de estudio está lista. ¡25 minutos para ti!"));
document.querySelector("#finance-action").addEventListener("click", () => showToast("Tu avance quedó anotado. Cada paso cuenta."));
document.querySelector("#fun-action").addEventListener("click", () => {
  const ideas = ["Escucha una canción que te encante.", "Tómate un descanso lejos de la pantalla.", "Retoma algo creativo que disfrutes.", "Sal a dar un paseo breve."];
  document.querySelector("#fun-detail").textContent = ideas[Math.floor(Math.random() * ideas.length)];
});

function openProfile() {
  const profile = getStored(STORAGE_KEYS.profile);
  showScreen("onboarding");
  startOnboarding(profile && profile.onboardingVersion === 1 ? profile : null);
}

let settingsDraft = {};
let settingsOpener;
let settingsImageProcessing = 0;
let settingsSaving = false;
let settingsGeneration = 0;

function updateSettingsSaveState() {
  document.querySelector("#save-settings").disabled = settingsSaving || settingsImageProcessing > 0;
}

function openSettings() {
  const user = getStored(STORAGE_KEYS.account) || getStored(STORAGE_KEYS.user);
  const settings = getStored(STORAGE_KEYS.settings, {});
  if (!user) {
    showToast("Inicia sesión para modificar tus ajustes.");
    return;
  }
  settingsGeneration += 1;
  settingsOpener = document.activeElement;
  settingsSaving = false;
  settingsDraft = {
    profileImage: user.profileImage || null,
    canvasImage: settings?.canvasImage || null,
  };
  document.querySelector("#settings-name").value = user.name || "";
  document.querySelector("#settings-email").value = user.email || "";
  document.querySelector("#settings-current-password").value = "";
  document.querySelector("#settings-new-password").value = "";
  document.querySelector("#settings-confirm-password").value = "";
  document.querySelector("#settings-avatar-file").value = "";
  document.querySelector("#settings-canvas-file").value = "";
  document.querySelector("#settings-error").textContent = "";
  renderSettingsAvatar(settingsDraft.profileImage, user.name);
  renderCanvasPreview(settingsDraft.canvasImage);
  document.querySelector("#settings-dialog").classList.remove("hidden");
  document.querySelector("#settings-name").focus();
}

function closeSettings() {
  if (settingsSaving) return;
  settingsGeneration += 1;
  document.querySelector("#settings-dialog").classList.add("hidden");
  if (settingsOpener instanceof HTMLElement) settingsOpener.focus();
}

function renderSettingsAvatar(image, name = "K") {
  const preview = document.querySelector("#settings-avatar-preview");
  const fallback = document.querySelector("#settings-avatar-fallback");
  if (image) {
    preview.src = image;
    preview.classList.remove("hidden");
    fallback.classList.add("hidden");
  } else {
    preview.removeAttribute("src");
    preview.classList.add("hidden");
    fallback.textContent = (name || "K").slice(0, 1).toUpperCase();
    fallback.classList.remove("hidden");
  }
}

function renderCanvasPreview(image) {
  const source = image || "Jupiter.png";
  document.querySelector("#canvas-image-preview").style.backgroundImage = `url("${source}")`;
}

async function compressImage(file, maxWidth, maxHeight) {
  if (!file || !file.type.startsWith("image/")) throw new Error("Selecciona un archivo de imagen válido.");
  if (file.size > 10 * 1024 * 1024) throw new Error("La imagen debe pesar menos de 10 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("El navegador no pudo procesar la imagen.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/webp", 0.82);
    if (image.length > 3_500_000) throw new Error("La imagen sigue siendo demasiado pesada. Elige otra más pequeña.");
    return image;
  } finally {
    bitmap.close();
  }
}

function showSettingsError(message) {
  document.querySelector("#settings-error").textContent = message;
}

document.querySelector("#settings-button").addEventListener("click", openSettings);
document.querySelector("#close-settings").addEventListener("click", closeSettings);
document.querySelector("#cancel-settings").addEventListener("click", closeSettings);
document.querySelector("#settings-dialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeSettings();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !document.querySelector("#settings-dialog").classList.contains("hidden")) {
    closeSettings();
  }
});
document.querySelector("#settings-avatar-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const generation = settingsGeneration;
  settingsImageProcessing += 1;
  updateSettingsSaveState();
  try {
    const image = await compressImage(file, 640, 640);
    if (generation === settingsGeneration) {
      settingsDraft.profileImage = image;
      renderSettingsAvatar(image, document.querySelector("#settings-name").value);
      showSettingsError("");
    }
  } catch (error) {
    if (generation === settingsGeneration) showSettingsError(error.message || "No se pudo procesar la foto de perfil.");
  } finally {
    settingsImageProcessing -= 1;
    updateSettingsSaveState();
  }
});
document.querySelector("#settings-canvas-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const generation = settingsGeneration;
  settingsImageProcessing += 1;
  updateSettingsSaveState();
  try {
    const image = await compressImage(file, 1920, 1440);
    if (generation === settingsGeneration) {
      settingsDraft.canvasImage = image;
      renderCanvasPreview(image);
      showSettingsError("");
    }
  } catch (error) {
    if (generation === settingsGeneration) showSettingsError(error.message || "No se pudo procesar la foto del lienzo.");
  } finally {
    settingsImageProcessing -= 1;
    updateSettingsSaveState();
  }
});
document.querySelector("#settings-name").addEventListener("input", (event) => {
  if (!settingsDraft.profileImage) renderSettingsAvatar(null, event.target.value);
});
document.querySelector("#reset-canvas-image").addEventListener("click", () => {
  settingsDraft.canvasImage = null;
  renderCanvasPreview(null);
  document.querySelector("#settings-canvas-file").value = "";
  showSettingsError("");
});
document.querySelector("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const user = getStored(STORAGE_KEYS.user);
  const account = getStored(STORAGE_KEYS.account) || user;
  const error = document.querySelector("#settings-error");
  const name = document.querySelector("#settings-name").value.trim();
  const emailInput = document.querySelector("#settings-email");
  const currentPassword = document.querySelector("#settings-current-password").value;
  const newPassword = document.querySelector("#settings-new-password").value;
  const confirmation = document.querySelector("#settings-confirm-password").value;
  if (!user || !account) {
    showSettingsError("La sesión ha terminado. Vuelve a iniciar sesión.");
    return;
  }
  if (!name) {
    showSettingsError("Escribe tu nombre para continuar.");
    document.querySelector("#settings-name").focus();
    return;
  }
  if (!emailInput.checkValidity()) {
    showSettingsError("Escribe un correo electrónico válido.");
    emailInput.focus();
    return;
  }
  if (newPassword || currentPassword || confirmation) {
    if (!newPassword || !currentPassword || !confirmation) {
      showSettingsError("Completa la contraseña actual, la nueva y su confirmación.");
      return;
    }
    if (!account.credential) {
      showSettingsError("Cierra sesión y vuelve a entrar una vez para activar el cambio seguro de contraseña.");
      return;
    }
    if (newPassword.length < 8) {
      showSettingsError("La nueva contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (newPassword !== confirmation) {
      showSettingsError("La confirmación no coincide con la nueva contraseña.");
      return;
    }
    try {
      if (!await verifyPassword(currentPassword, account.credential)) {
        showSettingsError("La contraseña actual no es correcta.");
        return;
      }
    } catch (credentialError) {
      console.error("No se pudo verificar la contraseña actual.", credentialError);
      showSettingsError("No se pudo verificar la contraseña en este dispositivo.");
      return;
    }
  }

  if (settingsImageProcessing > 0) {
    showSettingsError("Espera a que termine el procesamiento de las imágenes.");
    return;
  }
  settingsSaving = true;
  updateSettingsSaveState();
  document.querySelectorAll(".settings-file-input").forEach((input) => {
    input.disabled = true;
  });
  try {
    const previousAccount = account;
    const previousSession = user;
    const updatedUser = {
      ...account,
      name,
      email: emailInput.value.trim(),
    };
    if (settingsDraft.profileImage) updatedUser.profileImage = settingsDraft.profileImage;
    else delete updatedUser.profileImage;
    if (newPassword) updatedUser.credential = await createPasswordCredential(newPassword);
    if (!saveStored(STORAGE_KEYS.account, updatedUser)) {
      showSettingsError("No se pudieron guardar los datos de cuenta en este dispositivo.");
      return;
    }
    const updatedSession = { name: updatedUser.name, created: updatedUser.created };
    if (!saveStored(STORAGE_KEYS.user, updatedSession)) {
      try {
        localStorage.setItem(STORAGE_KEYS.account, JSON.stringify(previousAccount));
        localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(previousSession));
      } catch (rollbackError) {
        console.error("No se pudo revertir la cuenta después de un error al guardar la sesión.", rollbackError);
      }
      showSettingsError("No se pudieron guardar los datos de sesión en este dispositivo.");
      return;
    }

    const storedSettings = getStored(STORAGE_KEYS.settings, {}) || {};
    const updatedSettings = { ...storedSettings };
    if (settingsDraft.canvasImage) updatedSettings.canvasImage = settingsDraft.canvasImage;
    else delete updatedSettings.canvasImage;
    if (!saveStored(STORAGE_KEYS.settings, updatedSettings)) {
      try {
        localStorage.setItem(STORAGE_KEYS.account, JSON.stringify(previousAccount));
        localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(previousSession));
      } catch (rollbackError) {
        console.error("No se pudo revertir la cuenta después de un error al guardar los ajustes.", rollbackError);
      }
      showSettingsError("No se pudieron guardar los cambios. Libera espacio del navegador e inténtalo de nuevo.");
      return;
    }
    renderProfileButton(updatedUser);
    applyWorkspaceImage();
    closeSettings();
    showToast("Tus ajustes se guardaron en este dispositivo.");
  } catch (saveError) {
    console.error("No se pudieron guardar los ajustes locales.", saveError);
    showSettingsError("No se pudieron guardar los ajustes. Inténtalo de nuevo.");
  } finally {
    settingsSaving = false;
    document.querySelectorAll(".settings-file-input").forEach((input) => {
      input.disabled = false;
    });
    updateSettingsSaveState();
  }
});

document.querySelector("#edit-profile").addEventListener("click", openProfile);
document.querySelector("#profile-button").addEventListener("click", openProfile);

const existingUser = getStored(STORAGE_KEYS.user);
if (existingUser) {
  const profile = getStored(STORAGE_KEYS.profile);
  const account = getStored(STORAGE_KEYS.account) || existingUser;
  if (profile) enterDashboard(account, profile);
}
