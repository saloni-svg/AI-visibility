import path from "node:path";
import {
  Circle, Defs, Document, Font, G, Line, LinearGradient, Link, Page, Path, Rect, Stop, StyleSheet, Svg, Text, View,
} from "@react-pdf/renderer";

// RyzeIQ report documents: a designed PDF (cover page, running header and footer, sections, KPI
// blocks, tables and charts) instead of a print of the screen. Every report PDF builds on these.

const FONTS = path.join(process.cwd(), "lib/pdf/fonts");
Font.register({
  family: "Inter",
  fonts: [
    { src: path.join(FONTS, "Inter-Regular.ttf"), fontWeight: 400 },
    { src: path.join(FONTS, "Inter-SemiBold.ttf"), fontWeight: 600 },
    { src: path.join(FONTS, "Inter-Bold.ttf"), fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((w) => [w]); // no hyphenation

export const C = {
  ink: "#0B1530", text: "#1F2A44", muted: "#6B7690", faint: "#9AA3B8", line: "#E4E9F2", band: "#F5F7FC",
  brand: "#2346D8", brand2: "#2F5BFF", cyan: "#22D3EE", navy: "#1A2B8F",
  good: "#15803D", goodBg: "#E8F5EC", bad: "#D1343B", badBg: "#FCEBEC", warn: "#B45309", warnBg: "#FEF3E2",
  series: ["#2F5BFF", "#0EA5B7", "#DB2777", "#CA8A04", "#475569", "#16A34A"],
};

// Text the font can't draw (emoji such as country flags) is removed.
export const clean = (s: unknown) => String(s ?? "").replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "").trim();
export const num = (n: number | null | undefined) => (n == null ? "–" : Math.round(n).toLocaleString("en-IN"));
export const pct = (n: number | null | undefined, digits = 0) => (n == null ? "–" : `${(n * 100).toFixed(digits)}%`);
export const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

const s = StyleSheet.create({
  page: { fontFamily: "Inter", fontSize: 9, color: C.text, paddingTop: 74, paddingBottom: 56, paddingHorizontal: 40 },
  header: { position: "absolute", top: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  headerRight: { fontSize: 7.5, color: C.faint, textAlign: "right", lineHeight: 1.4 },
  footer: { position: "absolute", bottom: 22, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: C.faint, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.line },
  h1: { fontSize: 20, fontWeight: 700, color: C.ink, marginBottom: 4 },
  h2: { fontSize: 12.5, fontWeight: 700, color: C.ink, marginBottom: 2 },
  sectionNote: { fontSize: 8, color: C.muted, marginBottom: 8 },
  section: { marginBottom: 18 },
  scope: { fontSize: 7.5, color: C.faint, marginBottom: 8 },
  p: { fontSize: 9, lineHeight: 1.5, color: C.text },
});

// ---------- Brand ----------
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Defs>
        <LinearGradient id="rzg" x1="2" y1="30" x2="30" y2="2">
          <Stop offset="0" stopColor={C.navy} />
          <Stop offset="0.5" stopColor={C.brand2} />
          <Stop offset="1" stopColor={C.cyan} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="32" height="32" rx="9" fill="url(#rzg)" />
      <Path d="M7 23.5 L12.6 17.6 L16.2 21 L22.5 14.4" stroke="#FFFFFF" strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M23.6 5.6 C24 7.7 24.7 8.4 26.8 8.8 C24.7 9.2 24 9.9 23.6 12 C23.2 9.9 22.5 9.2 20.4 8.8 C22.5 8.4 23.2 7.7 23.6 5.6 Z" fill="#CFFAFE" />
    </Svg>
  );
}
function Wordmark({ size = 11 }: { size?: number }) {
  return (
    <Text style={{ fontSize: size, fontWeight: 700, color: C.ink }}>
      Ryze<Text style={{ color: C.brand2 }}>IQ</Text>
    </Text>
  );
}

// ---------- Document frame ----------
export type ReportMeta = { title: string; domain: string; scope?: string; generated?: Date };

export function ReportDocument({ meta, children }: { meta: ReportMeta; children: React.ReactNode }) {
  const generated = fmtDate(meta.generated ?? new Date());
  return (
    <Document title={`${meta.title} - ${meta.domain}`} author="DigitalRyze" creator="RyzeIQ" producer="RyzeIQ">
      {/* Cover */}
      <Page size="A4" style={{ fontFamily: "Inter", padding: 0 }}>
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: 6, backgroundColor: C.brand2 }} />
        <View style={{ marginTop: 70, alignItems: "center" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Logo size={40} />
            <View>
              <Wordmark size={24} />
              <Text style={{ fontSize: 9, color: C.muted }}>Search &amp; AI visibility · by DigitalRyze</Text>
            </View>
          </View>
        </View>
        <View style={{ flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 60 }}>
          <Text style={{ fontSize: 30, fontWeight: 600, color: C.ink, textAlign: "center" }}>{meta.title}</Text>
          <Text style={{ fontSize: 15, color: C.brand, marginTop: 10 }}>{meta.domain}</Text>
          {meta.scope ? <Text style={{ fontSize: 9.5, color: C.muted, marginTop: 14, textAlign: "center" }}>{meta.scope}</Text> : null}
        </View>
        <View style={{ alignItems: "center", marginBottom: 40 }}>
          <Text style={{ fontSize: 8.5, color: C.faint }}>Generated on {generated}</Text>
          <Text style={{ fontSize: 8.5, color: C.faint, marginTop: 3 }}>portal.digitalryze.com</Text>
        </View>
      </Page>

      {/* Content */}
      <Page size="A4" style={s.page} wrap>
        <View style={s.header} fixed>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Logo size={18} />
            <Wordmark size={12} />
          </View>
          <Text style={s.headerRight}>DIGITALRYZE · PORTAL.DIGITALRYZE.COM{"\n"}{meta.title.toUpperCase()} · {meta.domain.toUpperCase()}</Text>
        </View>
        {children}
        <View style={s.footer} fixed>
          <Text>Generated on {generated}</Text>
          <Text>The report data is taken from RyzeIQ</Text>
          <Text render={({ pageNumber }) => `${pageNumber}`} />
        </View>
      </Page>
    </Document>
  );
}

// A titled block. `keep`: never split it across pages (charts, KPI rows). Otherwise the title
// always stays with at least the start of its content.
export function Section({ title, note, scope, children, breakBefore = false, keep = false }: { title: string; note?: string; scope?: string; children: React.ReactNode; breakBefore?: boolean; keep?: boolean }) {
  return (
    <View style={s.section} break={breakBefore} wrap={!keep}>
      <View wrap={false} minPresenceAhead={70}>
        <Text style={s.h2}>{title}</Text>
        {scope ? <Text style={s.scope}>{scope}</Text> : null}
        {note ? <Text style={s.sectionNote}>{note}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export function BigTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.h1}>{children}</Text>
      {sub ? <Text style={{ fontSize: 9, color: C.muted }}>{sub}</Text> : null}
    </View>
  );
}

export function Para({ children }: { children: React.ReactNode }) {
  return <Text style={[s.p, { marginBottom: 6 }]}>{children}</Text>;
}

// ---------- Numbers ----------
export function Delta({ now, before, lowerIsBetter = false, suffix = "" }: { now: number | null | undefined; before: number | null | undefined; lowerIsBetter?: boolean; suffix?: string }) {
  if (now == null || before == null || before === 0 || now === before) return null;
  const change = Math.round(((now - before) / before) * 100);
  const good = lowerIsBetter ? change < 0 : change > 0;
  return (
    <Text style={{ fontSize: 7.5, fontWeight: 600, color: good ? C.good : C.bad, backgroundColor: good ? C.goodBg : C.badBg, paddingHorizontal: 4, paddingVertical: 1.5, borderRadius: 6 }}>
      {change > 0 ? "+" : ""}{change}%{suffix}
    </Text>
  );
}

export type Kpi = { label: string; value: string; delta?: React.ReactNode; sub?: string };
export function Kpis({ items }: { items: Kpi[] }) {
  return (
    <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }} wrap={false}>
      {items.map((k, i) => (
        <View key={i} style={{ flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 8, padding: 10, borderTopWidth: 3, borderTopColor: C.brand2 }}>
          <Text style={{ fontSize: 7.5, color: C.muted, textTransform: "uppercase", letterSpacing: 0.4 }}>{k.label}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 }}>
            <Text style={{ fontSize: 19, fontWeight: 700, color: C.ink }}>{k.value}</Text>
            {k.delta}
          </View>
          {k.sub ? <Text style={{ fontSize: 7.5, color: C.muted, marginTop: 3 }}>{k.sub}</Text> : null}
        </View>
      ))}
    </View>
  );
}

