import { logExecutorInfo } from "../../process/log";

import { calculateTPPercentages } from "../../database";

export async function splitQuantityForTPs(
  totalQty: number,
  numLevels: number,
  getSpecs: () => Promise<{ lotSz: number; qtyDecimals: number }>,
  mode: "equal" | "halving" = "equal",
): Promise<number[]> {
  if (numLevels <= 0) return [];
  if (numLevels === 1) return [totalQty];

  let lotSz = 1;
  let qtyDecimals = 4;
  try {
    const specs = await getSpecs();
    lotSz = specs.lotSz;
    qtyDecimals = specs.qtyDecimals;
  } catch {
    // Fallback to defaults
  }

  const mult = Math.pow(10, qtyDecimals);
  const totalUnits = Math.round(totalQty * mult);
  const lotUnits = Math.max(1, Math.round(lotSz * mult));
  const baseLotUnits =
    Math.floor(Math.floor(totalUnits / numLevels) / lotUnits) * lotUnits;

  const quantities: number[] = [];
  let allocated = 0;

  if (mode === "halving") {
    const percentages = calculateTPPercentages(numLevels, "halving");
    for (let i = 0; i < numLevels; i++) {
      if (i === numLevels - 1) {
        quantities.push((totalUnits - allocated) / mult);
      } else {
        const targetUnits = Math.round((totalUnits * percentages[i]) / 100);
        const tpLotUnits = Math.max(lotUnits, Math.floor(targetUnits / lotUnits) * lotUnits);
        quantities.push(tpLotUnits / mult);
        allocated += tpLotUnits;
      }
    }
  } else {
    for (let i = 0; i < numLevels; i++) {
      if (i === numLevels - 1) {
        quantities.push((totalUnits - allocated) / mult);
      } else {
        quantities.push(baseLotUnits / mult);
        allocated += baseLotUnits;
      }
    }
  }

  await logExecutorInfo(
    `📊 TP qty split (lotSz=${lotSz}, qtyDecimals=${qtyDecimals}): [${quantities.map((q) => q.toFixed(qtyDecimals)).join(", ")}] total=${quantities.reduce((a, b) => a + b, 0).toFixed(qtyDecimals)} (filledQty=${totalQty.toFixed(qtyDecimals)})`,
  );

  return quantities;
}
