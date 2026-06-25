const storageKeys = {
  auth: "twoplace.auth",
  apiToken: "twoplace.apiToken",
  room: "twoplace.room",
  played: "twoplace.played",
  links: "twoplace.links"
};

const accessHash = "dbe56f2d3bf0ee960d5950fbb280f4f874c0e9a141eaf2db1fcbe399e813daab";
const appVersion = "worker-proxy-v1";
const requestTimeoutMs = 180000;
const imagePlaceholder =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%23f8fbff'/%3E%3C/svg%3E";

let sharedState = {
  apiToken: null,
  roomId: null,
  initialized: false,
  galleryReady: false,
  memoriesReady: false,
  pendingMemories: [],
  memoriesCache: [],
  pollTimer: null
};

function setStatus(selector, message) {
  const status = document.querySelector(selector);
  if (status) {
    status.textContent = message;
  }
}

function setSyncStatus(message) {
  setStatus("#sync-status", message);
}

function setGalleryStatus(message) {
  setStatus("#gallery-status", message);
}

function withTimeout(promise, message = "Запрос занял слишком много времени.", timeoutMs = requestTimeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function retryOnce(task) {
  try {
    return await task();
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    return task().catch(() => {
      throw error;
    });
  }
}

const words = [
  { word: "объятие", hint: "То, чего особенно не хватает на расстоянии" },
  { word: "письмо", hint: "Можно отправить даже без конверта" },
  { word: "созвон", hint: "Вечерний ритуал, который спасает день" },
  { word: "мандарин", hint: "Сладкий зимний запах" },
  { word: "пикник", hint: "Идея для будущей встречи" },
  { word: "комета", hint: "Что-то редкое и красивое" }
];

const alphabet = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя".split("");

let hangman = {
  word: "",
  hint: "",
  author: "Набор",
  guesser: "Вы",
  guessed: new Set(),
  mistakes: 0,
  complete: false
};

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getApiConfig() {
  const config = window.LYUBIMOE_API || {};
  return {
    url: (config.url || "").replace(/\/+$/, ""),
    roomSlug: (config.roomSlug || "preview").trim()
  };
}

function hasApiConfig() {
  return Boolean(getApiConfig().url);
}

async function apiRequest(path, options = {}) {
  const config = getApiConfig();
  const headers = new Headers(options.headers || {});

  if (sharedState.apiToken) {
    headers.set("Authorization", `Bearer ${sharedState.apiToken}`);
  }

  let body = options.body;
  if (body && !(body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }

  const response = await withTimeout(
    fetch(`${config.url}${path}`, {
      method: options.method || "GET",
      headers,
      body
    }),
    "Общая комната долго не отвечает."
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Ошибка ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function hashText(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function unlockRoom() {
  document.body.classList.remove("locked");
  document.body.classList.add("unlocked");
}

function initAccessGate() {
  const form = document.querySelector("#auth-form");
  const input = document.querySelector("#auth-passphrase");
  const submit = form.querySelector("button");
  const error = document.querySelector("#auth-error");

  if (!hasApiConfig()) {
    error.textContent = "Нужно заполнить API URL в supabase-config.js.";
    submit.disabled = true;
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    submit.disabled = true;

    try {
      const config = getApiConfig();
      const hash = await hashText(input.value.trim());
      if (hash !== accessHash) {
        throw new Error("Не та фраза.");
      }

      const session = await apiRequest("/auth/join", {
        method: "POST",
        body: {
          roomSlug: config.roomSlug,
          passphrase: input.value.trim()
        }
      });

      sharedState.roomId = session.roomId;
      sharedState.apiToken = session.token;
      localStorage.setItem(storageKeys.auth, accessHash);
      localStorage.setItem(storageKeys.room, session.roomId);
      localStorage.setItem(storageKeys.apiToken, session.token);
      input.value = "";
      unlockRoom();
      startSharedRoom();
    } catch (errorValue) {
      error.textContent = errorValue.message || "Не получилось войти.";
      input.select();
    } finally {
      submit.disabled = false;
    }
  });

  if (
    localStorage.getItem(storageKeys.auth) === accessHash &&
    localStorage.getItem(storageKeys.room) &&
    localStorage.getItem(storageKeys.apiToken)
  ) {
    sharedState.roomId = localStorage.getItem(storageKeys.room);
    sharedState.apiToken = localStorage.getItem(storageKeys.apiToken);
    unlockRoom();
    startSharedRoom();
  }
}

function startSharedRoom() {
  if (sharedState.initialized || !sharedState.roomId) return;
  sharedState.initialized = true;
  setSyncStatus("Общая комната подключена.");
  initGallery();
  initMemories();
  initPolling();
}

function setRoute(route) {
  const nextRoute = route || "home";
  document.querySelectorAll("[data-view]").forEach((view) => {
    view.classList.toggle("active", view.id === nextRoute);
  });
  document.querySelectorAll("[data-route]").forEach((link) => {
    link.classList.toggle("active", link.dataset.route === nextRoute);
  });
}

function initRouter() {
  const apply = () => setRoute(location.hash.replace("#", "") || "home");
  window.addEventListener("hashchange", apply);
  apply();
}

function pickWord() {
  const item = words[Math.floor(Math.random() * words.length)];
  hangman = {
    word: item.word,
    hint: item.hint,
    author: "Набор",
    guesser: "вы вдвоём",
    guessed: new Set(),
    mistakes: 0,
    complete: false
  };
  renderHangman();
}

function startCustomRound(author, word, hint) {
  const cleanWord = word.toLowerCase().replace(/[^а-яё]/g, "");
  if (!cleanWord || !hint.trim()) return false;

  hangman = {
    word: cleanWord,
    hint: hint.trim(),
    author,
    guesser: author === "Даша" ? "ты" : "Даша",
    guessed: new Set(),
    mistakes: 0,
    complete: false
  };
  renderHangman();
  return true;
}

function renderHangman() {
  const wordEl = document.querySelector("#hangman-word");
  const hintEl = document.querySelector("#hangman-hint");
  const ownerEl = document.querySelector("#round-owner");
  const mistakesEl = document.querySelector("#mistakes");
  const usedEl = document.querySelector("#used-letters");
  const resultEl = document.querySelector("#game-result");
  const lettersEl = document.querySelector("#letters");

  wordEl.innerHTML = "";
  hangman.word.split("").forEach((letter) => {
    const cell = document.createElement("span");
    cell.className = "word-cell";
    cell.textContent = hangman.guessed.has(letter) || hangman.complete ? letter : "";
    wordEl.append(cell);
  });

  if (hangman.author === "Набор") {
    ownerEl.textContent = "Сейчас слово выбрано из общего набора.";
  } else if (hangman.author === "Даша") {
    ownerEl.textContent = "Даша загадала слово для тебя.";
  } else {
    ownerEl.textContent = "Ты загадал слово для Даши.";
  }
  hintEl.textContent = `Подсказка: ${hangman.hint}`;
  mistakesEl.textContent = `Ошибки: ${hangman.mistakes} / 6`;
  const usedLetters = [...hangman.guessed].join(", ");
  usedEl.textContent = `Буквы: ${usedLetters || "нет"}`;

  lettersEl.innerHTML = "";
  alphabet.forEach((letter) => {
    const button = document.createElement("button");
    button.className = "letter";
    button.type = "button";
    button.textContent = letter;
    button.disabled = hangman.guessed.has(letter) || hangman.complete;
    button.addEventListener("click", () => guessLetter(letter));
    lettersEl.append(button);
  });

  const isWin = hangman.word.split("").every((letter) => hangman.guessed.has(letter));
  if (isWin && !hangman.complete) {
    hangman.complete = true;
    incrementPlayed();
  }

  if (hangman.mistakes >= 6 && !hangman.complete) {
    hangman.complete = true;
    incrementPlayed();
  }

  if (isWin) {
    resultEl.textContent = `Победа. ${hangman.guesser} раскрыл(а) слово, можно начинать следующий раунд.`;
  } else if (hangman.mistakes >= 6) {
    resultEl.textContent = `Раунд окончен. Было загадано слово: ${hangman.word}.`;
  } else {
    resultEl.textContent =
      hangman.author === "Набор"
        ? "Буквы можно открывать по очереди, как будто игра идёт в одной комнате."
        : "Слово спрятано. Теперь второй игрок выбирает буквы и смотрит только на подсказку.";
  }
}

function guessLetter(letter) {
  if (hangman.complete) return;
  hangman.guessed.add(letter);
  if (!hangman.word.includes(letter)) {
    hangman.mistakes += 1;
  }
  renderHangman();
}

function incrementPlayed() {
  const current = Number(localStorage.getItem(storageKeys.played) || "0") + 1;
  localStorage.setItem(storageKeys.played, String(current));
  updateCounters();
}

function initGames() {
  document.querySelector("#new-word").addEventListener("click", pickWord);
  document.querySelector("#hangman-setup").addEventListener("submit", (event) => {
    event.preventDefault();
    const author = document.querySelector("#hangman-author").value;
    const wordInput = document.querySelector("#custom-word");
    const hintInput = document.querySelector("#custom-hint");
    const started = startCustomRound(author, wordInput.value, hintInput.value);
    if (started) {
      wordInput.value = "";
      hintInput.value = "";
    }
  });
  document.querySelectorAll("[data-game]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-game]").forEach((tile) => {
        tile.classList.toggle("active", tile === button);
      });

      const selected = button.dataset.game;
      document.querySelector("#hangman-panel").classList.toggle("hidden", selected !== "hangman");
      document.querySelector("#coming-soon-panel").classList.toggle("hidden", selected === "hangman");

      if (selected !== "hangman") {
        document.querySelector("#coming-title").textContent = button.querySelector("strong").textContent;
        document.querySelector("#coming-text").textContent =
          selected === "balda"
            ? "Поле, ходы по очереди, слова и счёт добавим следующим игровым блоком."
            : "Лёгкий режим с вопросами друг другу для созвонов и спокойных вечеров.";
      }
    });
  });
  pickWord();
}

