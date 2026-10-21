"use client";

import { useState } from "react";
import Icon from "./Icon";

type Insight = { domain: string; url: string; answers: number; competitors: string[] };

// Competitor insights, one at a time with arrows.
export default function InsightsCarousel({ insights }: { insights: Insight[] }) {
  const [i, setI] = useState(0);
  const item = insights[i];
  return (
    <aside className="card cr-insights" aria-label="Competitor insights">
      <h2 className="cr-insights-head">Competitor insights</h2>
      {!item ? (
        <div className="cr-insights-body">
          <p>No gaps found. Every website AI cites next to your competitors also leads to you.</p>
        </div>
      ) : (
        <>
          <div className="cr-insights-body" aria-live="polite">
            <p>
              <b>The {item.domain} source</b> mentions {item.competitors.join(", ")} but not you, in {item.answers}{" "}
              {item.answers === 1 ? "answer" : "answers"}.
            </p>
            <p>Review the content and create your own, or get listed or featured there to increase your visibility.</p>
          </div>
          <div className="cr-insights-foot">
            <a href={item.url} target="_blank" rel="noreferrer" className="btn-dark">Go to source</a>
            <div className="cr-pager">
              <button type="button" className="icon-btn" aria-label="Previous insight" disabled={i === 0} onClick={() => setI(i - 1)}>
                <Icon name="chevron" size={16} />
              </button>
              <span>{i + 1}/{insights.length}</span>
              <button type="button" className="icon-btn" aria-label="Next insight" disabled={i === insights.length - 1} onClick={() => setI(i + 1)}>
                <Icon name="chevron" size={16} />
              </button>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
