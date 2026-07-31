import { Navigate, Route, Routes } from 'react-router-dom';

// Экраны появляются на этапах 2–8; сейчас — рабочий каркас маршрутизации.
export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <main className="mx-auto max-w-3xl p-8">
            <h1 className="text-2xl font-semibold text-white">PAI Guides — админка</h1>
            <p className="mt-2 text-ink-400">Каркас поднят. Экраны — этапы 2–8.</p>
          </main>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
