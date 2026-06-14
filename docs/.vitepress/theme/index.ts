import DefaultTheme from "vitepress/theme";
// oxlint-disable-next-line import/no-unassigned-import
import "./custom.css";
import { installLocaleRedirect } from "./localeRedirect";

export default {
  extends: DefaultTheme,
  enhanceApp() {
    installLocaleRedirect();
  },
};
