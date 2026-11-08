import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoginPage } from '../LoginPage';

describe('LoginPage', () => {
  it('renders the login heading and button', () => {
    render(<LoginPage />);
    expect(screen.getByRole('heading', { name: '登录' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '登录' })).toBeTruthy();
  });
});
