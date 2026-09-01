import { useEffect, useState } from "react";
import { NavBar, type Screen } from "./components/NavBar";
import { AUTH_CHANGED_EVENT, getToken } from "./hooks/useAuthToken";
import { AdminScreen } from "./screens/AdminScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { SchemaScreen } from "./screens/SchemaScreen";
import { WorkspaceScreen } from "./screens/WorkspaceScreen";

export default function App() {
  const [screen, setScreen] = useState<Screen>("workspace");
  const [token, setTokenState] = useState<string | null>(() => getToken());

  useEffect(() => {
    // Fires on login, logout, and a 401 forcing logout mid-session (see
    // api/client.ts's request()) -- keeps this re-render in sync without
    // prop-drilling a setter through every screen that can hit a 401.
    const onAuthChanged = () => setTokenState(getToken());
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);

  if (!token) {
    return <LoginScreen />;
  }

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
