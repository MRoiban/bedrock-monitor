import type { TestConfig } from "bedrock/testing";
export default {
  pages: [
    "overview",
    "pebbles",
    "pebble",
    "incidents",
    "incident",
    "review",
    "jobs",
    "settings",
  ].map((view) => ({
    path: `/?view=${view}${view === "pebble" ? "&id=sample" : ""}`,
    user: "owner" as const,
    ready: "[data-bedrock-ready]",
    visual: false,
  })),
} satisfies TestConfig;
