const colorSchemeStorageKey = "color-scheme";
const documentRoot = document.documentElement;
const colorSchemeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

function normalizeSearchValue(value) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").trim();
}

function readStoredColorScheme() {
  try {
    const scheme = window.localStorage.getItem(colorSchemeStorageKey);

    return scheme === "light" || scheme === "dark" ? scheme : null;
  } catch (error) {
    return null;
  }
}

function updateThemeToggle(toggle, scheme) {
  const isDark = scheme === "dark";
  const icon = document.createElement("i");

  icon.className = isDark ? "fas fa-sun" : "fas fa-moon";
  icon.setAttribute("aria-hidden", "true");
  toggle.replaceChildren(icon);
  toggle.setAttribute("aria-label", isDark ? "라이트 모드로 전환" : "다크 모드로 전환");
  toggle.setAttribute("aria-pressed", String(isDark));
}

function applyColorScheme(scheme, toggle, shouldStore) {
  documentRoot.dataset.colorScheme = scheme;
  updateThemeToggle(toggle, scheme);

  if (!shouldStore) {
    return;
  }

  try {
    window.localStorage.setItem(colorSchemeStorageKey, scheme);
  } catch (error) {
    return;
  }
}

function registerThemeToggle() {
  const toggle = document.querySelector("[data-theme-toggle]");

  if (!toggle) {
    return;
  }

  updateThemeToggle(toggle, documentRoot.dataset.colorScheme === "dark" ? "dark" : "light");

  toggle.addEventListener("click", () => {
    const nextScheme = documentRoot.dataset.colorScheme === "dark" ? "light" : "dark";

    applyColorScheme(nextScheme, toggle, true);
  });

  colorSchemeMediaQuery.addEventListener("change", (event) => {
    if (readStoredColorScheme()) {
      return;
    }

    applyColorScheme(event.matches ? "dark" : "light", toggle, false);
  });
}

function registerStoryFilters() {
  const form = document.querySelector("[data-search-form]");
  const input = document.querySelector("[data-search-input]");
  const filters = Array.from(document.querySelectorAll(".story-filter"));
  const stories = Array.from(document.querySelectorAll(".story-item"));
  const emptyMessage = document.querySelector("[data-filter-empty]");

  if (!form || !input || !filters.length || !stories.length || !emptyMessage) {
    return;
  }

  let selectedTag = "all";
  const initialQuery = new URLSearchParams(window.location.search).get("q");

  if (initialQuery) {
    input.value = initialQuery;
  }

  function updateStories() {
    const query = normalizeSearchValue(input.value);
    let visibleCount = 0;

    stories.forEach((story) => {
      const tags = story.dataset.tags.split("|");
      const matchesTag = selectedTag === "all" || tags.includes(selectedTag);
      const matchesQuery = !query || normalizeSearchValue(story.dataset.search).includes(query);
      const isVisible = matchesTag && matchesQuery;

      story.hidden = !isVisible;
      visibleCount += isVisible ? 1 : 0;
    });

    emptyMessage.hidden = visibleCount !== 0;
  }

  filters.forEach((filter) => {
    filter.setAttribute("aria-pressed", String(filter.dataset.tag === selectedTag));
    filter.addEventListener("click", () => {
      selectedTag = filter.dataset.tag;

      filters.forEach((item) => {
        const isSelected = item === filter;

        item.classList.toggle("is-active", isSelected);
        item.setAttribute("aria-pressed", String(isSelected));
      });

      updateStories();
    });
  });

  input.addEventListener("input", updateStories);
  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const url = new URL(window.location.href);
    const query = input.value.trim();

    if (query) {
      url.searchParams.set("q", query);
    } else {
      url.searchParams.delete("q");
    }

    window.history.replaceState({}, "", url);
  });

  updateStories();
}

function registerArticleToc() {
  const toc = document.querySelector("[data-article-toc]");
  const list = document.querySelector("[data-article-toc-list]");
  const headings = Array.from(document.querySelectorAll(".article-content h2, .article-content h3"));

  if (!toc || !list || !headings.length) {
    return;
  }

  headings.forEach((heading, index) => {
    const title = heading.textContent.trim();

    if (!title) {
      return;
    }

    if (!heading.id) {
      heading.id = `section-${index + 1}`;
    }

    const item = document.createElement("li");
    const link = document.createElement("a");

    item.className = `article-toc__item article-toc__item--${heading.tagName.toLocaleLowerCase("en-US")}`;
    link.href = `#${heading.id}`;
    link.textContent = title;
    item.append(link);
    list.append(item);
  });

  toc.hidden = !list.childElementCount;
}

document.addEventListener("DOMContentLoaded", () => {
  registerThemeToggle();
  registerStoryFilters();
  registerArticleToc();
});
