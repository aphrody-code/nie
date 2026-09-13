import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(
  new URL("./settings-screen.css", import.meta.url),
  "utf8",
);

describe("SettingsScreen responsive geometry", () => {
  test("fits tabs and setting rows into the narrow host column", () => {
    expect(css).toContain("@media (max-width: 720px)");
    expect(css).toContain("width: calc(100% - 2rem)");
    expect(css).toContain("transform: none");
    expect(css).toContain(
      "grid-template-columns: minmax(0, 1fr) minmax(7.5rem, 42%)",
    );
    expect(css).toContain("text-overflow: ellipsis");
  });
});
