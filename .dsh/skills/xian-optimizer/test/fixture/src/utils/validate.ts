export function validateEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validatePassword(value: string): boolean {
  return value.length >= 8;
}
