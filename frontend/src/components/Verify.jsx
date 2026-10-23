/**
 * "Do not trust the page: check it." Reads every vote for one ballot from the
 * contract's event log, adds them up in the browser with the same rules the
 * contract uses, and compares with the tally the contract itself reports. It
 * needs no wallet and nothing the site could fake: the log is the ledger.
 */
import { useState } from "react";

import { useLocale } from "../i18n/index.jsx";
import { formatNumber } from "../lib/format.js";
import { getLogsChunked } from "../lib/logs.js";
import { recount, sameTally } from "../lib/tally.js";
import { useNetwork } from "../state/network.jsx";
import Icon from "./Icon.jsx";
import { Notice } from "./States.jsx";

export default function Verify({ ballot }) {
  const { t, lang } = useLocale();
  const { network, reader, contracts } = useNetwork();
  const [state, setState] = useState({ phase: "idle" });

  async function run() {
    setState({ phase: "running", done: 0, total: 1 });
    try {
      const filter = contracts.voting.filters.VoteCast(ballot.id);
      const topics = await filter.getTopicFilter();
      const from = Number(network.contracts.DirectDemocracy.block ?? 0);
      const logs = await getLogsChunked(
        reader,
        { address: await contracts.voting.getAddress(), topics },
        { from, chunk: network.logChunk, onProgress: ({ done, total }) => setState({ phase: "running", done, total }) }
      );
      const events = logs.map((log) => {
        const parsed = contracts.voting.interface.parseLog(log);
        return { voter: parsed.args.voter, option: parsed.args.option, block: log.blockNumber };
      });
      const mine = recount(events, ballot.options.length);
      const theirs = (await contracts.voting.tallyOf(ballot.id)).map(Number);
      const blocks = events.map((e) => e.block);
      setState({
        phase: "done",
        mine,
        theirs,
        agree: sameTally(mine.tally, theirs) && mine.duplicates.length === 0 && mine.outOfRange.length === 0,
        first: blocks.length ? Math.min(...blocks) : null,
        last: blocks.length ? Math.max(...blocks) : null,
      });
    } catch (error) {
      setState({ phase: "error", message: String(error?.shortMessage || error?.message || error) });
    }
  }

  return (
    <section className="verify" aria-labelledby={`verify-${ballot.id}`}>
      <h3 id={`verify-${ballot.id}`}>{t("verify.title")}</h3>
      <p className="muted">{t("verify.body")}</p>
      <button type="button" className="btn btn--small" onClick={run} disabled={state.phase === "running"} aria-busy={state.phase === "running"}>
        {state.phase === "running" ? t("verify.running", { done: formatNumber(state.done, lang), total: formatNumber(state.total, lang) }) : state.phase === "done" ? t("verify.again") : t("verify.action")}
      </button>

      <div aria-live="polite">
        {state.phase === "error" && (
          <Notice tone="error" role="alert">
            {t("verify.error")}
          </Notice>
        )}
        {state.phase === "done" && (
          <div className="stack">
            <p className={state.agree ? "verify__result verify__result--ok" : "verify__result verify__result--bad"}>
              <Icon name={state.agree ? "check" : "alert"} /> <strong>{state.agree ? t("verify.match") : t("verify.mismatch")}</strong>
            </p>
            <p>{t("verify.found", { count: state.mine.voters, first: state.first ?? "-", last: state.last ?? "-" })}</p>
            <table className="verify__table">
              <thead>
                <tr>
                  <th scope="col">{t("verify.option")}</th>
                  <th scope="col" className="num">
                    {t("verify.recount")}
                  </th>
                  <th scope="col" className="num">
                    {t("verify.contract")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {ballot.options.map((option, i) => (
                  <tr key={i}>
                    <th scope="row" dir="auto">
                      {option}
                    </th>
                    <td className="num">{formatNumber(state.mine.tally[i], lang)}</td>
                    <td className="num">{formatNumber(state.theirs[i], lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(state.mine.duplicates.length > 0 || state.mine.outOfRange.length > 0) && <Notice tone="error">{t("verify.oddities")}</Notice>}
          </div>
        )}
      </div>
    </section>
  );
}
