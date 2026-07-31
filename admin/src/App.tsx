import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import type { Role } from './api';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Users } from './pages/Users';
import { Invites } from './pages/Invites';
import { Audit } from './pages/Audit';
import { MediaLibrary } from './pages/MediaLibrary';
import { Guides } from './pages/Guides';
import { GuideEditor } from './pages/GuideEditor';
import { Structure } from './pages/Structure';
import { Backups } from './pages/Backups';
import { Stats } from './pages/Stats';

function Guard({ role, children }: { role?: Role; children: JSX.Element }) {
  const { user, loading, atLeast } = useAuth();
  if (loading) return <div className="p-8 text-ink-500">Загрузка…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'NONE')
    return (
      <div className="p-8 text-ink-400">
        Аккаунт создан, но доступ ещё не выдан. Попросите администратора подтвердить его.
      </div>
    );
  if (role && !atLeast(role)) return <Navigate to="/" replace />;
  return children;
}

/** Куда отправлять с корня: у ADMIN есть все разделы, у EDITOR — только контентные. */
function HomeRedirect() {
  const { atLeast } = useAuth();
  return <Navigate to={atLeast('ADMIN') ? '/users' : '/guides'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <Guard>
            <Layout />
          </Guard>
        }
      >
        <Route path="/" element={<HomeRedirect />} />
        <Route
          path="/guides"
          element={
            <Guard role="EDITOR">
              <Guides />
            </Guard>
          }
        />
        <Route
          path="/guides/:id"
          element={
            <Guard role="EDITOR">
              <GuideEditor />
            </Guard>
          }
        />
        <Route
          path="/structure"
          element={
            <Guard role="EDITOR">
              <Structure />
            </Guard>
          }
        />
        <Route
          path="/media"
          element={
            <Guard role="EDITOR">
              <MediaLibrary />
            </Guard>
          }
        />
        <Route
          path="/users"
          element={
            <Guard role="ADMIN">
              <Users />
            </Guard>
          }
        />
        <Route
          path="/invites"
          element={
            <Guard role="ADMIN">
              <Invites />
            </Guard>
          }
        />
        <Route
          path="/stats"
          element={
            <Guard role="ADMIN">
              <Stats />
            </Guard>
          }
        />
        <Route
          path="/backups"
          element={
            <Guard role="ADMIN">
              <Backups />
            </Guard>
          }
        />
        <Route
          path="/audit"
          element={
            <Guard role="ADMIN">
              <Audit />
            </Guard>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
