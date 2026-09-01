function mapDots() {
  const regions = [
    { cx: 20, cy: 36, rx: 13, ry: 15 },
    { cx: 26, cy: 62, rx: 7, ry: 12 },
    { cx: 47, cy: 33, rx: 9, ry: 7 },
    { cx: 51, cy: 52, rx: 10, ry: 14 },
    { cx: 70, cy: 38, rx: 16, ry: 13 },
    { cx: 78, cy: 26, rx: 7, ry: 5 },
    { cx: 84, cy: 64, rx: 8, ry: 6 },
  ];
  const dots: { x: number; y: number }[] = [];
  for (let y = 10; y <= 88; y += 2.7) {
    for (let x = 5; x <= 95; x += 2.5) {
      if (regions.some((r) => ((x - r.cx) / r.rx) ** 2 + ((y - r.cy) / r.ry) ** 2 < 1)) {
        dots.push({ x, y });
      }
    }
  }
  return dots;
}

const MAP_DOTS = mapDots();

const PARTICLES = [
  { x: 12, y: 22, r: 1.1 },
  { x: 28, y: 70, r: 0.8 },
  { x: 41, y: 18, r: 0.7 },
  { x: 63, y: 78, r: 1 },
  { x: 74, y: 14, r: 0.9 },
  { x: 88, y: 46, r: 0.7 },
];

export function LoginScene({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-[#05070f] text-white">
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse at 18% 12%, rgba(34,211,238,0.08), transparent 42%), radial-gradient(ellipse at 88% 80%, rgba(37,99,235,0.1), transparent 40%), radial-gradient(ellipse at 70% 20%, rgba(56,189,248,0.05), transparent 36%)",
        }}
      />
      <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.22]" aria-hidden="true">
        <defs>
          <pattern id="nixo-hex" width="28" height="48" patternUnits="userSpaceOnUse">
            <path
              d="M14 2 L26 9 L26 23 L14 30 L2 23 L2 9 Z"
              fill="none"
              stroke="rgba(56,189,248,0.18)"
              strokeWidth="0.4"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#nixo-hex)" />
      </svg>
      <svg
        className="pointer-events-none absolute inset-0 hidden h-full w-full opacity-[0.35] sm:block"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        {MAP_DOTS.map((d, i) => (
          <circle key={`${d.x}-${d.y}-${i}`} cx={d.x} cy={d.y} r={0.28} fill="rgba(125,211,252,0.45)" />
        ))}
        <path
          d="M8 42 C 28 18, 48 70, 72 28 S 96 60, 102 40"
          fill="none"
          stroke="rgba(34,211,238,0.18)"
          strokeWidth="0.22"
        />
        <path
          d="M-2 68 C 22 48, 40 88, 62 52 S 90 22, 108 54"
          fill="none"
          stroke="rgba(59,130,246,0.16)"
          strokeWidth="0.2"
        />
        {PARTICLES.map((p) => (
          <circle key={`${p.x}-${p.y}`} cx={p.x} cy={p.y} r={p.r} fill="rgba(34,211,238,0.55)" />
        ))}
      </svg>
      {children}
    </div>
  );
}