function fileToGalleryImage(file, onReady, onError) {
  let completed = false;
  const fallbackTimer = setTimeout(() => {
    if (!completed) {
      completed = true;
      onReady(file);
    }
  }, 6000);

  const finish = (blob) => {
    if (completed) return;
    completed = true;
    clearTimeout(fallbackTimer);
    onReady(blob);
  };

  const fail = () => {
    if (completed) return;
    completed = true;
    clearTimeout(fallbackTimer);
    onError?.();
  };

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    const image = new Image();
    image.addEventListener("load", () => {
      const maxSize = 1000;
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      canvas.width = width;
      canvas.height = height;
      context.drawImage(image, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) {
          finish(file);
          return;
        }
        finish(blob);
      }, "image/jpeg", 0.78);
    });
    image.addEventListener("error", () => finish(file));
    image.src = reader.result;
  });
  reader.addEventListener("error", fail);
  reader.readAsDataURL(file);
}

async function deleteGalleryItem(id) {
  if (!sharedState.apiToken || !sharedState.roomId) return;
  try {
    await apiRequest(`/gallery/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    alert("Не получилось удалить карточку.");
    return;
  }

  await renderGallery();
}

function renderGalleryEmpty(grid) {
  const card = document.createElement("article");
  card.className = "gallery-card";
  const placeholder = document.createElement("div");
  placeholder.className = "placeholder-art";
  placeholder.textContent = "Галерея";
  const body = document.createElement("div");
  body.className = "gallery-card-body";
  const caption = document.createElement("p");
  caption.textContent = "Здесь будут фотографии, мемы и случайные находки.";
  body.append(caption);
  card.append(placeholder, body);
  grid.append(card);
}

function getUploadExtension(blob) {
  if (blob.type === "image/png") return "png";
  if (blob.type === "image/webp") return "webp";
  if (blob.type === "image/gif") return "gif";
  return "jpg";
}

async function getGalleryItems() {
  const response = await retryOnce(() => apiRequest("/gallery"));
  return response.items || [];
}

function getGalleryImageUrl(id) {
  return `${getApiConfig().url}/gallery/file/${encodeURIComponent(id)}?token=${encodeURIComponent(sharedState.apiToken)}`;
}

function loadGalleryImage(image, id) {
  image.addEventListener(
    "error",
    () => {
      image.alt = "Картинка пока не открылась";
      setGalleryStatus("Картинка пока не открылась. Обновите страницу или попробуйте ещё раз.");
    },
    { once: true }
  );
  image.src = getGalleryImageUrl(id);
}

function openPhotoViewer(id, caption) {
  const viewer = document.querySelector("#photo-viewer");
  const image = document.querySelector("#photo-viewer-image");
  const captionEl = document.querySelector("#photo-viewer-caption");
  if (!viewer || !image || !captionEl) return;

  captionEl.textContent = caption || "";
  image.removeAttribute("src");
  viewer.classList.remove("hidden");
  image.addEventListener(
    "error",
    () => {
      captionEl.textContent = "Картинка пока не открылась. Обновите страницу или попробуйте ещё раз.";
    },
    { once: true }
  );

  image.src = getGalleryImageUrl(id);
}

function closePhotoViewer() {
  const viewer = document.querySelector("#photo-viewer");
  const image = document.querySelector("#photo-viewer-image");
  const caption = document.querySelector("#photo-viewer-caption");
  viewer?.classList.add("hidden");
  image?.removeAttribute("src");
  if (caption) caption.textContent = "";
}

async function renderGallery() {
  const grid = document.querySelector("#gallery-grid");
  grid.innerHTML = "";

  if (!sharedState.apiToken || !sharedState.roomId) {
    renderGalleryEmpty(grid);
    setGalleryStatus("Галерея ждёт входа.");
    return;
  }

  let items = [];
  try {
    setGalleryStatus("Загружаем галерею...");
    setSyncStatus("Загружаем общую комнату...");
    items = await getGalleryItems();
  } catch {
    renderGalleryEmpty(grid);
    setSyncStatus("Не получилось прочитать общую галерею.");
    setGalleryStatus("Не получилось прочитать галерею.");
    return;
  }

  if (!items.length) {
    renderGalleryEmpty(grid);
    setGalleryStatus("Галерея пока пустая.");
    return;
  }

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "gallery-card";

    const image = document.createElement("img");
    image.alt = item.caption || "Изображение из галереи";
    image.src = imagePlaceholder;
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("click", () => openPhotoViewer(item.id, item.caption));
    card.append(image);
    loadGalleryImage(image, item.id);

    const body = document.createElement("div");
    body.className = "gallery-card-body";
    const caption = document.createElement("p");
    caption.textContent = item.caption || "Без подписи";
    const deleteButton = document.createElement("button");
    deleteButton.className = "gallery-delete";
    deleteButton.type = "button";
    deleteButton.textContent = "Удалить";
    deleteButton.setAttribute("aria-label", `Удалить из галереи: ${item.caption || "изображение"}`);
    deleteButton.addEventListener("click", () => {
      if (confirm("Удалить эту карточку из галереи?")) {
        deleteGalleryItem(item.id);
      }
    });
    body.append(caption, deleteButton);

    card.append(body);
    grid.append(card);
  });

  setSyncStatus("Общая комната подключена.");
  setGalleryStatus(`Галерея подключена. Версия ${appVersion}.`);
}

function initGallery() {
  if (sharedState.galleryReady) {
    renderGallery();
    return;
  }
  sharedState.galleryReady = true;

  document.querySelector("#gallery-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const file = document.querySelector("#gallery-file").files[0];
    const caption = document.querySelector("#gallery-caption").value.trim();
    if (!file || !sharedState.apiToken || !sharedState.roomId) return;

    const submitButton = event.target.querySelector("button");
    submitButton.disabled = true;
    setGalleryStatus("Готовим картинку...");

    const saveItem = async (blob) => {
      try {
        setSyncStatus("Загружаем картинку...");
        setGalleryStatus("Загружаем картинку...");
        const formData = new FormData();
        formData.append("file", blob, `photo.${getUploadExtension(blob)}`);
        formData.append("caption", caption);
        await apiRequest("/gallery", {
          method: "POST",
          body: formData
        });

        event.target.reset();
        setSyncStatus("Картинка сохранена в общей комнате.");
        setGalleryStatus("Картинка сохранена.");
        await renderGallery();
      } catch (error) {
        submitButton.disabled = false;
        setSyncStatus(`Не получилось добавить карточку: ${error.message}`);
        setGalleryStatus(`Не получилось добавить карточку: ${error.message}`);
        alert("Не получилось загрузить картинку.");
        return;
      }

      submitButton.disabled = false;
    };

    fileToGalleryImage(file, saveItem, () => {
      submitButton.disabled = false;
      setGalleryStatus("Не получилось подготовить картинку.");
    });
  });
  renderGallery();
}

function defaultMemories() {
  return [];
}

async function deleteMemoryItem(id) {
  if (!sharedState.apiToken || !sharedState.roomId) return;
  try {
    await apiRequest(`/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    alert("Не получилось удалить запись.");
    return;
  }

  await renderMemories();
}

function renderMemoriesEmpty(timeline) {
  const card = document.createElement("article");
  card.className = "memory-card";
  const text = document.createElement("p");
  text.textContent = "Пока тут тихо.";
  card.append(text);
  timeline.append(card);
}

function appendMemoryCard(timeline, item) {
  const card = document.createElement("article");
  card.className = "memory-card";
  if (item.pending) {
    card.classList.add("pending");
  }
  const time = document.createElement("time");
  time.dateTime = item.created_at;
  time.textContent = new Date(item.created_at).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long"
  });
  const text = document.createElement("p");
  text.textContent = item.text;
  card.append(time, text);

  if (item.pending) {
    const pendingNote = document.createElement("span");
    pendingNote.className = "memory-pending";
    pendingNote.textContent = "Сохраняется...";
    card.append(pendingNote);
  } else {
    const deleteButton = document.createElement("button");
    deleteButton.className = "memory-delete";
    deleteButton.type = "button";
    deleteButton.textContent = "Удалить";
    deleteButton.setAttribute("aria-label", "Удалить запись из воспоминаний");
    deleteButton.addEventListener("click", () => {
      if (confirm("Удалить эту запись?")) {
        deleteMemoryItem(item.id);
      }
    });
    card.append(deleteButton);
  }

  timeline.append(card);
}

