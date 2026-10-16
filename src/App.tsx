import { HashRouter, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.tsx';
import { DiscoveryProvider } from './hooks/useDiscovery.tsx';
import Dashboard from './pages/Dashboard.tsx';
import Markets from './pages/Markets.tsx';
import { History, PaperTrading, Performance } from './pages/Placeholders.tsx';
import Settings from './pages/Settings.tsx';
import SignalDetail from './pages/SignalDetail.tsx';

/** HashRouter: safe on static hosts (GitHub Pages) with no rewrite rules. */
export default function App() {
  return (
    <DiscoveryProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="markets" element={<Markets />} />
            <Route path="signal/:coinId" element={<SignalDetail />} />
            <Route path="history" element={<History />} />
            <Route path="paper" element={<PaperTrading />} />
            <Route path="performance" element={<Performance />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </HashRouter>
    </DiscoveryProvider>
  );
}
