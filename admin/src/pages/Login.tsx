import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { errText } from '../api';

export function Login() {
  const { user, loading, login } = useAuth();
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Вход — PAI Guides';
  }, []);

  if (loading) return <div className="p-8 text-ink-500">Загрузка…</div>;
  if (user) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(loginName.trim(), password);
      location.href = '/';
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold text-white">PAI Guides</h1>
        <p className="mt-1 text-sm text-ink-500">Админка базы знаний</p>

        <div className="mt-6 space-y-4">
          <div>
            <label className="label" htmlFor="login">
              Логин
            </label>
            <input
              id="login"
              className="input"
              value={loginName}
              onChange={(e) => setLoginName(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Пароль
            </label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
        </div>

        {error && <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

        <button type="submit" className="btn-primary mt-6 w-full" disabled={busy || !loginName || !password}>
          {busy ? 'Вхожу…' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
