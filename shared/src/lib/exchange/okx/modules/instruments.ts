import type { AxiosInstance } from "axios";

export type OkxValidatedInstrument = {
  instId: string;
  baseCcy: string;
  quoteCcy: string;
  ctVal: string;
  ctValCcy: string;
  ctMult: string;
  ctType: string;
  lotSz: string;
  minSz: string;
  tickSz: string;
  state: string;
  instType: string;
};

export async function validateOkxInstrument(
  client: AxiosInstance,
  symbol: string,
  toOkxSymbol: (symbol: string) => string,
): Promise<OkxValidatedInstrument> {
  const instId = toOkxSymbol(symbol);
  const path = `/api/v5/public/instruments?instType=SWAP&instId=${instId}`;

  console.log(`[OKX] 🔍 Validating instrument: ${instId}...`);

  try {
    const response = await client.get(path);
    const data = response.data;

    if (data.code === "0" && data.data?.[0]) {
      const inst = data.data[0];
      console.log(
        `[OKX] ✅ Instrument validated: ${instId} (state=${inst.state}, ctVal=${inst.ctVal}, lotSz=${inst.lotSz}, minSz=${inst.minSz})`,
      );
      return inst;
    }

    console.warn(
      `[OKX] ⚠️ Instrument ${instId} not found. Searching for alternatives...`,
    );

    const baseCcy = instId.split("-")[0];
    const searchPath = `/api/v5/public/instruments?instType=SWAP`;
    const searchResp = await client.get(searchPath);
    const searchData = searchResp.data;

    if (searchData.code === "0" && searchData.data) {
      const matches = searchData.data.filter(
        (item: { baseCcy: string; quoteCcy: string; state: string }) =>
          item.baseCcy === baseCcy && item.state === "live",
      );
      if (matches.length > 0) {
        const suggestions = matches
          .map(
            (match: { instId: string; quoteCcy: string }) =>
              `${match.instId} (${match.quoteCcy})`,
          )
          .join(", ");
        throw new Error(
          `Instrument ${instId} not found on OKX. Available live alternatives for ${baseCcy}: ${suggestions}`,
        );
      }
    }

    throw new Error(`Instrument ${instId} not found on OKX`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to validate instrument ${instId}: ${message}`);
  }
}
