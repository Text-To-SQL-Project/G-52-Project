import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ApiError, getMe } from "./api/client";
import { LiveBackground } from "./components/LiveBackground";
import { NavBar, type Screen } from "./components/NavBar";
import { Preloader } from "./components/Preloader";
import { AUTH_CHANGED_EVENT, getToken } from "./hooks/useAuthToken";
import { useScreenTransition } from "./hooks/useScreenTransition";
import { LoginScreen } from "./screens/LoginScreen";

// Split per screen: the login page shouldn't download three.js (workspace
// orb) or recharts (admin) before it can render.
const WorkspaceScreen = lazy(() => import("./screens/WorkspaceScreen").then((m) => ({ default: m.WorkspaceScreen })));
const HistoryScreen = lazy(() => import("./screens/HistoryScreen").then((m) => ({ default: m.HistoryScreen })));
const SchemaScreen = lazy(() => import("./screens/SchemaScreen").then((m) => ({ default: m.SchemaScreen })));
const AdminScreen = lazy(() => import("./screens/AdminScreen").then((m) => ({ default: m.AdminScreen })));
import type { MeResponse } from "./types/api";

export default function App() {
  const [screen, setScreen] = useState<Screen>("workspace");
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meLoading, setMeLoading] = useState(false);
  const [preloaderDone, setPreloaderDone] = useState(false);
  const { trigger, WipeOverlay } = useScreenTransition();

  useEffect(() => {
    const onAuthChanged = () => {
      const nextToken = getToken();
      setTokenState(nextToken);
      if (!nextToken) {
        setMe(null);
        setMeLoading(false);
      }
    };
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    window.addEventListener("storage", onAuthChanged);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
      window.removeEventListener("storage", onAuthChanged);
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getMe()
      .then((user) => {
        if (!cancelled) setMe(user);
      })
      .catch((e) => {
        if (!cancelled && !(e instanceof ApiError && e.status === 401)) {
          setMe(null);
        }
      })
      .finally(() => {
        if (!cancelled) setMeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    const onFocus = () => {
      if (getToken()) {
        getMe().then(setMe).catch(() => {});
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const isAdmin = me?.role === "admin";
  const currentScreen: Screen =
    (screen === "admin" || screen === "schema") && me !== null && !isAdmin
      ? "workspace"
      : screen;

  // Screen change with wipe transition
  const handleScreenChange = useCallback(
    (newScreen: Screen) => {
      if (newScreen === currentScreen) return;
      trigger(() => {
        setScreen(newScreen);
      });
    },
    [currentScreen, trigger]
  );

  return (
    <>
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
            active={currentScreen}
            onChange={handleScreenChange}
            me={me}
            meLoading={meLoading}
          />
          <main>
            {/* One boundary per screen: loading one chunk must not blank the others. */}
            {/* Workspace stays mounted to preserve result state */}
            <div className={currentScreen === "workspace" ? undefined : "hidden"}>
              <Suspense fallback={null}>
                <WorkspaceScreen isAdmin={isAdmin} role={me?.role} />
              </Suspense>
            </div>
            <Suspense fallback={null}>
              {currentScreen === "history" && <HistoryScreen />}
              {currentScreen === "schema" && isAdmin && <SchemaScreen />}
              {currentScreen === "admin" && <AdminScreen />}
            </Suspense>
          </main>
        </div>
      )}
    </>
  );
}
