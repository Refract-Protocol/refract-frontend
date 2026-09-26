export function toStroops(amount: string | number): string {
  const value = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid amount: ${amount}`);
  }
  return Math.round(value * 10_000_000).toString();
}

export function fromStroops(stroops: string | number | bigint): number {
  const value =
    typeof stroops === "bigint" ? stroops : BigInt(Math.trunc(Number(stroops)));
  return Number(value) / 10_000_000;
}

export function formatUsdc(amount: number): string {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
