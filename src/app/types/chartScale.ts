export function chartScale(values: number[]) {
  const finite = values.filter(Number.isFinite);
  const min = finite.length ? Math.min(...finite) : 0;
  const max = finite.length ? Math.max(...finite) : 1;
  // A constant series must not magnify machine rounding into visible movement.
  const span = Math.max(0.1, max - min);
  const middle = (min + max) / 2;
  const domain: [number, number] = [middle - span * 0.65, middle + span * 0.65];
  const ticks = Array.from({length: 5}, (_, index) => domain[0] + index * (domain[1] - domain[0]) / 4);
  const decimals = Math.min(4, Math.max(1, Math.ceil(-Math.log10((domain[1] - domain[0]) / 4))));
  return {domain, ticks, format: (value: number) => value.toFixed(decimals), flat: max - min < 1e-9};
}
