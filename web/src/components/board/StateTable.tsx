"use client";
// The table layout's starting view: every state and territory with its current delegation size.
import { stateName, TERRITORIES } from "@/lib/format";

export function StateTable({ states, onPick }: { states: Record<string, string[]>; onPick: (s: string) => void }) {
  const list = Object.keys(states).sort((a, b) => stateName(a).localeCompare(stateName(b)));
  const territories = list.filter((s) => TERRITORIES.includes(s));
  return (
    <div className="tablewrap">
      <table className="ties">
        <caption className="visually-hidden">States and their current delegations</caption>
        <thead>
          <tr>
            <th scope="col">State</th>
            <th scope="col" className="num">Members</th>
            <th scope="col"><span className="visually-hidden">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {list.map((s) => (
            <tr key={s}>
              <td data-label="State">
                {stateName(s)}
                {territories.includes(s) && <span className="ties__sub"> territory</span>}
              </td>
              <td data-label="Members" className="num mono">{states[s].length}</td>
              <td className="ties__act">
                <button type="button" className="btn btn--small" onClick={() => onPick(s)}>
                  Delegation
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
