interface LoginButtonProps {
  loading?: boolean;
  onClick?: () => void;
}

export function LoginButton({ loading = false, onClick }: LoginButtonProps) {
  return (
    <button type="submit" className="login-button" disabled={loading} onClick={onClick}>
      {loading ? '登录中…' : '登录'}
    </button>
  );
}
