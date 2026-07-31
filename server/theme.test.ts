import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("Theme System", () => {
  const indexCss = readFileSync(
    join(__dirname, "../client/src/index.css"),
    "utf-8"
  );

  it("has :root block with light mode variables", () => {
    // :root should contain the light mode palette
    const rootMatch = indexCss.match(/:root\s*\{([^}]+)\}/s);
    expect(rootMatch).not.toBeNull();
    const rootBlock = rootMatch![1];
    // Light mode uses hex values for the warm cream palette
    expect(rootBlock).toContain("--background: #F8F4EC");
    expect(rootBlock).toContain("--foreground: #191C22");
    expect(rootBlock).toContain("--primary: #835615");
    expect(rootBlock).toContain("--card: #FFFDF8");
    expect(rootBlock).toContain("--ring: #C4883A");
    expect(rootBlock).toContain("--destructive: #BA1A1A");
  });

  it("has .dark block with dark mode variables", () => {
    // .dark should contain the dark mode palette using oklch
    const darkMatch = indexCss.match(/\.dark\s*\{([^}]+)\}/s);
    expect(darkMatch).not.toBeNull();
    const darkBlock = darkMatch![1];
    expect(darkBlock).toContain("--background: oklch(0.12 0.01 240)");
    expect(darkBlock).toContain("--foreground: oklch(0.93 0.01 80)");
    expect(darkBlock).toContain("--primary: oklch(0.72 0.16 55)");
  });

  it("sidebar stays dark in both light and dark modes", () => {
    // :root sidebar should be dark
    const rootMatch = indexCss.match(/:root\s*\{([^}]+)\}/s);
    expect(rootMatch).not.toBeNull();
    const rootBlock = rootMatch![1];
    expect(rootBlock).toContain("--sidebar: #1A1D23");
  });

  it("status badges have dark: variants for light mode compatibility", () => {
    // Status badge utilities should use dark: variants
    expect(indexCss).toContain("dark:text-zinc-400");
    expect(indexCss).toContain("dark:text-amber-400");
    expect(indexCss).toContain("dark:text-yellow-400");
    expect(indexCss).toContain("dark:text-green-400");
    expect(indexCss).toContain("dark:text-orange-400");
    expect(indexCss).toContain("dark:text-red-400");
  });

  it("ThemeContext supports switchable mode", () => {
    const themeContext = readFileSync(
      join(__dirname, "../client/src/contexts/ThemeContext.tsx"),
      "utf-8"
    );
    // Should have switchable prop
    expect(themeContext).toContain("switchable?: boolean");
    // Should read from localStorage when switchable
    expect(themeContext).toContain('localStorage.getItem("theme")');
    // Should save to localStorage when switchable
    expect(themeContext).toContain('localStorage.setItem("theme", theme)');
    // Should add/remove .dark class
    expect(themeContext).toContain('root.classList.add("dark")');
    expect(themeContext).toContain('root.classList.remove("dark")');
  });

  it("App.tsx enables switchable theme", () => {
    const appTsx = readFileSync(
      join(__dirname, "../client/src/App.tsx"),
      "utf-8"
    );
    expect(appTsx).toContain("switchable={true}");
  });

  it("uses @custom-variant dark for Tailwind 4 compatibility", () => {
    expect(indexCss).toContain("@custom-variant dark (&:is(.dark *))");
  });
});
