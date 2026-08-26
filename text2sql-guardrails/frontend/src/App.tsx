import { useState } from "react";
import { NavBar, type Screen } from "./components/NavBar";
import { AdminScreen } from "./screens/AdminScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { SchemaScreen } from "./screens/SchemaScreen";
import { WorkspaceScreen } from "./screens/WorkspaceScreen";

export default function App() {
  const [screen, setScreen] = useState<Screen>("workspace");

  return (
    <div className="relative z-[1] min-h-screen">
      <NavBar active={screen} onChange={setScreen} />
      <main>
        {screen === "workspace" && <WorkspaceScreen />}
        {screen === "history" && <HistoryScreen />}
        {screen === "schema" && <SchemaScreen />}
        {screen === "admin" && <AdminScreen />}
      </main>
    </div>
  );
}
