import { describe, expect, it } from "vitest";
import { stellarExpertContractUrl, stellarExpertTxUrl } from "./stellar";

describe("stellar.expert URL helpers", () => {
  it.each([
    "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
  ])("builds a testnet contract URL for %s", (address) => {
    expect(stellarExpertContractUrl(address)).toBe(`https://stellar.expert/explorer/testnet/contract/${address}`);
  });

  it("builds a testnet tx URL", () => {
    expect(stellarExpertTxUrl("abc123")).toBe("https://stellar.expert/explorer/testnet/tx/abc123");
  });
});
