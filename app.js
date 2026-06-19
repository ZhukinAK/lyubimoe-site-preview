const storageKeys = {
  gallery: "twoplace.gallery",
  memories: "twoplace.memories",
  played: "twoplace.played",
  links: "twoplace.links"
};

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
  author: "Демо",
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
    author: "Демо",
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

  if (hangman.author === "Демо") {
    ownerEl.textContent = "Сейчас слово выбрано из демо-базы.";
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
      hangman.author === "Демо"
        ? "Выбирайте буквы по очереди, как будто играете в одной комнате."
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
            ? "Здесь будет поле, ходы по очереди, слова и счёт. После Виселицы это главный кандидат."
            : "Лёгкий режим с вопросами друг другу, который можно открывать во время созвона.";
      }
    });
  });
  pickWord();
}

function renderGallery() {
  const gallery = readJson(storageKeys.gallery, []);
  const grid = document.querySelector("#gallery-grid");
  grid.innerHTML = "";

  const items = gallery.length
    ? gallery
    : [
        {
          caption: "Здесь будут ваши фотографии, мемы и случайные находки.",
          src: ""
        }
      ];

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "gallery-card";

    if (item.src) {
      const image = document.createElement("img");
      image.src = item.src;
      image.alt = item.caption || "Изображение из галереи";
      card.append(image);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "placeholder-art";
      placeholder.textContent = "Галерея";
      card.append(placeholder);
    }

    const body = document.createElement("div");
    const caption = document.createElement("p");
    caption.textContent = item.caption || "Без подписи";
    body.append(caption);
    card.append(body);
    grid.append(card);
  });

  updateCounters();
}

function initGallery() {
  document.querySelector("#gallery-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const file = document.querySelector("#gallery-file").files[0];
    const caption = document.querySelector("#gallery-caption").value.trim();
    if (!file && !caption) return;

    const saveItem = (src) => {
      const gallery = readJson(storageKeys.gallery, []);
      gallery.unshift({ src, caption, createdAt: new Date().toISOString() });
      writeJson(storageKeys.gallery, gallery.slice(0, 18));
      event.target.reset();
      renderGallery();
    };

    if (!file) {
      saveItem("");
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => saveItem(reader.result));
    reader.readAsDataURL(file);
  });
  renderGallery();
}

function defaultMemories() {
  return [
    {
      text: "Идея: добавить кнопку случайного вопроса для вечернего созвона.",
      createdAt: new Date().toISOString()
    },
    {
      text: "Будущий модуль: открытки, которые можно оставлять друг другу перед сном.",
      createdAt: new Date(Date.now() - 86400000).toISOString()
    }
  ];
}

function renderMemories() {
  const memories = readJson(storageKeys.memories, defaultMemories());
  const timeline = document.querySelector("#timeline");
  timeline.innerHTML = "";

  memories.forEach((item) => {
    const card = document.createElement("article");
    card.className = "memory-card";
    const time = document.createElement("time");
    time.dateTime = item.createdAt;
    time.textContent = new Date(item.createdAt).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long"
    });
    const text = document.createElement("p");
    text.textContent = item.text;
    card.append(time, text);
    timeline.append(card);
  });
}

function initMemories() {
  document.querySelector("#memory-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#memory-text");
    const text = input.value.trim();
    if (!text) return;

    const memories = readJson(storageKeys.memories, defaultMemories());
    memories.unshift({ text, createdAt: new Date().toISOString() });
    writeJson(storageKeys.memories, memories.slice(0, 20));
    input.value = "";
    renderMemories();
  });
  renderMemories();
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
      note: "Быстрый переход туда, где выбираете, что смотреть."
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
    links.unshift({ title, url, note: "Добавлено в быстрые ссылки." });
    writeJson(storageKeys.links, links.slice(0, 12));
    event.target.reset();
    renderLinks();
  });
  renderLinks();
}

function updateCounters() {
  const gallery = readJson(storageKeys.gallery, []);
  document.querySelector("#gallery-count").textContent = String(gallery.length);
  document.querySelector("#played-count").textContent = localStorage.getItem(storageKeys.played) || "0";
}

initRouter();
initGames();
initGallery();
initMemories();
initLinks();
updateCounters();
