import { decodeSorobanError } from "@/lib/wallet/decodeSorobanError";

/** Friendly explanation of a failed transaction, keeping the raw error available for support. */
export function TxErrorMessage({ rawError }: { rawError: string }) {
  const { title, explanation } = decodeSorobanError(rawError);
  return (
    <div role="alert" className="mt-3 text-[12px] text-pm-red">
      <p className="font-semibold">{title}</p>
      <p className="mt-0.5 text-pm-red/80">{explanation}</p>
      <details className="mt-1.5 text-[11px] text-pm-text/40">
        <summary className="cursor-pointer">Technical details</summary>
        <code className="mt-1 block break-all font-mono">{rawError}</code>
      </details>
    </div>
  );
}