// Two-column "label  value" rows, like a summary box.
export function FactList({ rows }: { rows: [string, string][] }) {
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: C.line }}>
      {rows.map(([k, v], i) => (
        <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.line }} wrap={false}>
          <Text style={{ color: C.muted }}>{k}</Text>
          <Text style={{ fontWeight: 600, color: C.ink }}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

// ---------- Tables ----------
export type Col = { label: string; width: number; align?: "left" | "right" | "center" };
export type Cell = string | { text: string; color?: string; bold?: boolean; bar?: number; sub?: string };

export function Table({ cols, rows, empty = "No data" }: { cols: Col[]; rows: Cell[][]; empty?: string }) {
  if (!rows.length) {
    return <View style={{ borderWidth: 1, borderColor: C.line, borderStyle: "dashed", borderRadius: 6, padding: 14 }}><Text style={{ color: C.faint }}>{empty.toUpperCase()}</Text></View>;
  }
  const total = cols.reduce((a, c) => a + c.width, 0);
  const w = (c: Col) => `${(c.width / total) * 100}%`;
  return (
    <View>
      <View style={{ flexDirection: "row", borderBottomWidth: 1.2, borderBottomColor: C.ink, paddingBottom: 4 }} fixed={false} wrap={false}>
        {cols.map((c, i) => <Text key={i} style={{ width: w(c), fontSize: 7.5, color: C.muted, textAlign: c.align ?? "left", paddingRight: 4 }}>{c.label}</Text>)}
      </View>
      {rows.map((r, ri) => (
        <View key={ri} style={{ flexDirection: "row", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.line, alignItems: "flex-start" }} wrap={false}>
          {r.map((cell, ci) => {
            const c = cols[ci];
            const o = typeof cell === "string" ? { text: cell } : cell;
            return (
              <View key={ci} style={{ width: w(c), paddingRight: 4 }}>
                <Text style={{ fontSize: 8.5, textAlign: c.align ?? "left", color: o.color ?? C.text, fontWeight: o.bold ? 600 : 400 }}>{clean(o.text)}</Text>
                {o.sub ? <Text style={{ fontSize: 7, color: C.muted, marginTop: 1.5, textAlign: c.align ?? "left" }}>{clean(o.sub)}</Text> : null}
                {o.bar != null ? (
                  <View style={{ height: 3.5, backgroundColor: C.line, borderRadius: 2, marginTop: 3 }}>
                    <View style={{ height: 3.5, width: `${Math.max(2, Math.min(100, o.bar * 100))}%`, backgroundColor: C.good, borderRadius: 2 }} />
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ---------- Charts ----------
const W = 515; // content width at A4 with 40pt margins

export function BarChart({ data, height = 150, color = C.brand2, valueLabels = true }: { data: { label: string; value: number }[]; height?: number; color?: string; valueLabels?: boolean }) {
  if (!data.length) return <Text style={{ color: C.faint }}>NO DATA</Text>;
  const max = Math.max(1, ...data.map((d) => d.value));
  const top = 14, bottom = 18, left = 4;
  const chartH = height - top - bottom;
  const slot = (W - left) / data.length;
  const bw = Math.min(34, slot * 0.6);
  return (
    <Svg width={W} height={height}>
      <Line x1={left} y1={top + chartH} x2={W} y2={top + chartH} stroke={C.line} strokeWidth={1} />
      {data.map((d, i) => {
        const h = Math.max(1, (d.value / max) * chartH);
        const x = left + i * slot + (slot - bw) / 2;
        return (
          <G key={i}>
            <Rect x={x} y={top + chartH - h} width={bw} height={h} fill={color} rx={2} />
            {valueLabels ? <Text x={x + bw / 2} y={top + chartH - h - 3} style={{ fontSize: 6.5, fill: C.muted }} textAnchor="middle">{num(d.value)}</Text> : null}
            <Text x={x + bw / 2} y={height - 5} style={{ fontSize: 6.5, fill: C.muted }} textAnchor="middle">{clean(d.label)}</Text>
          </G>
        );
      })}
    </Svg>
  );
}

export function LineChart({ labels, series, height = 170, percent = false }: { labels: string[]; series: { name: string; color: string; values: (number | null)[] }[]; height?: number; percent?: boolean }) {
  if (labels.length < 2) return <Text style={{ color: C.faint }}>The trend appears after the second check.</Text>;
  const top = 10, bottom = 30, left = 30, right = 6;
  const chartH = height - top - bottom, chartW = W - left - right;
  const all = series.flatMap((x) => x.values.filter((v): v is number => v != null));
  const max = Math.max(percent ? 0.05 : 1, ...all) * 1.1;
  const xAt = (i: number) => left + (i / (labels.length - 1)) * chartW;
  const yAt = (v: number) => top + chartH - (v / max) * chartH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const every = Math.max(1, Math.ceil(labels.length / 6));
  return (
    <View wrap={false}>
      <Svg width={W} height={height}>
        {ticks.map((t, i) => (
          <G key={i}>
            <Line x1={left} y1={yAt(t)} x2={W - right} y2={yAt(t)} stroke={C.line} strokeWidth={0.8} />
            <Text x={left - 4} y={yAt(t) + 2} style={{ fontSize: 6.5, fill: C.faint }} textAnchor="end">{percent ? `${Math.round(t * 100)}%` : num(t)}</Text>
          </G>
        ))}
        {series.map((ser, si) => {
          const pts = ser.values.map((v, i) => (v == null ? null : `${xAt(i)},${yAt(v)}`)).filter(Boolean) as string[];
          return (
            <G key={si}>
              {pts.length > 1 ? <Path d={`M${pts.join(" L")}`} stroke={ser.color} strokeWidth={1.6} fill="none" /> : null}
              {ser.values.map((v, i) => (v == null ? null : <Circle key={i} cx={xAt(i)} cy={yAt(v)} r={1.8} fill={ser.color} />))}
            </G>
          );
        })}
        {labels.map((l, i) => (i % every === 0 || i === labels.length - 1 ? (
          <Text key={i} x={xAt(i)} y={height - 16} style={{ fontSize: 6.5, fill: C.muted }} textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}>{clean(l)}</Text>
        ) : null))}
      </Svg>
      <Legend items={series.map((x) => ({ label: x.name, color: x.color }))} />
    </View>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 2 }}>
      {items.map((x, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: x.color }} />
          <Text style={{ fontSize: 7.5, color: C.muted }}>{clean(x.label)}</Text>
        </View>
      ))}
    </View>
  );
}

// Donut with a legend beside it (share of voice, keywords by country …).
export function Donut({ slices, size = 140, center }: { slices: { label: string; value: number; color: string }[]; size?: number; center?: string }) {
  const total = slices.reduce((a, x) => a + x.value, 0);
  const r = size / 2, ri = r * 0.6, cx = r, cy = r;
  let angle = -Math.PI / 2;
  const arcs = total ? slices.filter((x) => x.value > 0).map((x) => {
    const a0 = angle, a1 = angle + (x.value / total) * Math.PI * 2;
    angle = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a: number, rad: number) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
    const full = a1 - a0 >= Math.PI * 2 - 0.0001;
    const d = full
      ? `M${p(a0, r)} A${r},${r} 0 1 1 ${p(a0 + Math.PI, r)} A${r},${r} 0 1 1 ${p(a0, r)} M${p(a0, ri)} A${ri},${ri} 0 1 0 ${p(a0 + Math.PI, ri)} A${ri},${ri} 0 1 0 ${p(a0, ri)} Z`
      : `M${p(a0, r)} A${r},${r} 0 ${large} 1 ${p(a1, r)} L${p(a1, ri)} A${ri},${ri} 0 ${large} 0 ${p(a0, ri)} Z`;
    return { d, color: x.color };
  }) : [];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }} wrap={false}>
      <Svg width={size} height={size}>
        {arcs.length ? arcs.map((a, i) => <Path key={i} d={a.d} fill={a.color} />) : <Circle cx={cx} cy={cy} r={r - 1} stroke={C.line} strokeWidth={1} fill="none" />}
        {center ? <Text x={cx} y={cy + 4} style={{ fontSize: 11, fontWeight: 700, fill: C.ink }} textAnchor="middle">{center}</Text> : null}
      </Svg>
      <View style={{ gap: 5, flex: 1 }}>
        {slices.map((x, i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: x.color }} />
            <Text style={{ fontSize: 8.5, color: C.text, flex: 1 }}>{clean(x.label)}</Text>
            <Text style={{ fontSize: 8.5, fontWeight: 600, color: C.ink }}>{total ? `${((x.value / total) * 100).toFixed(1)}%` : "–"}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// Horizontal bars with a label and value (distribution by AI source, rank ranges …).
export function HBars({ items, color = C.brand2, format = (n: number) => num(n) }: { items: { label: string; value: number; sub?: string }[]; color?: string; format?: (n: number) => string }) {
  const max = Math.max(1, ...items.map((x) => x.value));
  return (
    <View style={{ gap: 7 }} wrap={false}>
      {items.map((x, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ width: 110, fontSize: 8.5 }}>{clean(x.label)}</Text>
          <View style={{ flex: 1, height: 8, backgroundColor: C.band, borderRadius: 4 }}>
            <View style={{ width: `${Math.max(1.5, (x.value / max) * 100)}%`, height: 8, backgroundColor: color, borderRadius: 4 }} />
          </View>
          <Text style={{ width: 70, fontSize: 8.5, fontWeight: 600, textAlign: "right" }}>{format(x.value)}{x.sub ? <Text style={{ fontWeight: 400, color: C.muted }}> {x.sub}</Text> : null}</Text>
        </View>
      ))}
    </View>
  );
}

// A callout box (insights, next steps, notes).
export function Callout({ title, children, tone = "brand" }: { title?: string; children: React.ReactNode; tone?: "brand" | "warn" | "good" | "bad" }) {
  const bg = { brand: "#EEF2FF", warn: C.warnBg, good: C.goodBg, bad: C.badBg }[tone];
  const bar = { brand: C.brand2, warn: C.warn, good: C.good, bad: C.bad }[tone];
  return (
    <View style={{ backgroundColor: bg, borderLeftWidth: 3, borderLeftColor: bar, borderRadius: 4, padding: 9, marginBottom: 8 }} wrap={false}>
      {title ? <Text style={{ fontWeight: 700, color: C.ink, marginBottom: 3, fontSize: 9.5 }}>{clean(title)}</Text> : null}
      {children}
    </View>
  );
}

export function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link src={href} style={{ color: C.brand, textDecoration: "none" }}>{children}</Link>;
}

export function Bullets({ items }: { items: string[] }) {
  return (
    <View style={{ gap: 3 }}>
      {items.map((t, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 5 }} wrap={false}>
          <Text style={{ color: C.brand2 }}>•</Text>
          <Text style={[s.p, { flex: 1 }]}>{clean(t)}</Text>
        </View>
      ))}
    </View>
  );
}
