import { LineSample } from "../LineSample";

/** Every encoding on the board, in plain words. */
export function Legend() {
  return (
    <section className="legend" aria-labelledby="legend-h">
      <h2 id="legend-h" className="legend__h">
        How to read the strings
      </h2>
      <ul>
        <li>
          <LineSample style="filed" width={30} scale={1.6} />
          <span>
            <b>Solid yarn</b>: a filed record names both ends
          </span>
        </li>
        <li>
          <LineSample style="weak" width={30} scale={1.6} />
          <span>
            <b>Frayed yarn</b>: weaker; the card says why, <span className="tag tag--weak">STATISTICAL</span> or <span className="tag tag--weak">INCOMPLETE</span>
          </span>
        </li>
        <li>
          <svg className="legend__thick" viewBox="0 0 40 12" width="40" height="12" aria-hidden="true">
            <path d="M2 4 Q10 8 18 4" strokeWidth="1.6" />
            <path d="M22 4 Q30 9 38 4" strokeWidth="5" />
            <path className="legend__ply" d="M22 4 Q30 9 38 4" strokeWidth="2" />
          </svg>
          <span>
            <b>Thicker</b>: more money, or more records (log scale)
          </span>
        </li>
        <li>
          <LineSample style="context" width={30} scale={1.6} />
          <span>
            <b>Grey thread</b>: context, such as a shared committee. Off by default
          </span>
        </li>
        <li>
          <span className="tag tag--inline">Case</span>
          <span>household traded the company&rsquo;s stock and the member received money from its PAC in the same years</span>
        </li>
        <li>
          <span className="against__tag legend__against">AGAINST</span>
          <span>spending against the member sits apart, unconnected: it is not a tie. Spending for them is yarn, spent independently</span>
        </li>
        <li>
          <abbr className="party" title="Democrat, Republican, Independent">
            D
          </abbr>
          <span>party letter: D, R or I</span>
        </li>
      </ul>
    </section>
  );
}