function renderPendingMemories() {
  const timeline = document.querySelector("#timeline");
  timeline.innerHTML = "";
  const items = [...sharedState.pendingMemories, ...sharedState.memoriesCache];
  if (!items.length) {
    renderMemoriesEmpty(timeline);
    return;
  }
  items.forEach((item) => appendMemoryCard(timeline, item));
}

async function getMemories() {
  const response = await retryOnce(() => apiRequest("/memories"));
  return response.items || [];
}

async function renderMemories() {
  const timeline = document.querySelector("#timeline");
  timeline.innerHTML = "";

  if (!sharedState.apiToken || !sharedState.roomId) {
    renderMemoriesEmpty(timeline);
    return;
  }

  let memories = [];
  try {
    memories = await getMemories();
    sharedState.memoriesCache = memories;
  } catch {
    if (sharedState.pendingMemories.length) {
      renderPendingMemories();
    } else {
      renderMemoriesEmpty(timeline);
    }
    setSyncStatus("Не получилось прочитать общую ленту.");
    return;
  }

  memories = [...sharedState.pendingMemories, ...memories];

  if (!memories.length) {
    renderMemoriesEmpty(timeline);
    return;
  }

  memories.forEach((item) => appendMemoryCard(timeline, item));
}

function initMemories() {
  if (sharedState.memoriesReady) {
    renderMemories();
    return;
  }
  sharedState.memoriesReady = true;

  document.querySelector("#memory-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#memory-text");
    const text = input.value.trim();
    if (!text || !sharedState.apiToken || !sharedState.roomId) return;

    const submitButton = event.target.querySelector("button");
    const pendingMemory = {
      id: `pending-${createId()}`,
      text,
      created_at: new Date().toISOString(),
      pending: true
    };

    submitButton.disabled = true;
    input.value = "";
    sharedState.pendingMemories.unshift(pendingMemory);
    renderPendingMemories();
    setSyncStatus("Сохраняем запись...");

    const slowSaveTimer = setTimeout(() => {
      submitButton.disabled = false;
      setSyncStatus("Связь медленная, но запись ещё сохраняется.");
    }, 10000);

    apiRequest("/memories", {
      method: "POST",
      body: { text }
    })
      .then(async () => {
        clearTimeout(slowSaveTimer);
        submitButton.disabled = false;
        sharedState.pendingMemories = sharedState.pendingMemories.filter((item) => item.id !== pendingMemory.id);
        setSyncStatus("Запись сохранена в общей комнате.");
        await renderMemories();
      })
      .catch((error) => {
        clearTimeout(slowSaveTimer);
        submitButton.disabled = false;
        setSyncStatus(`Не получилось сохранить запись: ${error.message}`);
        sharedState.pendingMemories = sharedState.pendingMemories.filter((item) => item.id !== pendingMemory.id);
        input.value = text;
        renderMemories();
        alert("Не получилось сохранить запись.");
      });
  });
  renderMemories();
}

