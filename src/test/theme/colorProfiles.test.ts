import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  boardRepository,
  DEFAULT_TOOL_PREFS,
} from "../../boards/BoardRepository";
import { InkboardDB, setDB } from "../../storage/db";
import { useToolStore } from "../../store/toolStore";

let counter = 0;

describe("custom colours for pen, pencil, and highlighter", () => {
  beforeEach(async () => {
    setDB(new InkboardDB(`test-colors-${Date.now()}-${counter++}`));
    useToolStore.setState({
      ...DEFAULT_TOOL_PREFS,
      tool: "pen",
      color: "#1b1b1f",
      pencilColor: "#1b1b1f",
      highlighterColor: "#ffe838",
      penColorProfiles: ["#1b1b1f", "#2b6de9", "#d93025"],
      penColorIndex: 0,
      pencilColorProfiles: ["#1b1b1f", "#5f6368", "#c62828"],
      pencilColorIndex: 0,
      highlighterColorProfiles: ["#ffe838", "#51cf66", "#ff6b81"],
      highlighterColorIndex: 0,
    });
  });

  it("selects color profiles for each tool and controls active tool color", () => {
    const store = useToolStore.getState();

    // Pen
    store.setColorProfile("pen", 1);
    expect(useToolStore.getState().penColorIndex).toBe(1);
    expect(useToolStore.getState().color).toBe("#2b6de9");

    // Pencil
    store.setTool("pencil");
    store.setColorProfile("pencil", 2);
    expect(useToolStore.getState().pencilColorIndex).toBe(2);
    expect(useToolStore.getState().pencilColor).toBe("#c62828");
    expect(useToolStore.getState().color).toBe("#c62828");

    // Highlighter
    store.setTool("highlighter");
    store.setColorProfile("highlighter", 1);
    expect(useToolStore.getState().highlighterColorIndex).toBe(1);
    expect(useToolStore.getState().highlighterColor).toBe("#51cf66");
    expect(useToolStore.getState().color).toBe("#51cf66");
  });

  it("allows adding custom colours and updates active tool color", () => {
    const store = useToolStore.getState();

    // Add custom colour to pen
    store.addColorProfile("pen", "#123456");
    const penState = useToolStore.getState();
    expect(penState.penColorProfiles).toEqual([
      "#1b1b1f",
      "#2b6de9",
      "#d93025",
      "#123456",
    ]);
    expect(penState.penColorIndex).toBe(3);
    expect(penState.color).toBe("#123456");

    // Add custom colour to highlighter
    store.setTool("highlighter");
    store.addColorProfile("highlighter", "#abcdef");
    const hlState = useToolStore.getState();
    expect(hlState.highlighterColorProfiles).toEqual([
      "#ffe838",
      "#51cf66",
      "#ff6b81",
      "#abcdef",
    ]);
    expect(hlState.highlighterColorIndex).toBe(3);
    expect(hlState.highlighterColor).toBe("#abcdef");
    expect(hlState.color).toBe("#abcdef");
  });

  it("allows updating an existing colour profile", () => {
    const store = useToolStore.getState();
    store.updateColorProfile("pencil", 1, "#445566");
    const state = useToolStore.getState();
    expect(state.pencilColorProfiles?.[1]).toBe("#445566");
    expect(state.pencilColorIndex).toBe(1);
    expect(state.pencilColor).toBe("#445566");
  });

  it("allows removing a colour profile without going below 1", () => {
    const store = useToolStore.getState();
    store.removeColorProfile("pen", 0);
    let state = useToolStore.getState();
    expect(state.penColorProfiles).toEqual(["#2b6de9", "#d93025"]);
    expect(state.color).toBe("#2b6de9");

    store.removeColorProfile("pen", 0);
    state = useToolStore.getState();
    expect(state.penColorProfiles).toEqual(["#d93025"]);

    // Cannot remove the last colour
    store.removeColorProfile("pen", 0);
    state = useToolStore.getState();
    expect(state.penColorProfiles).toEqual(["#d93025"]);
  });

  it("persists and restores custom colour profiles in storage", async () => {
    const customPrefs = {
      ...DEFAULT_TOOL_PREFS,
      penColorProfiles: ["#000000", "#112233", "#445566", "#aabbcc"],
      penColorIndex: 2,
      pencilColor: "#556677",
      pencilColorProfiles: ["#111111", "#556677"],
      pencilColorIndex: 1,
      highlighterColor: "#ff9900",
      highlighterColorProfiles: ["#ffff00", "#ff9900"],
      highlighterColorIndex: 1,
    };

    await boardRepository.saveToolPreferences(customPrefs);
    const restored = await boardRepository.getToolPreferences();

    expect(restored.penColorProfiles).toEqual([
      "#000000",
      "#112233",
      "#445566",
      "#aabbcc",
    ]);
    expect(restored.penColorIndex).toBe(2);
    expect(restored.pencilColor).toBe("#556677");
    expect(restored.pencilColorProfiles).toEqual(["#111111", "#556677"]);
    expect(restored.pencilColorIndex).toBe(1);
    expect(restored.highlighterColor).toBe("#ff9900");
    expect(restored.highlighterColorProfiles).toEqual(["#ffff00", "#ff9900"]);
    expect(restored.highlighterColorIndex).toBe(1);
  });
});
