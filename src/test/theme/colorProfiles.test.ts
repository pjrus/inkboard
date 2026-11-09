import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  boardRepository,
  DEFAULT_TOOL_PREFS,
} from "../../boards/BoardRepository";
import { InkboardDB, setDB } from "../../storage/db";
import { useToolStore } from "../../store/toolStore";

let counter = 0;

describe("custom colours in tool popovers for pen, pencil, and highlighter", () => {
  beforeEach(async () => {
    setDB(new InkboardDB(`test-colors-${Date.now()}-${counter++}`));
    useToolStore.setState({
      ...DEFAULT_TOOL_PREFS,
      tool: "pen",
      color: "#1b1b1f",
      pencilColor: "#1b1b1f",
      highlighterColor: "#ffe838",
      customPenColors: ["#2e9e5b", "#8e44ad"],
      customPencilColors: ["#2b6de9", "#2e9e5b"],
      customHighlighterColors: ["#74c0fc", "#b197fc"],
    });
  });

  it("allows adding custom colours and controls the respective tool colour", () => {
    const store = useToolStore.getState();

    // Pen: add custom color and ensure it activates pen color
    store.addCustomColor("pen", "#ff4081");
    expect(useToolStore.getState().customPenColors).toContain("#ff4081");
    expect(useToolStore.getState().color).toBe("#ff4081");

    // Pencil: add custom color and ensure it activates pencil color
    store.setTool("pencil");
    store.addCustomColor("pencil", "#00bcd4");
    expect(useToolStore.getState().customPencilColors).toContain("#00bcd4");
    expect(useToolStore.getState().pencilColor).toBe("#00bcd4");
    expect(useToolStore.getState().color).toBe("#00bcd4");

    // Highlighter: add custom color and ensure it activates highlighter color
    store.setTool("highlighter");
    store.addCustomColor("highlighter", "#ffeb3b");
    expect(useToolStore.getState().customHighlighterColors).toContain(
      "#ffeb3b",
    );
    expect(useToolStore.getState().highlighterColor).toBe("#ffeb3b");
    expect(useToolStore.getState().color).toBe("#ffeb3b");
  });

  it("allows removing custom colours", () => {
    const store = useToolStore.getState();
    store.removeCustomColor("pen", "#2e9e5b");
    expect(useToolStore.getState().customPenColors).toEqual(["#8e44ad"]);

    store.removeCustomColor("pencil", "#2b6de9");
    expect(useToolStore.getState().customPencilColors).toEqual(["#2e9e5b"]);

    store.removeCustomColor("highlighter", "#74c0fc");
    expect(useToolStore.getState().customHighlighterColors).toEqual([
      "#b197fc",
    ]);
  });

  it("persists custom colours in storage", async () => {
    const customPrefs = {
      ...DEFAULT_TOOL_PREFS,
      customPenColors: ["#123456", "#789abc"],
      customPencilColors: ["#456789"],
      customHighlighterColors: ["#ff0055", "#00ff55"],
    };

    await boardRepository.saveToolPreferences(customPrefs);
    const restored = await boardRepository.getToolPreferences();

    expect(restored.customPenColors).toEqual(["#123456", "#789abc"]);
    expect(restored.customPencilColors).toEqual(["#456789"]);
    expect(restored.customHighlighterColors).toEqual(["#ff0055", "#00ff55"]);
  });
});