function initPolling() {
  if (sharedState.pollTimer) {
    clearInterval(sharedState.pollTimer);
  }

  sharedState.pollTimer = setInterval(() => {
    if (!document.hidden && sharedState.apiToken) {
      renderGallery();
      renderMemories();
    }
  }, 15000);
}

function defaultLinks() {
  return [
    {
      title: "MTS Link",
      url: "https://mts-link.ru/",
      note: "Созвоны, совместные просмотры и разговоры вечером."
    },
    {
      title: "Сериалы вместе",
      url: "https://www.kinopoisk.ru/",
      note: "Быстрый переход к выбору вечернего просмотра."
    },
    {
      title: "Спорт",
      url: "https://www.sports.ru/",
      note: "Матчи, новости и соревнования, которые смотрите вдвоём."
    }
  ];
}

function renderLinks() {
  const links = readJson(storageKeys.links, defaultLinks());
  const grid = document.querySelector("#links-grid");
  grid.innerHTML = "";

  links.forEach((item) => {
    const link = document.createElement("a");
    link.className = "quick-link";
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noreferrer";

    const body = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = item.title;
    const note = document.createElement("span");
    note.textContent = item.note || item.url;
    body.append(title, note);

    const icon = document.createElement("span");
    icon.className = "quick-link-icon";
    icon.textContent = "↗";

    link.append(body, icon);
    grid.append(link);
  });
}

function initLinks() {
  document.querySelector("#link-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const titleInput = document.querySelector("#link-title");
    const urlInput = document.querySelector("#link-url");
    const title = titleInput.value.trim();
    const url = urlInput.value.trim();
    if (!title || !url) return;

    const links = readJson(storageKeys.links, defaultLinks());
    links.unshift({ title, url, note: "В быстрых ссылках." });
    writeJson(storageKeys.links, links.slice(0, 12));
    event.target.reset();
    renderLinks();
  });
  renderLinks();
}

function updateCounters() {
}

function initPhotoViewer() {
  document.querySelector("#photo-viewer-close")?.addEventListener("click", closePhotoViewer);
  document.querySelector("#photo-viewer")?.addEventListener("click", (event) => {
    if (event.target.id === "photo-viewer") {
      closePhotoViewer();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closePhotoViewer();
    }
  });
}

initAccessGate();
initRouter();
initGames();
initLinks();
initPhotoViewer();
updateCounters();
