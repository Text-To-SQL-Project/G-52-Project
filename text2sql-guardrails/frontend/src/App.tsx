import { useCallback, useEffect, useState } from "react";
import { ApiError, getMe } from "./api/client";
import { CustomCursor } from "./components/CustomCursor";
import { LiveBackground } from "./components/LiveBackground";
import { NavBar, type Screen } from "./components/NavBar";
import { Preloader } from "./components/Preloader";
import { AUTH_CHANGED_EVENT, getToken } from "./hooks/useAuthToken";
import { useScreenTransition } from "./hooks/useScreenTransition";
import { AdminScreen } from "./screens/AdminScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { SchemaScreen } from "./screens/SchemaScreen";
import { WorkspaceScreen } from "./screens/WorkspaceScreen";
import type { MeResponse } from "./types/api";

export default function App() {
  const [screen, setScreen] = useState<Screen>("workspace");
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meLoading, setMeLoading] = useState(false);
  const [preloaderDone, setPreloaderDone] = useState(false);
  const { trigger, WipeOverlay } = useScreenTransition();

  useEffect(() => {
    const onAuthChanged = () => setTokenState(getToken());
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    window.addEventListener("storage", onAuthChanged);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
      window.removeEventListener("storage", onAuthChanged);
    };
  }, []);

  const refreshMe = useCallback(() => {
    if (!getToken()) {
      setMe(null);
      return;
    }
    setMeLoading(true);
    getMe()
      .then(setMe)
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) {
          setMe(null);
        }
      })
      .finally(() => setMeLoading(false));
  }, []);

  useEffect(() => {
    refreshMe();
  }, [token, refreshMe]);

  useEffect(() => {
    const onFocus = () => refreshMe();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshMe]);

  const isAdmin = me?.role === "admin";

  useEffect(() => {
    if (screen === "admin" && me !== null && !isAdmin) {
      setScreen("workspace");
    }
  }, [screen, me, isAdmin]);

  // Screen change with wipe transition
  const handleScreenChange = useCallback(
    (newScreen: Screen) => {
      if (newScreen === screen) return;
      trigger(() => {
        setScreen(newScreen);
      });
    },
    [screen, trigger]
  );

  return (
    <>
      <CustomCursor />
      <Preloader onComplete={() => setPreloaderDone(true)} />
      <LiveBackground />
      {WipeOverlay}

      {!token ? (
        <LoginScreen />
      ) : (
        <div
          className="relative z-[1] min-h-screen"
          style={{
            opacity: preloaderDone ? 1 : 0,
            transition: "opacity 0.3s ease-out",
          }}
        >
          <NavBar
            active={screen}
            onChange={handleScreenChange}
            me={me}
            meLoading={meLoading}
          />
          <main>
            {/* Workspace stays mounted to preserve result state */}
            <div className={screen === "workspace" ? undefined : "hidden"}>
              <WorkspaceScreen isAdmin={isAdmin} />
            </div>
            {screen === "history" && <HistoryScreen />}
            {screen === "schema" && <SchemaScreen />}
            {screen === "admin" && <AdminScreen />}
          </main>
        </div>
      )}
    </>
  );
}
