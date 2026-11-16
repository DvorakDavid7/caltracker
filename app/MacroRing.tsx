type Props = { kcal: number; protein: number; fat: number; carbs: number };

const SIZE = 200;
const STROKE = 18;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;
const GAP = 4; // px gap between segments

/** Donut ring split by each macro's share of energy (4/9/4 kcal per gram). */
export default function MacroRing({ kcal, protein, fat, carbs }: Props) {
  const energy = [
    { key: "protein", value: protein * 4 },
    { key: "fat", value: fat * 9 },
    { key: "carbs", value: carbs * 4 },
  ];
  const total = energy.reduce((s, e) => s + e.value, 0);
  const visible = energy.filter((e) => e.value > 0);
  const gap = visible.length > 1 ? GAP : 0;

  let offset = 0;
  const segments = visible.map((e) => {
    const len = (e.value / total) * C;
    const seg = { key: e.key, dash: Math.max(len - gap, 0), offset };
    offset += len;
    return seg;
  });

  return (
    <div className="ring">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${kcal} kcal`}>
        <circle className="ring-track" cx={SIZE / 2} cy={SIZE / 2} r={R} strokeWidth={STROKE} fill="none" />
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          {segments.map((s) => (
            <circle
              key={s.key}
              className={`ring-seg ${s.key}`}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              strokeWidth={STROKE}
              fill="none"
              strokeDasharray={`${s.dash} ${C - s.dash}`}
              strokeDashoffset={-s.offset}
            />
          ))}
        </g>
      </svg>
      <div className="ring-center">
        <span className="ring-kcal">{kcal}</span>
        <span className="ring-unit">kcal</span>
      </div>
    </div>
  );
}
