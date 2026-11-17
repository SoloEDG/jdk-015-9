import type { Theme } from "../../../shared/types";
export const themes: Theme[] = [
  {
    id: "violet",
    name: "Ultraviolet",
    colors: ["#b5a0ff", "#f192dd", "#69ddeb"],
    background: "#090918",
  },
  {
    id: "mint",
    name: "Neon garden",
    colors: ["#86f9cb", "#d0ff86", "#61d0ff"],
    background: "#051311",
  },
  {
    id: "ember",
    name: "Solar flare",
    colors: ["#ffa26b", "#ff5e88", "#ffe5ae"],
    background: "#190b13",
  },
  {
    id: "ice",
    name: "Deep blue",
    colors: ["#61caff", "#8a8eff", "#c7f1ff"],
    background: "#050e1c",
  },
];
export const getTheme = (id: string) =>
  themes.find((t) => t.id === id) ?? themes[0];
