import Splash1 from "./pages/splash";
import Onboarding2 from "./pages/onboarding";
import Login3 from "./pages/login";
import Register4 from "./pages/register";
import Home5 from "./pages/home";
import Feed6 from "./pages/feed";
import Search7 from "./pages/search";
import Profile8 from "./pages/profile";
import Settings9 from "./pages/settings";
import Notifications10 from "./pages/notifications";
import About11 from "./pages/about";
import "./theme/tokens.css";

export default function App() {
  return (
    <div data-testid="generated-app" className="min-h-screen bg-[var(--color-background)] text-[var(--color-text)]">
      <Splash1 />
      <Onboarding2 />
      <Login3 />
      <Register4 />
      <Home5 />
      <Feed6 />
      <Search7 />
      <Profile8 />
      <Settings9 />
      <Notifications10 />
      <About11 />
    </div>
  );
}
