import { useCallback, useEffect, useState } from "react";
import { ApiError, getMe } from "./api/client";
import { LiveBackground } from "./components/LiveBackground";
import { NavBar, type Screen } from "./components/NavBar";
import { AUTH_CHANGED_EVENT, getToken } from "./hooks/useAuthToken";
import { AdminScreen } from "./screens/AdminScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { SchemaScreen } from "./screens/SchemaScreen";
import { WorkspaceScreen } from "./screens/WorkspaceScreen";
import type { MeResponse } from "./types/api";

export default function App() {
  const [screen, setScreen] = useState<Screen>("workspace");
  const [token, setTokenState] = useState<string | null>(() => getToken());
  // Identity is FETCHED, never persisted. The token carries only a user id
  // (role and active status are deliberately not claims, because a claim is
  // frozen at issue time), so after a reload the client genuinely does not
  // know who it is until it asks. Keeping this out of localStorage also
  // means there is no stale role for the UI to trust.
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meLoading, setMeLoading] = useState(false);

  useEffect(() => {
    // Fires on login, logout, and a 401 forcing logout mid-session (see
    // api/client.ts's request()) -- keeps this re-render in sync without
    // prop-drilling a setter through every screen that can hit a 401.
    const onAuthChanged = () => setTokenState(getToken());
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
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
        // A 401 has already cleared the token inside request(), which fires
        // AUTH_CHANGED_EVENT and drops us back to the login screen. Anything
        // else leaves identity unknown; the nav degrades rather than guessing.
        if (!(e instanceof ApiError && e.status === 401)) {
          setMe(null);
        }
      })
      .finally(() => setMeLoading(false));
  }, []);

  useEffect(() => {
    refreshMe();
  }, [token, refreshMe]);

  // A role can change mid-session -- the server re-reads it per request, so
  // the UI should not be the last to know. Re-asking when the tab regains
  // focus keeps a long-open window roughly honest without polling.
  useEffect(() => {
    const onFocus = () => refreshMe();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshMe]);

  const isAdmin = me?.role === "admin";

  // Demoted while sitting on the Admin tab: fall back to the Workspace
  // rather than leaving a screen visible that every request will 403.
  useEffect(() => {
    if (screen === "admin" && me !== null && !isAdmin) {
      setScreen("workspace");
    }
  }, [screen, me, isAdmin]);

  return (
    /* The wallpaper is mounted outside the auth gate so it is continuous
       across sign-in: logging in changes the content above it, not the
       surface underneath. Everything else carries `relative z-[1]`. */
    <>
      <LiveBackground />
      {!token ? (
        <LoginScreen />
      ) : (
        <div className="relative z-[1] min-h-screen">
          <NavBar active={screen} onChange={setScreen} me={me} meLoading={meLoading} />
          <main>
            {/* Workspace alone stays mounted and is hidden with `display:none`
                rather than unmounted, because it is the only screen that owns
                result state and that state is local to it -- unmounting on a
                tab change threw away a result that costs a real LLM call to
                reproduce. It is also the only screen with no mount-time fetch,
                so keeping it mounted costs no requests; giving History, Schema
                or Admin the same treatment would fire all three loaders at
                login instead of on first visit.

                Nothing persists the result beyond this mount, which is what
                the other two cases need: logging out swaps this whole branch
                for LoginScreen and unmounts the Workspace with it, and a
                reload starts from scratch. Keep this a display toggle --
                `visibility` or `opacity` would leave the panels in layout. */}
            <div className={screen === "workspace" ? undefined : "hidden"}>
              <WorkspaceScreen />
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
