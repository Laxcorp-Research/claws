export function formatCurrency(amount: number): string {
  return "$" + amount.toFixed(2);
}

export function formatCurrencyRounded(amount: number): string {
  return "$" + Math.round(amount).toLocaleString();
}
