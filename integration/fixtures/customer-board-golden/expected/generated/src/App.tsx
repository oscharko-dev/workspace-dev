import { Suspense } from "react";

import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import ScreenSkeleton from "./components/ScreenSkeleton";
import BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Screen from "./screens/Bedarfsermittlung_Netto_Betriebsmittel_alle_Cluster_eingeklappt_ID-003_1_v1";


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
          <Route path="/bedarfsermittlung_netto_betriebsmittel_alle_cluster_eingeklappt_id-003_1_v1" element={<ErrorBoundary><BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Screen /></ErrorBoundary>} />
          <Route path="/bedarfsermittlung_brutto_betriebsmittel_alle_cluster_eingeklappt_id-003_5_v1" element={<ErrorBoundary><BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Screen initialVariantId="1:63230" /></ErrorBoundary>} />
          <Route path="/bedarfsermittlung_netto_betriebsmittel_maximalauspr_gung_alle_cluster_expanded_id-003_4_v1" element={<ErrorBoundary><BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Screen initialVariantId="1:64644" /></ErrorBoundary>} />
          <Route path="/bedarfsermittlung_netto_betriebsmittel_alle_cluster_eingeklappt_id-003_2_v1" element={<ErrorBoundary><BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Screen initialVariantId="1:66050" /></ErrorBoundary>} />
          <Route path="/bedarfsermittlung_fehlermeldungen_id-003_3_v1" element={<ErrorBoundary><BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Screen initialVariantId="1:68884" /></ErrorBoundary>} />
          <Route path="/" element={<Navigate to="/bedarfsermittlung_netto_betriebsmittel_alle_cluster_eingeklappt_id-003_1_v1" replace />} />
          <Route path="*" element={<Navigate to="/bedarfsermittlung_netto_betriebsmittel_alle_cluster_eingeklappt_id-003_1_v1" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
