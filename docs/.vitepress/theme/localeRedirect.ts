import { inBrowser } from "vitepress";

const base = "/loggerjs/";
const zhBase = `${base}zh/`;
const storageKey = "loggerjs.docs.locale";

function isAssetPath(pathname: string) {
  return /\.[a-z0-9]+$/i.test(pathname);
}

function isChineseLanguage(language: string) {
  return /^zh\b/i.test(language);
}

function prefersChinese() {
  return (navigator.languages?.length ? navigator.languages : [navigator.language]).some(
    isChineseLanguage,
  );
}

function normalizeDocsPath(pathname: string) {
  if (pathname === "/loggerjs") return base;
  if (pathname.endsWith("/index.html")) return pathname.slice(0, -10);
  return pathname;
}

function shouldRedirectToChinese(pathname: string) {
  if (!pathname.startsWith(base)) return false;
  if (pathname.startsWith(zhBase)) return false;
  if (isAssetPath(pathname)) return false;
  if (localStorage.getItem(storageKey)) return false;
  return prefersChinese();
}

function redirectToChinese(pathname: string) {
  const suffix = pathname.slice(base.length);
  const targetPath = `${zhBase}${suffix}`;
  window.location.replace(`${targetPath}${window.location.search}${window.location.hash}`);
}

function rememberLocaleFromClick(event: MouseEvent) {
  const link =
    event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;

  if (!link) return;

  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin) return;

  const pathname = normalizeDocsPath(url.pathname);
  if (!pathname.startsWith(base) || isAssetPath(pathname)) return;

  localStorage.setItem(storageKey, pathname.startsWith(zhBase) ? "zh" : "en");
}

export function installLocaleRedirect() {
  if (!inBrowser) return;

  const pathname = normalizeDocsPath(window.location.pathname);
  if (shouldRedirectToChinese(pathname)) {
    redirectToChinese(pathname);
    return;
  }

  document.addEventListener("click", rememberLocaleFromClick, { capture: true });
}
