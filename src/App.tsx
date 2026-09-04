import { useEffect, useState } from "react";
import { BoardList } from "./boards/BoardList";
import { BoardView } from "./boards/BoardView";
import { loadFonts } from "./text/fontLoader";
import { ThemeProvider } from "./theme/ThemeProvider";

type Route = { view: "list" } | { view: "board"; id: string };

function parseHash(): Route {
  const m = window.location.hash.match(/^#\/b\/([A-Za-z0-9_-]+)/);
  return m ? { view: "board", id: m[1] } : { view: "list" };
}

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Bundled fonts, not a web request: text measures correctly offline too.
  useEffect(() => {
    void loadFonts();
  }, []);

  return (
    <ThemeProvider>
      {route.view === "board" ? (
        <BoardView
          boardId={route.id}
          onBack={() => (window.location.hash = "#/")}
        />
      ) : (
        <BoardList onOpen={(id) => (window.location.hash = `#/b/${id}`)} />
      )}
    </ThemeProvider>
  );
}
