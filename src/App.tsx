import { useEffect, useState } from "react";
import { BoardList } from "./boards/BoardList";
import { BoardView } from "./boards/BoardView";

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

  if (route.view === "board") {
    return <BoardView boardId={route.id} onBack={() => (window.location.hash = "#/")} />;
  }
  return <BoardList onOpen={(id) => (window.location.hash = `#/b/${id}`)} />;
}
