import content from "./generated.json";
export const examples = content.examples;
export const articles = content.articles;
export type Example = (typeof examples)[number];
export const findExample = (slug: string) =>
  examples.find((item) => item.slug === slug);
export const findArticle = (slug: string) =>
  articles.find((item) => item.slug === slug);
