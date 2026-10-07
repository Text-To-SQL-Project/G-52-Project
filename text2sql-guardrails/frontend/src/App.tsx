import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { AnimatePresence, MotionConfig, motion, type Variants } from "motion/react";
import { ApiError, getMe } from "./api/client";
import { LiveBackground } from "./components/LiveBackground";
import { NavBar, type Screen } from "./components/NavBar";
import { Preloader } from "./components/Preloader";
import { EASE } from "./components/kit";
import { AUTH_CHANGED_EVENT, getToken } from "./hooks/useAuthToken";
import { LoginScreen } from "./screens/LoginScreen";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import type { MeResponse } from "./types/api";

// Split per screen: the login page shouldn't download three.js (workspace
// orb) or recharts (admin) before it can render.
const WorkspaceScreen = lazy(() => import("./screens/WorkspaceScreen").then((m) => ({ default: m.WorkspaceScreen })));
const HistoryScreen = lazy(() => import("./screens/HistoryScreen").then((m) => ({ default: m.HistoryScreen })));
const SchemaScreen = lazy(() => import("./screens/SchemaScreen").then((m) => ({ default: m.SchemaScreen })));
const AdminScreen = lazy(() => import("./screens/AdminScreen").then((m) => ({ default: m.AdminScreen })));
// Signed-out visitors only: never downloaded once you're signed in.
const LandingScreen = lazy(() => import("./screens/LandingScreen").then((m) => ({ default: m.LandingScreen })));

// Signed-out routing: "/" is the landing page, "/login" the sign-in form.
// Real URLs + history, so Back works and the sign-in page is linkable.
const onLoginPath = () => window.location.pathname === "/login";

/** Screen change: the old screen dissolves upward, the new one rises out of a blur. */
const screenVariants: Variants = {
  initial: { opacity: 0, y: 18, filter: "blur(8px)" },
  enter: { opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none", transform: "none" }, transition: { duration: 0.6, ease: EASE } },
  exit: { opacity: 0, y: -10, filter: "blur(6px)", transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } },
};

/** The workspace never unmounts (it holds the current answer), so it gets the
 * same entrance by toggling between two states instead of remounting. */
const keepAliveVariants: Variants = {
  hidden: { opacity: 0, y: 18, filter: "blur(8px)", transitionEnd: { display: "none" }, transition: { duration: 0 } },
  shown: { display: "block", opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none", transform: "none" }, transition: { duration: 0.6, ease: EASE, delay: 0.08 } },
};

export default function App() {
  const [screen, setScreen] = useState<Screen>("workspace");
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meLoading, setMeLoading] = useState(false);
  const [preloaderDone, setPreloaderDone] = useState(false);
  const [loginView, setLoginView] = useState(onLoginPath);

  useEffect(() => {
    const onPop = () => setLoginView(onLoginPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Signed in: the app lives at "/", whatever page you signed in from.
  useEffect(() => {
    if (token && window.location.pathname !== "/") window.history.replaceState(null, "", "/");
  }, [token]);

  const goTo = (login: boolean) => {
    window.history.pushState(null, "", login ? "/login" : "/");
    setLoginView(login);
    window.scrollTo(0, 0);
  };

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

  const handleScreenChange = useCallback(
    (next: Screen) => {
      if (next === currentScreen) return;
      setScreen(next);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [currentScreen],
  );

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={250}>
        <Preloader onComplete={() => setPreloaderDone(true)} />
        <LiveBackground />

        {!token ? (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={loginView ? "login" : "landing"} variants={screenVariants} initial="initial" animate="enter" exit="exit">
              {loginView ? (
                <LoginScreen onBack={() => goTo(false)} />
              ) : (
                <Suspense fallback={null}>
                  <LandingScreen onSignIn={() => goTo(true)} />
                </Suspense>
              )}
            </motion.div>
          </AnimatePresence>
        ) : (
          <div
            className="relative z-[1] min-h-screen"
            style={{
              opacity: preloaderDone ? 1 : 0,
              transition: "opacity 0.4s ease-out",
            }}
          >
            <NavBar active={currentScreen} onChange={handleScreenChange} me={me} meLoading={meLoading} />
            <main className="pb-24">
              {/* Workspace stays mounted to preserve result state. */}
              <motion.div variants={keepAliveVariants} initial="hidden" animate={currentScreen === "workspace" ? "shown" : "hidden"}>
                <Suspense fallback={null}>
                  <WorkspaceScreen isAdmin={isAdmin} role={me?.role} />
                </Suspense>
              </motion.div>
              {/* One boundary per screen: loading one chunk must not blank the others. */}
              <AnimatePresence mode="popLayout">
                {currentScreen !== "workspace" && (
                  <motion.div key={currentScreen} variants={screenVariants} initial="initial" animate="enter" exit="exit">
                    <Suspense fallback={null}>
                      {currentScreen === "history" && <HistoryScreen />}
                      {currentScreen === "schema" && isAdmin && <SchemaScreen />}
                      {currentScreen === "admin" && <AdminScreen />}
                    </Suspense>
                  </motion.div>
                )}
              </AnimatePresence>
            </main>
          </div>
        )}
        <Toaster />
      </TooltipProvider>
    </MotionConfig>
  );
}
