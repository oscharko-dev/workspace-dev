import { Suspense } from "react";

import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import ScreenSkeleton from "./components/ScreenSkeleton";
import ID0033NettoBetriebsmittelAlleClusterEingeklapptScreen from "./screens/ID-003_3_Netto_Betriebsmittel_alle_Cluster_eingeklappt";


const routeLoadingFallback = <ScreenSkeleton />;

const resolveBrowserBasename = (): string | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  const reproMatch = window.location.pathname.match(/^\/workspace\/repros\/[^/]+/);
  return reproMatch?.[0];
};

const browserBasename = resolveBrowserBasename();



export default function App() {
  return (
    <BrowserRouter basename={browserBasename}>
      <a href="#main-content" style={{ position: "absolute", left: "-9999px", top: "auto", width: "1px", height: "1px", overflow: "hidden", zIndex: 9999 }} onFocus={(e) => { e.currentTarget.style.position = "static"; e.currentTarget.style.width = "auto"; e.currentTarget.style.height = "auto"; e.currentTarget.style.overflow = "visible"; }} onBlur={(e) => { e.currentTarget.style.position = "absolute"; e.currentTarget.style.left = "-9999px"; e.currentTarget.style.width = "1px"; e.currentTarget.style.height = "1px"; e.currentTarget.style.overflow = "hidden"; }}>Skip to main content</a>

      <Suspense fallback={routeLoadingFallback}>
        <Routes>
          <Route path="/id-003_3_netto_betriebsmittel_alle_cluster_eingeklappt" element={<ErrorBoundary><ID0033NettoBetriebsmittelAlleClusterEingeklapptScreen /></ErrorBoundary>} />
          <Route path="/id-003_5_brutto_betriebsmittel_alle_cluster_eingeklappt" element={<ErrorBoundary><ID0033NettoBetriebsmittelAlleClusterEingeklapptScreen initialVariantId="1:63230" /></ErrorBoundary>} />
          <Route path="/id-003_4_netto_betriebsmittel_alle_cluster_expanded" element={<ErrorBoundary><ID0033NettoBetriebsmittelAlleClusterEingeklapptScreen initialVariantId="1:64644" /></ErrorBoundary>} />
          <Route path="/id-003_2_netto_betriebsmittel_alle_cluster_eingeklappt_v1" element={<ErrorBoundary><ID0033NettoBetriebsmittelAlleClusterEingeklapptScreen initialVariantId="1:67464" /></ErrorBoundary>} />
          <Route path="/id-003_1_fehlermeldungen" element={<ErrorBoundary><ID0033NettoBetriebsmittelAlleClusterEingeklapptScreen initialVariantId="1:68884" /></ErrorBoundary>} />
          <Route path="/" element={<Navigate to="/id-003_3_netto_betriebsmittel_alle_cluster_eingeklappt" replace />} />
          <Route path="*" element={<Navigate to="/id-003_3_netto_betriebsmittel_alle_cluster_eingeklappt" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
