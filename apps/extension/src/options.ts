import { DEFAULT_SETTINGS, loadSettings, type ExtensionSettings } from "./types.js";

function requiredElement<T extends Element>(selector: string, constructor: { new (): T }): T {
  const element = document.querySelector(selector);
  if (!(element instanceof constructor)) throw new Error(`缺少页面元素：${selector}`);
  return element;
}

const form = requiredElement("form", HTMLFormElement);
const message = requiredElement("#message", HTMLElement);

function show(text: string, error = false): void {
  message.textContent = text;
  message.className = error ? "message error" : "message success";
}

void loadSettings().then((settings) => {
  for (const [key, value] of Object.entries(settings)) {
    const input = form.elements.namedItem(key);
    if (input instanceof HTMLInputElement) input.value = value;
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const settings = Object.fromEntries(
    Object.keys(DEFAULT_SETTINGS).map((key) => [key, String(data.get(key) ?? "").trim()]),
  ) as unknown as ExtensionSettings;
  void chrome.storage.local.set(settings).then(() => show("设置已保存"), (error) => show(String(error), true));
});
