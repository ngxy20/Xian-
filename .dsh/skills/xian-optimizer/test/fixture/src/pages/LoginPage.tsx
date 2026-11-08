import { useState } from 'react';
import { LoginButton } from '../components/LoginButton';
import { login } from '../api/auth';
import { validateEmail } from '../utils/validate';
import '../styles/login.css';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (!validateEmail(email)) {
      setError('请输入有效的邮箱地址');
      return;
    }
    setLoading(true);
    try {
      await login({ email, password });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <h1>登录</h1>
      <form onSubmit={handleSubmit} className="login-form">
        <label>
          邮箱
          <input value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? <p className="login-error">{error}</p> : null}
        <LoginButton loading={loading} />
      </form>
    </main>
  );
}
