import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  boardRepository,
  DEFAULT_TOOL_PREFS,
} from "../../boards/BoardRepository";
import { InkboardDB, setDB } from "../../storage/db";
import { useToolStore } from "../../store/toolStore";

let counter = 0;

describe("toolStore", () => {
  beforeEach(() => {
    setDB(new InkboardDB(`toolstore-test-${Date.now()}-${counter++}`));
    useToolStore.setState({
      ...DEFAULT_TOOL_PREFS,
      background: "#f3f1ec",
    });
  });

  it("keeps pen colour independent when switching to highlighter or pencil", () => {
    const store = useToolStore.getState();
    store.setColor("#d93025");

    store.setTool("highlighter");
    store.setHighlighterColor("#51cf66");
    expect(useToolStore.getState().penColor).toBe("#d93025");

    store.setTool("pencil");
    store.setPencilColor("#2b6de9");
    expect(useToolStore.getState().penColor).toBe("#d93025");

    store.setTool("pen");
    expect(useToolStore.getState().color).toBe("#d93025");
  });

  it("only updates unpicked pen colour when board background changes", () => {
    const store = useToolStore.getState();

    // Pencil colour changes do not mark pen colour as explicit.
    store.setTool("pencil");
    store.setPencilColor("#2b6de9");
    expect(useToolStore.getState().colorExplicit).toBe(false);

    // Switching to a dark background updates default pen ink.
    store.setBackground("#1c1d21");
    expect(useToolStore.getState().penColor).toBe("#f2f1ee");
    // Active pencil keeps its own colour.
    expect(useToolStore.getState().color).toBe("#2b6de9");

    store.setTool("pen");
    expect(useToolStore.getState().color).toBe("#f2f1ee");

    // Once user picks a pen colour explicitly, background changes leave it alone.
    store.setColor("#2e9e5b");
    store.setBackground("#ffffff");
    expect(useToolStore.getState().penColor).toBe("#2e9e5b");
    expect(useToolStore.getState().color).toBe("#2e9e5b");
  });

  it("hydrates active tool colour without leaking highlighter colour onto pen", async () => {
    await boardRepository.saveToolPreferences({
      ...DEFAULT_TOOL_PREFS,
      tool: "highlighter",
      color: "#ffe838",
      penColor: "#2b6de9",
      colorExplicit: true,
      highlighterColor: "#51cf66",
    });

    await useToolStore.getState().hydrate();
    expect(useToolStore.getState().color).toBe("#51cf66");
    expect(useToolStore.getState().penColor).toBe("#2b6de9");

    useToolStore.getState().setTool("pen");
    expect(useToolStore.getState().color).toBe("#2b6de9");
  });
});
