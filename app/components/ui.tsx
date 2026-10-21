import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

export function Stat({ icon, label, value, hero, children }: { icon: IconName; label: string; value: string; hero?: boolean; children: ReactNode }) {
  return (
    <div className={`card stat${hero ? " stat-hero" : ""}`}>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className="icon-chip"><Icon name={icon} size={16} /></span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{children}</div>
    </div>
  );
}

export function Card({ id, icon, title, note, aside, children }: { id: string; icon: IconName; title: string; note?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="card panel">
      <div className="panel-head">
        <span className="icon-chip"><Icon name={icon} size={16} /></span>
        <div className="panel-title">
          <h2>{title}</h2>
          {note && <p className="note">{note}</p>}
        </div>
        {aside && <div className="panel-aside">{aside}</div>}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}
